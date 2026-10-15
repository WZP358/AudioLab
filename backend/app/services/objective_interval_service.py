"""客观指标误差区间（S23）、可靠性分级（S24/S25）与主动学习样本选择（S131/S132）。

专利口径：
- S23 要求「多次重复推理统计标准差和置信区间作为误差区间」；
- S24/S25 要求按误差区间大小标记可靠性（高/中/低）并以颜色编码显示；
- S131/S132 要求用不确定性选取 K 个样本交给专家。

工程实现说明（重要）：
分离模型是确定性的，同一输入重复推理输出完全一致，std 恒为 0。因此这里采用
「同一任务内所有 15 秒片段的指标分布」作为误差区间的来源——它反映模型在不同
时间片上的稳定性，是真正有区分度的不确定性度量。若确需字面上的重复推理，
可对同一输入多次推理后取指标（见 metadata 的 repeated_runs 字段扩展点）。
"""
from __future__ import annotations

import json
import math
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import BlindSample, SeparationTask

# 指标名（与盲化片段 objective_metrics_json 中一致）
_METRIC_KEYS = ["sdr", "sir", "sar", "si_sdr"]


def reliability_grade(cv: Optional[float]) -> str:
    """按相对标准差（变异系数 CV）标记可靠性：高（≤10%）、中（≤30%）、低（>30%）。"""
    if cv is None or (isinstance(cv, float) and not math.isfinite(cv)):
        return "低"
    if cv <= 0.10:
        return "高"
    if cv <= 0.30:
        return "中"
    return "低"


def reliability_color(grade: str) -> str:
    return {"高": "#10b981", "中": "#f59e0b", "低": "#ef4444"}.get(grade, "#94a3b8")


def _mean_std(values: list[float]) -> tuple[Optional[float], Optional[float], Optional[float], Optional[float], Optional[float]]:
    """返回 (mean, std, cv, ci95_low, ci95_high)。样本 <2 时 CI 为 None。"""
    n = len(values)
    if n == 0:
        return None, None, None, None, None
    mean = sum(values) / n
    if n == 1:
        return mean, 0.0, 0.0, None, None
    variance = sum((v - mean) ** 2 for v in values) / (n - 1)
    std = math.sqrt(variance)
    cv = (std / abs(mean)) if mean else None
    # 95% 置信区间（t 分布近似：小样本用 n-1 自由度的 t 值，简化用 1.96 且样本≥2 时按 std/sqrt(n)）
    se = std / math.sqrt(n)
    ci_low = mean - 1.96 * se
    ci_high = mean + 1.96 * se
    return mean, std, cv, ci_low, ci_high


async def compute_task_error_interval(db: AsyncSession, task_id: int) -> dict:
    """聚合任务内所有 15 秒片段指标，计算每声源各指标的均值/标准差/95%CI/可靠性等级。

    结果写入 SeparationTask.metadata_json['objective_error_interval'] 并返回。
    """
    task = await db.get(SeparationTask, task_id)
    if not task:
        raise ValueError(f"任务 {task_id} 不存在")
    result = await db.execute(select(BlindSample).where(BlindSample.task_id == task_id))
    samples = list(result.scalars().all())
    if not samples:
        raise ValueError("该任务没有盲化片段，请先生成 15 秒样本并计算片段客观指标")

    per_stem: dict[str, dict[str, list[float]]] = {}
    for sample in samples:
        try:
            metrics = json.loads(sample.objective_metrics_json or "{}")
        except Exception:
            metrics = {}
        stem = sample.stem_name or "ALL"
        bucket = per_stem.setdefault(stem, {key: [] for key in _METRIC_KEYS})
        for key in _METRIC_KEYS:
            v = metrics.get(key)
            if v is not None:
                try:
                    bucket[key].append(float(v))
                except (TypeError, ValueError):
                    continue

    interval = {}
    for stem, bucket in per_stem.items():
        interval[stem] = {}
        for key in _METRIC_KEYS:
            mean, std, cv, ci_low, ci_high = _mean_std(bucket[key])
            interval[stem][key] = {
                "n_segments": len(bucket[key]),
                "mean": mean,
                "std": std,
                "cv": cv,
                "ci95_low": ci_low,
                "ci95_high": ci_high,
                "reliability": reliability_grade(cv),
            }

    meta = {}
    try:
        meta = json.loads(task.metadata_json or "{}")
        if not isinstance(meta, dict):
            meta = {}
    except Exception:
        meta = {}
    meta["objective_error_interval"] = interval
    task.metadata_json = json.dumps(meta, ensure_ascii=False)
    await db.commit()
    return {"task_id": task_id, "objective_error_interval": interval}


def _task_uncertainty(task: SeparationTask) -> float:
    """任务级不确定性：取所有声源 SDR 变异系数（CV）的最大值，作为主动学习排序分数。

    CV 越高说明该任务在不同时间片上的分离质量越不稳定，越值得专家人工复核。
    """
    try:
        meta = json.loads(task.metadata_json or "{}")
    except Exception:
        meta = {}
    interval = meta.get("objective_error_interval") or {}
    max_cv = 0.0
    for stem_data in interval.values():
        sdr = stem_data.get("sdr") or {}
        cv = sdr.get("cv")
        if cv is not None and isinstance(cv, (int, float)) and math.isfinite(cv):
            max_cv = max(max_cv, float(cv))
    return max_cv


async def recommend_uncertain_tasks(db: AsyncSession, k: int = 5, algorithm: Optional[str] = None) -> list[dict]:
    """主动学习（S132）：按不确定性（片段 SDR 变异系数）降序，选取前 K 个任务提交专家复评。"""
    k = max(1, min(1000, int(k or 5)))
    query = select(SeparationTask).where(SeparationTask.metadata_json.isnot(None))
    if algorithm:
        query = query.where(SeparationTask.algorithm == algorithm)
    result = await db.execute(query)
    tasks = list(result.scalars().all())
    scored = []
    for t in tasks:
        cv = _task_uncertainty(t)
        scored.append((cv, t))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    top = scored[:k]
    return [
        {
            "task_id": str(t.id),
            "algorithm": t.algorithm.value if t.algorithm else None,
            "original_filename": t.original_filename,
            "uncertainty_score": round(cv, 6),
            "recommend_expert_review": cv > 0.30,
        }
        for cv, t in top
        if cv > 0
    ]
