"""盲化样本生成 / 片段客观指标 / 实验批次的纯服务逻辑。

从 routers/blind_samples.py 抽出，供 HTTP 端点与「批量分离完成后自动编排」复用，
避免重复实现 ffmpeg 裁剪、片段 BSS 指标计算等逻辑。
"""
from __future__ import annotations

import json
import secrets
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    BlindSample,
    BlindExperiment,
    BlindAssignment,
    SeparationTask,
    StemFile,
    TaskStatus,
    User,
    Role,
)
from app.services.objective_metrics import compute_bss_metrics_two_source
from app.services.objective_metrics_multisource import compute_bss_metrics_multisource

# 固定到仓库根目录，避免 uvicorn 从不同 cwd 启动时生成/读取路径不一致。
BLIND_DIR = Path(__file__).resolve().parents[3] / "results" / "blind_samples"

DEFAULT_STEMS = ["Vocals", "Drums", "Bass", "Other"]


def _duration_seconds(path: Path) -> float:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "无法读取音频时长")
    return float(proc.stdout.strip())


def _write_15_second_clip(source: Path, output: Path, start_seconds: float) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-ss", f"{start_seconds:.3f}", "-i", str(source),
            "-af", "apad", "-t", "15", "-ar", "44100", "-ac", "2",
            "-c:a", "pcm_s16le", str(output),
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )
    if proc.returncode != 0 or not output.exists() or output.stat().st_size == 0:
        raise RuntimeError(proc.stderr.strip() or "15 秒样本生成失败")
    actual = _duration_seconds(output)
    if abs(actual - 15.0) > 0.05:
        output.unlink(missing_ok=True)
        raise RuntimeError(f"生成样本时长异常：{actual:.3f} 秒")


