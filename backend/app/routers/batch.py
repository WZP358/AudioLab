"""批量分离：同一首混合音频一次性投给多个算法，全部完成后自动编排盲化样本/客观指标/实验批次。

解决「为什么必须管理员手动生成盲化样本」——上传时即登记金标准，任务跑完后无需人工干预。
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Algorithm, Role, SeparationBatch, SeparationTask, TaskStatus, User
from app.routers.auth import get_current_user
from app.services.queue_manager import TaskQueueManager

router = APIRouter(prefix="/api/separation-batches", tags=["separation-batches"])

_base_dir = Path(__file__).resolve().parents[1]
_UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "uploads"))
if not _UPLOAD_DIR.is_absolute():
    _UPLOAD_DIR = _base_dir / _UPLOAD_DIR
_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

_RESULTS_DIR = Path(os.getenv("RESULTS_DIR", "results"))
if not _RESULTS_DIR.is_absolute():
    _RESULTS_DIR = _base_dir / _RESULTS_DIR
_RESULTS_DIR.mkdir(parents=True, exist_ok=True)

# 金标准上传文件名 -> stem_name 的映射
_GOLD_STEM_MAP = {
    "vocals_file": "Vocals",
    "drums_file": "Drums",
    "bass_file": "Bass",
    "other_file": "Other",
}


def _parse_algorithms(raw: str) -> list[Algorithm]:
    names = [part.strip() for part in (raw or "").split(",") if part.strip()]
    if not names:
        raise HTTPException(status_code=422, detail="至少指定一个算法")
    result: list[Algorithm] = []
    for name in names:
        try:
            result.append(Algorithm(name))
        except ValueError:
            valid = [a.value for a in Algorithm]
            raise HTTPException(status_code=422, detail=f"未知算法：{name}（可选：{', '.join(valid)}）")
    return result


def _serialize_batch(batch: SeparationBatch) -> dict:
    return {
        "id": str(batch.id),
        "created_by": batch.created_by,
        "original_filename": batch.original_filename,
        "algorithms": json.loads(batch.algorithms_json or "[]"),
        "status": batch.status,
        "auto_blind": batch.auto_blind,
        "auto_objective": batch.auto_objective,
        "auto_experiment": batch.auto_experiment,
        "experiment_id": str(batch.experiment_id) if batch.experiment_id else None,
        "error_message": batch.error_message,
        "created_at": batch.created_at,
        "completed_at": batch.completed_at,
    }


@router.post("")
async def create_separation_batch(
    file: UploadFile = File(...),
    algorithms: str = Form(...),
    vocals_file: Optional[UploadFile] = File(None),
    drums_file: Optional[UploadFile] = File(None),
    bass_file: Optional[UploadFile] = File(None),
    other_file: Optional[UploadFile] = File(None),
    auto_blind: bool = Form(True),
    auto_objective: bool = Form(True),
    auto_experiment: bool = Form(True),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """创建批量分离任务：同一首混合音频 + 多个算法，可选登记 4 个金标准声源。

    金标准登记后，全部算法任务完成后会自动：
    生成 15 秒盲化样本 → 计算片段级 SDR 等客观指标 → 创建平衡实验批次 → 分配给全部有效专家。
    """
    algo_list = _parse_algorithms(algorithms)
    if len(algo_list) < 2:
        raise HTTPException(status_code=422, detail="批量分离需要至少两种不同算法（用于配对对比实验）")

    user_id = str(current_user.id)

    # 1) 保存混合音频（所有任务共享同一份）
    file_ext = Path(file.filename or "mix.wav").suffix or ".wav"
    mix_id = uuid.uuid4().hex
    mix_path = _UPLOAD_DIR / f"{mix_id}{file_ext}"
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="混合音频为空")
    mix_path.write_bytes(content)

    try:
        batch = SeparationBatch(
            created_by=user_id,
            original_filename=file.filename,
            algorithms_json=json.dumps([a.value for a in algo_list], ensure_ascii=False),
            status="running",
            auto_blind=auto_blind,
            auto_objective=auto_objective,
            auto_experiment=auto_experiment,
        )
        db.add(batch)
        await db.flush()

        # 2) 保存金标准声源（若提供）
        reference_paths: dict[str, str] = {}
        gold_files = {
            "vocals_file": vocals_file,
            "drums_file": drums_file,
            "bass_file": bass_file,
            "other_file": other_file,
        }
        ref_dir = _RESULTS_DIR / f"batch_{batch.id}" / "refs"
        ref_dir.mkdir(parents=True, exist_ok=True)
        for field, stem in _GOLD_STEM_MAP.items():
            upload = gold_files.get(field)
            if upload is None:
                continue
            data = await upload.read()
            if not data:
                continue
            ext = Path(upload.filename or f"{stem}.wav").suffix or ".wav"
            dest = ref_dir / f"{stem}{ext}"
            dest.write_bytes(data)
            reference_paths[stem] = str(dest)

        # 3) 为每个算法创建子任务
        task_ids: list[int] = []
        for algo in algo_list:
            metadata = {"batch_id": str(batch.id)}
            if reference_paths:
                metadata["reference_paths"] = reference_paths
            task = SeparationTask(
                user_id=user_id,
                original_filename=file.filename,
                file_path=str(mix_path),
                algorithm=algo,
                batch_id=batch.id,
                status=TaskStatus.PENDING,
                metadata_json=json.dumps(metadata, ensure_ascii=False),
            )
            db.add(task)
            await db.flush()
            task_ids.append(task.id)

        await db.commit()
        batch_id = batch.id

        # 4) 全部入队（每个子任务带各自的算法）
        queue_manager = await TaskQueueManager.get_instance()
        for tid, algo in zip(task_ids, algo_list):
            await queue_manager.add_task(tid, str(mix_path), algo)
    except Exception as exc:
        await db.rollback()
        mix_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"批量任务创建失败：{exc}") from exc

    return {
        "batch_id": str(batch_id),
        "task_ids": [str(t) for t in task_ids],
        "algorithms": [a.value for a in algo_list],
        "reference_stems": list(reference_paths.keys()),
    }


@router.get("")
async def list_separation_batches(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(SeparationBatch).order_by(SeparationBatch.created_at.desc())
    if current_user.role != Role.ADMIN:
        query = query.where(SeparationBatch.created_by == str(current_user.id))
    result = await db.execute(query)
    return [_serialize_batch(b) for b in result.scalars().all()]


@router.get("/{batch_id}")
async def get_separation_batch(
    batch_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    batch = await db.get(SeparationBatch, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="批量任务不存在")
    if current_user.role != Role.ADMIN and batch.created_by != str(current_user.id):
        raise HTTPException(status_code=403, detail="无权查看该批量任务")
    result = await db.execute(select(SeparationTask).where(SeparationTask.batch_id == batch_id).order_by(SeparationTask.created_at.asc()))
    tasks = list(result.scalars().all())
    data = _serialize_batch(batch)
    data["tasks"] = [
        {
            "task_id": str(t.id),
            "algorithm": t.algorithm.value if t.algorithm else None,
            "status": t.status.value if t.status else None,
            "sdr": t.sdr,
            "sir": t.sir,
            "sar": t.sar,
            "created_at": t.created_at,
            "completed_at": t.completed_at,
        }
        for t in tasks
    ]
    return data
