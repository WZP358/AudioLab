"""模型优化任务（S4 增量训练 / S101 剪枝 / S102 量化）的管理端点。"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Algorithm, ModelOptimizationJob, Role, User
from app.routers.auth import get_current_user
from app.services.optimization_service import compute_stem_loss_weights, launch_job

router = APIRouter(prefix="/api/optimization", tags=["optimization"])

_VALID_KINDS = {"incremental_training", "pruning", "quantization"}


class OptimizationJobCreate(BaseModel):
    kind: str = Field(..., description="incremental_training / pruning / quantization")
    algorithm: Optional[str] = Field(None, description="目标算法（可留空表示全部）")
    config: dict = Field(default_factory=dict, description="额外参数（epochs、learning_rate、runs、sparsity 等）")


def _serialize(job: ModelOptimizationJob) -> dict:
    return {
        "id": str(job.id),
        "kind": job.kind,
        "algorithm": job.algorithm.value if job.algorithm else None,
        "status": job.status,
        "created_by": job.created_by,
        "config": json.loads(job.config_json or "{}"),
        "output_path": job.output_path,
        "log_path": job.log_path,
        "error_message": job.error_message,
        "created_at": job.created_at,
        "started_at": job.started_at,
        "completed_at": job.completed_at,
    }


@router.get("/stem-weights")
async def get_stem_loss_weights(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """预览当前主观评分推导出的每声源定向损失权重（S4）。"""
    if current_user.role != Role.ADMIN:
        raise HTTPException(status_code=403, detail="仅管理员可查看损失权重")
    return {"weights": await compute_stem_loss_weights(db)}


@router.post("/jobs")
async def create_optimization_job(
    payload: OptimizationJobCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role != Role.ADMIN:
        raise HTTPException(status_code=403, detail="仅管理员可发起模型优化任务")
    if payload.kind not in _VALID_KINDS:
        raise HTTPException(status_code=422, detail=f"未知任务类型：{payload.kind}（可选：{', '.join(sorted(_VALID_KINDS))}）")
    if not payload.algorithm:
        raise HTTPException(status_code=422, detail="优化任务必须指定目标算法（algorithm）")
    algorithm = None
    if payload.algorithm:
        try:
            algorithm = Algorithm(payload.algorithm)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"未知算法：{payload.algorithm}")

    config = dict(payload.config or {})
    if payload.kind == "incremental_training":
        config["stem_loss_weights"] = await compute_stem_loss_weights(db)

    job = ModelOptimizationJob(
        kind=payload.kind,
        algorithm=algorithm,
        created_by=str(current_user.id),
        status="queued",
        config_json=json.dumps(config, ensure_ascii=False),
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    await launch_job(db, job)
    return _serialize(job)


@router.get("/jobs")
async def list_optimization_jobs(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role != Role.ADMIN:
        raise HTTPException(status_code=403, detail="仅管理员可查看优化任务")
    result = await db.execute(select(ModelOptimizationJob).order_by(ModelOptimizationJob.created_at.desc()).limit(200))
    return [_serialize(j) for j in result.scalars().all()]


@router.get("/jobs/{job_id}")
async def get_optimization_job(
    job_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role != Role.ADMIN:
        raise HTTPException(status_code=403, detail="仅管理员可查看优化任务")
    job = await db.get(ModelOptimizationJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="优化任务不存在")
    return _serialize(job)