async def generate_blind_samples_for_task(
    db: AsyncSession,
    task_id: int,
    stem_names: Optional[list[str]] = None,
    include_partial_tail: bool = False,
    max_segments_per_stem: int = 100,
) -> dict:
    """为已完成任务生成 15 秒盲化样本（幂等：已存在的复用）。返回 {created_or_existing, samples, codes}。"""
    stem_names = stem_names or DEFAULT_STEMS
    task = await db.get(SeparationTask, task_id)
    if not task or task.status != TaskStatus.COMPLETED:
        raise HTTPException(status_code=409, detail="只能为已完成的真实分离任务生成盲化样本")
    result = await db.execute(select(StemFile).where(StemFile.task_id == task.id))
    stems = [item for item in result.scalars().all() if item.stem_name in set(stem_names)]
    if not stems:
        raise HTTPException(status_code=404, detail="任务中没有可生成的声源文件")

    created = []
    generated_paths = []
    try:
        for stem in stems:
            source = Path(stem.file_path)
            if not source.exists() or source.stat().st_size == 0:
                raise HTTPException(status_code=409, detail=f"{stem.stem_name} 声源文件不存在或为空")
            duration = _duration_seconds(source)
            starts = [float(v) for v in range(0, int(duration), 15) if v + 15 <= duration + 0.01]
            if not starts and include_partial_tail and duration > 0:
                starts = [0.0]
            elif include_partial_tail and duration % 15 > 0.05:
                starts.append(float(int(duration // 15) * 15))
            for start in starts[:max_segments_per_stem]:
                existing = await db.execute(select(BlindSample).where(BlindSample.task_id == task.id, BlindSample.stem_name == stem.stem_name, BlindSample.start_seconds == start))
                sample = existing.scalars().first()
                if not sample:
                    code = secrets.token_urlsafe(18)
                    output = BLIND_DIR / f"{code}.wav"
                    _write_15_second_clip(source, output, start)
                    generated_paths.append(output)
                    sample = BlindSample(
                        blind_code=code,
                        task_id=task.id,
                        algorithm=task.algorithm,
                        stem_name=stem.stem_name,
                        start_seconds=start,
                        end_seconds=start + 15.0,
                        sample_group_key=f"{task.original_filename or task.id}|{stem.stem_name}|{start:.3f}",
                        file_path=str(output),
                    )
                    db.add(sample)
                    await db.flush()
                elif not sample.sample_group_key:
                    sample.sample_group_key = f"{task.original_filename or task.id}|{stem.stem_name}|{start:.3f}"
                created.append({"blind_code": sample.blind_code, "stem_name": sample.stem_name, "duration_seconds": 15.0})
        await db.commit()
    except Exception as exc:
        await db.rollback()
        for path in generated_paths:
            path.unlink(missing_ok=True)
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(status_code=503, detail=f"盲化样本生成失败：{exc}") from exc
    return {"created_or_existing": len(created), "samples": created, "codes": [s["blind_code"] for s in created]}


async def compute_clip_objective_metrics_for_sample(db: AsyncSession, sample: BlindSample) -> dict:
    """按任务已登记的金标准自动裁剪同一 15 秒区间，计算并保存片段级指标。返回 metrics dict。"""
    task = await db.get(SeparationTask, sample.task_id)
    if not task or not task.file_path:
        raise HTTPException(status_code=404, detail="关联的混合音频不存在")
    source = Path(sample.file_path)
    mixture = Path(task.file_path)
    if not source.exists() or not mixture.exists():
        raise HTTPException(status_code=404, detail="片段或混合音频文件不存在")
    references = {}
    try:
        references = json.loads(task.metadata_json or "{}").get("reference_paths") or {}
    except Exception:
        references = {}
    reference_path = Path(str(references.get(sample.stem_name, "")))
    if not reference_path.exists():
        raise HTTPException(status_code=409, detail=f"任务尚未登记 {sample.stem_name} 金标准，请先完成一次任务级客观指标计算")

    with tempfile.TemporaryDirectory(prefix="audiolab_clip_metrics_") as temp_dir:
        temp = Path(temp_dir)
        ref_path = temp / "reference_clip.wav"
        mix_clip = temp / "mixture.wav"
        try:
            _write_15_second_clip(mixture, mix_clip, float(sample.start_seconds))
            _write_15_second_clip(reference_path, ref_path, float(sample.start_seconds))
            reference_paths = {name: Path(p) for name, p in references.items() if Path(p).exists()}
            stem_result = await db.execute(select(StemFile).where(StemFile.task_id == sample.task_id))
            stem_paths = {item.stem_name: Path(item.file_path) for item in stem_result.scalars().all() if Path(item.file_path).exists()}
            if len(reference_paths) >= 2 and set(reference_paths).issubset(stem_paths):
                clip_refs, clip_estimates = {}, {}
                for name, full_ref in reference_paths.items():
                    ref_clip = temp / f"ref_{name}.wav"
                    est_clip = temp / f"est_{name}.wav"
                    _write_15_second_clip(full_ref, ref_clip, float(sample.start_seconds))
                    _write_15_second_clip(stem_paths[name], est_clip, float(sample.start_seconds))
                    clip_refs[name] = ref_clip
                    clip_estimates[name] = est_clip
                multi = compute_bss_metrics_multisource(mixture_path=mix_clip, estimates=clip_estimates, references=clip_refs)
                metrics_data = multi.metrics_by_source.get(sample.stem_name)
                if not metrics_data:
                    raise ValueError(f"多源指标中缺少 {sample.stem_name}")
                values = {key: float(value) for key, value in metrics_data.items()}
            else:
                metrics = compute_bss_metrics_two_source(mixture_path=mix_clip, estimate_path=source, reference_target_path=ref_path)
                values = {"sdr": float(metrics.sdr), "sir": float(metrics.sir), "sar": float(metrics.sar)}
                if metrics.si_sdr is not None:
                    values["si_sdr"] = float(metrics.si_sdr)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=f"片段客观指标计算失败：{exc}") from exc
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"片段客观指标计算失败：{exc}") from exc
    values.update({"segment_start": float(sample.start_seconds), "segment_end": float(sample.end_seconds)})
    sample.objective_metrics_json = json.dumps(values, ensure_ascii=False)
    await db.commit()
    return {"blind_code": sample.blind_code, "stem_name": sample.stem_name, "metrics": values}


async def compute_task_clip_objective_metrics(db: AsyncSession, task_id: int) -> dict:
    """自动处理任务下全部盲化片段的客观指标。"""
    result = await db.execute(select(BlindSample).where(BlindSample.task_id == task_id).order_by(BlindSample.start_seconds.asc()))
    samples = list(result.scalars().all())
    if not samples:
        raise HTTPException(status_code=404, detail="该任务没有盲化样本")
    completed, failed = [], []
    for sample in samples:
        try:
            completed.append(await compute_clip_objective_metrics_for_sample(db, sample))
        except HTTPException as exc:
            failed.append({"blind_code": sample.blind_code, "detail": exc.detail})
    return {"task_id": task_id, "total": len(samples), "completed": len(completed), "failed": failed, "items": completed}


async def create_experiment_for_tasks(
    db: AsyncSession,
    task_ids: list[int],
    name: str,
    created_by: str,
    expert_ids: Optional[list[str]] = None,
) -> dict:
    """从已生成片段的多个任务创建平衡对比实验批次，并分配给专家。"""
    if len(set(task_ids)) != len(task_ids):
        raise HTTPException(status_code=422, detail="实验批次中的任务不能重复")
    result = await db.execute(select(SeparationTask).where(SeparationTask.id.in_(task_ids)))
    tasks = list(result.scalars().all())
    if len(tasks) != len(task_ids) or any(t.status != TaskStatus.COMPLETED for t in tasks):
        raise HTTPException(status_code=409, detail="实验批次只能包含已完成的分离任务")
    if len({t.algorithm for t in tasks}) < 2:
        raise HTTPException(status_code=422, detail="实验批次至少需要两种不同算法")
    experts = list(expert_ids or [])
    if not experts:
        expert_result = await db.execute(select(User.id).where(User.role == Role.EXPERT, User.is_active.is_(True), User.is_approved.is_(True)))
        experts = [str(row[0]) for row in expert_result.all()]
    if not experts:
        raise HTTPException(status_code=409, detail="没有可分配的有效专家")
    samples_result = await db.execute(select(BlindSample).where(BlindSample.task_id.in_(task_ids)))
    samples = list(samples_result.scalars().all())
    if not samples:
        raise HTTPException(status_code=409, detail="请先为这些任务生成盲化样本")
    groups = {s.sample_group_key for s in samples if s.sample_group_key}
    if not groups:
        raise HTTPException(status_code=409, detail="盲化样本缺少配对键，请重新生成样本")
    per_task_groups = [{s.sample_group_key for s in samples if s.task_id == tid and s.sample_group_key} for tid in task_ids]
    if any(group_set != per_task_groups[0] for group_set in per_task_groups[1:]):
        raise HTTPException(status_code=422, detail="各算法任务的歌曲、声源或15秒时间片不一致，无法组成平衡实验批次")
    experiment = BlindExperiment(name=name.strip(), created_by=str(created_by))
    db.add(experiment)
    await db.flush()
    for sample in samples:
        sample.experiment_id = experiment.id
        for expert_id in set(experts):
            db.add(BlindAssignment(experiment_id=experiment.id, blind_sample_id=sample.id, expert_id=str(expert_id)))
    await db.commit()
    return {"experiment_id": str(experiment.id), "sample_count": len(samples), "expert_count": len(set(experts)), "group_count": len(groups)}
