"""S4 增量训练 / S101 结构化剪枝 / S102 量化的任务编排与「单源定向加权损失」权重计算。

真实可验证的部分：
- compute_stem_loss_weights：从主观评分计算每个「算法 × 声源」的定向损失权重（评分越低权重越高）；
- 后台 job 启动/状态跟踪：通过 subprocess 调用 MSS 框架脚本，记录日志与产物路径。

需 GPU 长耗时、无法在本会话内验证有效性的部分（增量训练/剪枝/量化本身）：
- 由 launch_job 调用 MSS 仓库脚本（train.py 及 audiolab_optimize.py），属于研究级操作，
  需真实训练数据与多轮实验验证，此处提供完整编排链路与调用入口。
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ModelOptimizationJob, Score, Algorithm, Role

# MSS 仓库根目录 + 运行其脚本的解释器（与分离引擎共用 mss 环境）
MSS_ROOT = Path(os.getenv("MSS_ROOT_DIR", "/mnt/wzp/AudioLab/Music-Source-Separation-Training-main"))
MSS_PYTHON = os.getenv("MSS_PYTHON", "/mnt/wzp/miniconda3/envs/mss/bin/python")
OPT_LOG_DIR = Path(os.getenv("RESULTS_DIR", "/mnt/wzp/AudioLab/backend/results")) / "optimization"

_STEMS = ["Vocals", "Drums", "Bass", "Other"]


async def compute_stem_loss_weights(db: AsyncSession) -> dict:
    """从主观评分计算「单源定向加权损失函数」的每声源权重。

    规则：某声源主观质量越低（quality/interference/artifacts/overall_acceptability 均值越低），
    其损失权重越高，使增量训练更侧重于修复该声源的缺陷。

    返回 {"Vocals": 1.35, "Drums": 1.0, ...}（基准权重 1.0）。
    """
    result = await db.execute(select(Score).where(Score.is_deleted.is_(False)))
    scores = list(result.scalars().all())
    per_stem: dict[str, list[float]] = {}
    for s in scores:
        stem = s.stem_name or "Other"
        values = [s.quality, s.interference, s.artifacts, s.overall_acceptability]
        present = [float(v) for v in values if v is not None and 1 <= float(v) <= 5]
        if present:
            per_stem.setdefault(stem, []).append(sum(present) / len(present))

    weights: dict[str, float] = {}
    for stem in _STEMS:
        vals = per_stem.get(stem, [])
        if not vals:
            weights[stem] = 1.0
            continue
        mean = sum(vals) / len(vals)
        # 评分越低权重越高：5 分 -> 1.0，1 分 -> 2.0，线性映射
        weights[stem] = round(1.0 + (5.0 - mean) / 4.0, 4)
    return weights


def _write_config(config: dict) -> Path:
    OPT_LOG_DIR.mkdir(parents=True, exist_ok=True)
    fd, path = tempfile.mkstemp(prefix="opt_", suffix=".json", dir=str(OPT_LOG_DIR))
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    return Path(path)


async def launch_job(db: AsyncSession, job: ModelOptimizationJob) -> None:
    """在后台执行优化任务（增量训练/剪枝/量化），更新状态与日志。"""
    job.status = "running"
    job.started_at = datetime.now(timezone.utc)
    log_path = OPT_LOG_DIR / f"job_{job.id}.log"
    OPT_LOG_DIR.mkdir(parents=True, exist_ok=True)
    job.log_path = str(log_path)
    await db.commit()

    def _run():
        try:
            config = json.loads(job.config_json or "{}")
            script = MSS_ROOT / "audiolab_optimize.py"
            if not script.exists():
                raise FileNotFoundError(f"缺少优化脚本：{script}")
            cmd = [MSS_PYTHON, str(script), "--kind", job.kind]
            if job.algorithm:
                cmd += ["--algorithm", job.algorithm.value]
            cmd += ["--config", str(_write_config(config))]
            cmd += ["--job-id", str(job.id)]
            with open(log_path, "w", encoding="utf-8") as logf:
                proc = subprocess.run(cmd, cwd=str(MSS_ROOT), stdout=logf, stderr=subprocess.STDOUT, timeout=config.get("timeout_seconds", 6 * 3600))
            return proc.returncode, None
        except Exception as exc:
            return None, f"{type(exc).__name__}: {exc}"

    async def _runner():
        loop = asyncio.get_event_loop()
        code, err = await loop.run_in_executor(None, _run)
        from app.database import AsyncSessionLocal
        async with AsyncSessionLocal() as session:
            fresh = await session.get(ModelOptimizationJob, job.id)
            if fresh is None:
                return
            if err is not None:
                fresh.status = "failed"
                fresh.error_message = err
            elif code != 0:
                fresh.status = "failed"
                fresh.error_message = f"优化脚本退出码 {code}，详见日志 {fresh.log_path}"
            else:
                fresh.status = "completed"
                fresh.output_path = str(OPT_LOG_DIR / f"job_{job.id}")
            fresh.completed_at = datetime.now(timezone.utc)
            await session.commit()

    asyncio.create_task(_runner())
