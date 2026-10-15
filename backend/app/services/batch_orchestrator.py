"""批量分离完成后的自动编排：生成盲化样本 → 片段客观指标 → 平衡实验批次 → 分配专家。

设计要点：
- 由 separation_service.process_separation 在任务完成后调用 maybe_finalize_batch(task_id)；
- 幂等：仅当批量状态为 running 且所有子任务已结束（全部 COMPLETED）时才触发；
- 任一步骤失败仅记录日志，不阻断其它步骤与批量收尾，便于后续人工补齐。
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import SeparationBatch, SeparationTask, TaskStatus
from app.services.blind_sample_service import (
    generate_blind_samples_for_task,
    compute_task_clip_objective_metrics,
    create_experiment_for_tasks,
)

logger = logging.getLogger(__name__)


async def maybe_finalize_batch(task_id: int) -> None:
    """单个分离任务完成后调用；若其所属批量任务全部完成则自动编排（幂等，不抛异常）。"""
    try:
        async with AsyncSessionLocal() as db:
            task = await db.get(SeparationTask, task_id)
            if not task or task.batch_id is None:
                return
            batch = await db.get(SeparationBatch, task.batch_id)
            if not batch or batch.status != "running":
                return

            tasks_result = await db.execute(select(SeparationTask).where(SeparationTask.batch_id == batch.id))
            tasks = list(tasks_result.scalars().all())

            # 仍有任务在跑/排队，未到收尾时机
            if any(t.status in (TaskStatus.PENDING, TaskStatus.PROCESSING) for t in tasks):
                return

            if any(t.status == TaskStatus.FAILED for t in tasks):
                batch.status = "failed"
                batch.error_message = "批量中存在失败任务，未自动生成盲化样本"
                batch.completed_at = datetime.now(timezone.utc)
                await db.commit()
                return

            task_ids = [t.id for t in tasks if t.status == TaskStatus.COMPLETED]
            if len({t.algorithm for t in tasks}) < 2:
                # 单算法批量无需配对实验，直接收尾
                batch.status = "completed"
                batch.completed_at = datetime.now(timezone.utc)
                await db.commit()
                return

            logger.info("[批量 %s] 全部 %d 个任务完成，开始自动编排", batch.id, len(task_ids))

            if batch.auto_blind:
                for tid in task_ids:
                    try:
                        await generate_blind_samples_for_task(db, tid)
                    except Exception as exc:
                        logger.warning("[批量 %s] 任务 %s 盲化样本生成失败：%s", batch.id, tid, exc)

            if batch.auto_objective:
                for tid in task_ids:
                    try:
                        await compute_task_clip_objective_metrics(db, tid)
                    except Exception as exc:
                        logger.warning("[批量 %s] 任务 %s 片段客观指标计算失败：%s", batch.id, tid, exc)

            if batch.auto_experiment:
                try:
                    exp = await create_experiment_for_tasks(
                        db,
                        task_ids,
                        f"自动对比实验-{batch.original_filename or batch.id}",
                        batch.created_by,
                    )
                    batch.experiment_id = int(exp["experiment_id"])
                except Exception as exc:
                    logger.warning("[批量 %s] 平衡实验批次创建失败：%s", batch.id, exc)

            batch.status = "completed"
            batch.completed_at = datetime.now(timezone.utc)
            await db.commit()
            logger.info("[批量 %s] 自动编排完成", batch.id)
    except Exception:
        # 编排异常绝不应影响任务本身的完成状态
        logger.exception("[批量编排] 任务 %s 完成后的自动编排发生异常", task_id)
