import json
import secrets
import random
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import BlindSample, BlindExperiment, BlindAssignment, Role, Score, SeparationTask, StemFile, TaskStatus, User
from app.routers.admin import get_current_admin
from app.routers.auth import get_current_user
from app.schemas import BlindScoreCreate, BlindScoreBatchCreate, AudioAnalysisPayload
from app.services.analysis_service import analyze_audio_file, analysis_to_payload
from app.services.objective_metrics import compute_bss_metrics_two_source
from app.services.objective_metrics_multisource import compute_bss_metrics_multisource


router = APIRouter(prefix="/api/blind-samples", tags=["blind-samples"])
# 固定到仓库根目录，避免 uvicorn 从不同 cwd 启动时生成/读取路径不一致。
BLIND_DIR = Path(__file__).resolve().parents[3] / "results" / "blind_samples"


class GenerateBlindSamples(BaseModel):
    task_id: int
    stem_names: list[str] = Field(default_factory=lambda: ["Vocals", "Drums", "Bass", "Other"])
    include_partial_tail: bool = False
    max_segments_per_stem: int = Field(default=100, ge=1, le=10000)


class CreateBlindExperiment(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    task_ids: list[int] = Field(min_length=2, max_length=100)
    expert_ids: list[str] = Field(default_factory=list, max_length=100)


@router.post("/experiments")
async def create_blind_experiment(
    payload: CreateBlindExperiment,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Create a balanced comparison batch from already-generated clips."""
    if len(set(payload.task_ids)) != len(payload.task_ids):
        raise HTTPException(status_code=422, detail="实验批次中的任务不能重复")
    result = await db.execute(select(SeparationTask).where(SeparationTask.id.in_(payload.task_ids)))
    tasks = list(result.scalars().all())
    if len(tasks) != len(payload.task_ids) or any(t.status != TaskStatus.COMPLETED for t in tasks):
        raise HTTPException(status_code=409, detail="实验批次只能包含已完成的分离任务")
    if len({t.algorithm for t in tasks}) < 2:
        raise HTTPException(status_code=422, detail="实验批次至少需要两种不同算法")
    experts = payload.expert_ids
    if not experts:
        expert_result = await db.execute(select(User.id).where(User.role == Role.EXPERT, User.is_active.is_(True), User.is_approved.is_(True)))
        experts = [str(row[0]) for row in expert_result.all()]
    if not experts:
        raise HTTPException(status_code=409, detail="没有可分配的有效专家")
    samples_result = await db.execute(select(BlindSample).where(BlindSample.task_id.in_(payload.task_ids)))
    samples = list(samples_result.scalars().all())
    if not samples:
        raise HTTPException(status_code=409, detail="请先为这些任务生成盲化样本")
    groups = {s.sample_group_key for s in samples if s.sample_group_key}
    if not groups:
        raise HTTPException(status_code=409, detail="盲化样本缺少配对键，请重新生成样本")
    per_task_groups = [{s.sample_group_key for s in samples if s.task_id == task_id and s.sample_group_key} for task_id in payload.task_ids]
    if any(group_set != per_task_groups[0] for group_set in per_task_groups[1:]):
        raise HTTPException(status_code=422, detail="各算法任务的歌曲、声源或15秒时间片不一致，无法组成平衡实验批次")
    # Every expert receives the same exact sample set, preserving balanced comparison.
    experiment = BlindExperiment(name=payload.name.strip(), created_by=str(current_user.id))
    db.add(experiment)
    await db.flush()
    for sample in samples:
        sample.experiment_id = experiment.id
        for expert_id in set(experts):
            db.add(BlindAssignment(experiment_id=experiment.id, blind_sample_id=sample.id, expert_id=str(expert_id)))
    await db.commit()
    return {"experiment_id": str(experiment.id), "sample_count": len(samples), "expert_count": len(set(experts)), "group_count": len(groups)}


@router.get("/experiments")
async def list_blind_experiments(current_user: User = Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(BlindExperiment).order_by(BlindExperiment.created_at.desc()))
    return [{"id": str(item.id), "name": item.name, "status": item.status, "created_at": item.created_at} for item in result.scalars().all()]


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


@router.post("/generate")
async def generate_blind_samples(
    payload: GenerateBlindSamples,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    task = await db.get(SeparationTask, payload.task_id)
    if not task or task.status != TaskStatus.COMPLETED:
        raise HTTPException(status_code=409, detail="只能为已完成的真实分离任务生成盲化样本")
    result = await db.execute(select(StemFile).where(StemFile.task_id == task.id))
    stems = [item for item in result.scalars().all() if item.stem_name in set(payload.stem_names)]
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
            if not starts and payload.include_partial_tail and duration > 0:
                starts = [0.0]
            elif payload.include_partial_tail and duration % 15 > 0.05:
                starts.append(float(int(duration // 15) * 15))
            for start in starts[:payload.max_segments_per_stem]:
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
    except HTTPException:
        await db.rollback()
        for path in generated_paths:
            path.unlink(missing_ok=True)
        raise
    except Exception as exc:
        await db.rollback()
        for path in generated_paths:
            path.unlink(missing_ok=True)
        raise HTTPException(status_code=503, detail=f"盲化样本生成失败：{exc}") from exc
    return {"created_or_existing": len(created), "samples": created}


@router.get("")
async def list_blind_samples(
    stem_name: str | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(BlindSample)
    if stem_name:
        query = query.where(BlindSample.stem_name == stem_name)
    if current_user.role == Role.EXPERT:
        assigned = select(BlindAssignment.blind_sample_id).where(BlindAssignment.expert_id == str(current_user.id))
        query = query.where((BlindSample.experiment_id.is_(None)) | BlindSample.id.in_(assigned))
    result = await db.execute(query.order_by(BlindSample.created_at.desc()))
    samples = list(result.scalars().all())
    score_result = await db.execute(select(Score.blind_sample_id).where(Score.user_id == str(current_user.id), Score.blind_sample_id.isnot(None)))
    scored = {row[0] for row in score_result.all()}
    # 每位专家获得稳定但不同的伪随机顺序，避免按创建时间暴露算法批次。
    random.Random(f"blind-order:{current_user.id}").shuffle(samples)
    # 专家响应有意不包含 task_id、algorithm、真实文件名或原始时间位置。
    return [
        {
            "blind_code": item.blind_code,
            "stem_name": item.stem_name,
            "duration_seconds": 15.0,
            "audio_url": f"/api/blind-samples/{item.blind_code}/audio",
            "scored": item.id in scored,
        }
        for item in samples
    ]


@router.get("/{blind_code}/audio")
async def stream_blind_sample(
    blind_code: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role not in (Role.EXPERT, Role.ADMIN):
        raise HTTPException(status_code=403, detail="仅专家或管理员可试听盲化样本")
    result = await db.execute(select(BlindSample).where(BlindSample.blind_code == blind_code))
    sample = result.scalars().first()
    if not sample:
        raise HTTPException(status_code=404, detail="盲化样本不存在")
    if sample.experiment_id is not None:
        assignment = await db.execute(select(BlindAssignment).where(BlindAssignment.blind_sample_id == sample.id, BlindAssignment.expert_id == str(current_user.id)))
        if assignment.scalars().first() is None:
            raise HTTPException(status_code=403, detail="该样本未分配给当前专家")
    path = Path(sample.file_path)
    if not path.exists() or path.stat().st_size == 0:
        raise HTTPException(status_code=404, detail="盲化样本文件不存在")
    return FileResponse(path, media_type="audio/wav", filename="blind-sample.wav", headers={"Accept-Ranges": "bytes", "Cache-Control": "no-store"})


@router.get("/{blind_code}/analysis", response_model=AudioAnalysisPayload)
async def analyze_blind_sample(
    blind_code: str,
    waveform_points: int = 800,
    spec_freq_bins: int = 128,
    spec_time_bins: int = 256,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """返回盲化样本（15 秒片段）的波形与频谱，供专家可视化定位问题时间区间。

    与音频试听一致：仅对已分配的专家可见，响应不包含 task_id/algorithm/文件名等映射字段。
    """
    if current_user.role not in (Role.EXPERT, Role.ADMIN):
        raise HTTPException(status_code=403, detail="仅专家或管理员可查看盲化样本可视化")
    result = await db.execute(select(BlindSample).where(BlindSample.blind_code == blind_code))
    sample = result.scalars().first()
    if not sample:
        raise HTTPException(status_code=404, detail="盲化样本不存在")
    if sample.experiment_id is not None:
        assignment = await db.execute(select(BlindAssignment).where(BlindAssignment.blind_sample_id == sample.id, BlindAssignment.expert_id == str(current_user.id)))
        if assignment.scalars().first() is None:
            raise HTTPException(status_code=403, detail="该样本未分配给当前专家")
    path = Path(sample.file_path)
    if not path.exists() or path.stat().st_size == 0:
        raise HTTPException(status_code=404, detail="盲化样本文件不存在")
    wp = max(200, min(20000, int(waveform_points or 800)))
    sfreq = max(32, min(512, int(spec_freq_bins or 128)))
    stime = max(64, min(1024, int(spec_time_bins or 256)))
    try:
        analysis = analyze_audio_file(
            path,
            waveform_points=wp,
            spec_freq_bins=sfreq,
            spec_time_bins=stime,
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"盲化样本可视化分析失败：{exc}") from exc
    return AudioAnalysisPayload(**analysis_to_payload(analysis))


@router.post("/{blind_code}/objective-metrics")
async def calculate_clip_objective_metrics(
    blind_code: str,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """按任务已登记的金标准自动裁剪同一 15 秒区间并保存片段级指标。"""
    result = await db.execute(select(BlindSample).where(BlindSample.blind_code == blind_code))
    sample = result.scalars().first()
    if not sample:
        raise HTTPException(status_code=404, detail="盲化样本不存在")
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
            # 同一任务若已登记至少两个声源的金标准，则按完整多源 BSS Eval 计算；否则使用目标源两源近似。
            try:
                reference_paths = {name: Path(path) for name, path in references.items() if Path(path).exists()}
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
            except ValueError:
                raise
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"片段客观指标计算失败：{exc}") from exc
    # The clip is always 15 seconds long, but its position in the source task
    # must remain the original interval for pairing and export.
    values.update({"segment_start": float(sample.start_seconds), "segment_end": float(sample.end_seconds)})
    sample.objective_metrics_json = json.dumps(values, ensure_ascii=False)
    await db.commit()
    return {"blind_code": sample.blind_code, "stem_name": sample.stem_name, "metrics": values}


@router.post("/tasks/{task_id}/objective-metrics-clips")
async def calculate_task_clip_objective_metrics(
    task_id: int,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """自动处理任务下全部盲化片段，无需逐片段上传或手工裁剪金标准。"""
    result = await db.execute(select(BlindSample).where(BlindSample.task_id == task_id).order_by(BlindSample.start_seconds.asc()))
    samples = list(result.scalars().all())
    if not samples:
        raise HTTPException(status_code=404, detail="该任务没有盲化样本")
    completed = []
    failed = []
    for sample in samples:
        try:
            completed.append(await calculate_clip_objective_metrics(sample.blind_code, current_user, db))
        except HTTPException as exc:
            failed.append({"blind_code": sample.blind_code, "detail": exc.detail})
    return {"task_id": task_id, "total": len(samples), "completed": len(completed), "failed": failed, "items": completed}


@router.post("/score")
async def score_blind_sample(
    payload: BlindScoreCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role != Role.EXPERT:
        raise HTTPException(status_code=403, detail="仅专家可提交盲化评分")
    result = await db.execute(select(BlindSample).where(BlindSample.blind_code == payload.blind_code))
    sample = result.scalars().first()
    if not sample:
        raise HTTPException(status_code=404, detail="盲化样本不存在")
    if sample.experiment_id is not None:
        assignment_result = await db.execute(select(BlindAssignment).where(BlindAssignment.blind_sample_id == sample.id, BlindAssignment.expert_id == str(current_user.id)))
        if assignment_result.scalars().first() is None:
            raise HTTPException(status_code=403, detail="该样本未分配给当前专家")
    duplicate = await db.execute(select(Score).where(Score.user_id == str(current_user.id), Score.blind_sample_id == sample.id))
    if duplicate.scalars().first():
        raise HTTPException(status_code=409, detail="该盲化样本已经评分")
    score = Score(
        user_id=str(current_user.id),
        task_id=sample.task_id,
        blind_sample_id=sample.id,
        algorithm=sample.algorithm,
        stem_name=sample.stem_name,
        quality=payload.quality,
        interference=payload.interference,
        artifacts=payload.artifacts,
        overall_acceptability=payload.overall_acceptability,
        segment_start=payload.segment_start,
        segment_end=payload.segment_end,
        issue_tags=json.dumps(payload.issue_tags, ensure_ascii=False),
        issue_annotations=json.dumps(payload.issue_annotations, ensure_ascii=False),
        reliability=payload.reliability,
    )
    db.add(score)
    await db.commit()
    assignment_result = await db.execute(select(BlindAssignment).where(BlindAssignment.blind_sample_id == sample.id, BlindAssignment.expert_id == str(current_user.id)))
    assignment = assignment_result.scalars().first()
    if assignment:
        assignment.status = "completed"
        assignment.completed_at = datetime.now(timezone.utc)
        await db.commit()
    await db.refresh(score)
    # 专家侧只需要确认保存成功；绝不回传 task/algorithm 等映射字段。
    return {"id": str(score.id), "blind_code": sample.blind_code, "status": "saved"}


@router.post("/score-batch")
async def score_blind_samples_batch(
    payload: BlindScoreBatchCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """批量保存多个盲化样本评分；任一条重复或不存在时整体回滚。"""
    if current_user.role != Role.EXPERT:
        raise HTTPException(status_code=403, detail="仅专家可提交盲化评分")
    codes = [item.blind_code for item in payload.scores]
    if len(codes) != len(set(codes)):
        raise HTTPException(status_code=422, detail="批量评分中不能重复提交同一个盲化样本")
    result = await db.execute(select(BlindSample).where(BlindSample.blind_code.in_(codes)))
    samples = {item.blind_code: item for item in result.scalars().all()}
    if len(samples) != len(codes):
        missing = [code for code in codes if code not in samples]
        raise HTTPException(status_code=404, detail=f"盲化样本不存在：{', '.join(missing)}")
    assigned_result = await db.execute(select(BlindAssignment.blind_sample_id).where(BlindAssignment.expert_id == str(current_user.id), BlindAssignment.blind_sample_id.in_([item.id for item in samples.values()])))
    assigned_ids = {row[0] for row in assigned_result.all()}
    unassigned = [code for code, sample in samples.items() if sample.experiment_id is not None and sample.id not in assigned_ids]
    if unassigned:
        raise HTTPException(status_code=403, detail=f"样本未分配给当前专家：{', '.join(unassigned)}")
    duplicate_result = await db.execute(select(Score.blind_sample_id).where(Score.user_id == str(current_user.id), Score.blind_sample_id.in_([item.id for item in samples.values()])))
    duplicate_ids = {row[0] for row in duplicate_result.all()}
    if duplicate_ids:
        duplicate_codes = [code for code, sample in samples.items() if sample.id in duplicate_ids]
        raise HTTPException(status_code=409, detail=f"样本已经评分：{', '.join(duplicate_codes)}")
    created = []
    try:
        for item in payload.scores:
            sample = samples[item.blind_code]
            db.add(Score(user_id=str(current_user.id), task_id=sample.task_id, blind_sample_id=sample.id, algorithm=sample.algorithm, stem_name=sample.stem_name, quality=item.quality, interference=item.interference, artifacts=item.artifacts, overall_acceptability=item.overall_acceptability, segment_start=item.segment_start, segment_end=item.segment_end, issue_tags=json.dumps(item.issue_tags, ensure_ascii=False), issue_annotations=json.dumps(item.issue_annotations, ensure_ascii=False), reliability=item.reliability))
            created.append(item.blind_code)
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    assignment_result = await db.execute(
        select(BlindAssignment).where(
            BlindAssignment.expert_id == str(current_user.id),
            BlindAssignment.blind_sample_id.in_([samples[item.blind_code].id for item in payload.scores]),
        )
    )
    for assignment in assignment_result.scalars().all():
        assignment.status = "completed"
        assignment.completed_at = datetime.now(timezone.utc)
    await db.commit()
    return {"status": "saved", "count": len(created), "blind_codes": created}


@router.get("/admin/mapping")
async def get_blind_mapping(
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(BlindSample).order_by(BlindSample.created_at.desc()))
    return [
        {
            "blind_code": item.blind_code,
            "task_id": str(item.task_id),
            "algorithm": item.algorithm.value,
            "stem_name": item.stem_name,
            "source_start_seconds": item.start_seconds,
            "source_end_seconds": item.end_seconds,
        }
        for item in result.scalars().all()
    ]
