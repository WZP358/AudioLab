#!/usr/bin/env python3
"""从数据库重建 separation_run_*.json（原文件在磁盘清理时被删）。

compute_objective_metrics.py 依赖 run JSON 里的 track/task_map；这里直接按 batch 分组
从 separation_batches + separation_tasks 重建，输出与 run_testset_separation.py 相同结构。

用法：
    cd /mnt/wzp/AudioLab/backend
    .venv/bin/python /mnt/wzp/AudioLab/scripts/reconstruct_run.py \
        --out /mnt/wzp/AudioLab/scripts/separation_run_reconstructed.json
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from sqlalchemy import text

from app.database import AsyncSessionLocal, engine


async def reconstruct() -> list[dict]:
    batches: list[dict] = []
    async with AsyncSessionLocal() as db:
        r = await db.execute(
            text("SELECT id, original_filename, algorithms_json FROM separation_batches ORDER BY id")
        )
        for bid, orig, algos_json in r.fetchall():
            # track 名 = original_filename 去掉 "_mixture.wav" 后缀
            track = (orig or "")
            if track.endswith("_mixture.wav"):
                track = track[: -len("_mixture.wav")]
            r2 = await db.execute(
                text("SELECT id, algorithm FROM separation_tasks WHERE batch_id=:bid ORDER BY id"),
                {"bid": bid},
            )
            task_map = {algo: tid for tid, algo in r2.fetchall()}
            batches.append({
                "track": track,
                "batch_id": str(bid),
                "task_map": task_map,
            })
    return batches


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/mnt/wzp/AudioLab/scripts/separation_run_reconstructed.json")
    args = ap.parse_args()

    batches = asyncio.run(_run())
    record = {"created_at": datetime.now(timezone.utc).isoformat(), "batches": batches}
    out = Path(args.out)
    out.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")

    total_tasks = sum(len(b["task_map"]) for b in batches)
    print(f"重建完成：{len(batches)} 个 batch，共 {total_tasks} 个任务 → {out}")
    # 打印每个 batch 的 track 与任务数，便于核对
    for b in batches:
        print(f"  {b['track']}: {len(b['task_map'])} 任务")


async def _run() -> list[dict]:
    try:
        return await reconstruct()
    finally:
        await engine.dispose()


if __name__ == "__main__":
    main()
