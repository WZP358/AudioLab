#!/usr/bin/env python3
"""监控一次批量分离的进度，全部到终态后打印汇总并退出。

读取 separation_run_*.json 里的所有 task_id，每 60 秒查询一次状态，
当所有任务到终态（COMPLETED/FAILED）后输出汇总。作为后台任务运行时，
退出后会让调用方得到通知（便于自动衔接下一步客观指标计算）。

用法：
    cd /mnt/wzp/AudioLab/backend
    .venv/bin/python /mnt/wzp/AudioLab/scripts/monitor_separation.py \
        --run /mnt/wzp/datasets/musdb18_test/separation_run_xxx.json \
        [--interval 60]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from sqlalchemy import text

from app.database import AsyncSessionLocal, engine


async def poll(run_path: Path, interval: int) -> None:
    run = json.loads(run_path.read_text(encoding="utf-8"))
    task_ids: list[int] = []
    for b in run.get("batches", []):
        for tid in b.get("task_map", {}).values():
            task_ids.append(int(tid))
    if not task_ids:
        print("run 里没有任务", file=sys.stderr, flush=True)
        return
    total = len(task_ids)
    print(f"监控 {total} 个任务，每 {interval}s 查询一次", flush=True)

    async with AsyncSessionLocal() as db:
        while True:
            r = await db.execute(
                text("SELECT status, COUNT(*) FROM separation_tasks WHERE id IN :ids GROUP BY status"),
                {"ids": tuple(task_ids)},
            )
            counts = {row[0]: row[1] for row in r.fetchall()}
            comp = counts.get("COMPLETED", 0)
            fail = counts.get("FAILED", 0)
            proc = counts.get("PROCESSING", 0)
            pend = counts.get("PENDING", 0)
            print(f"[monitor] 完成 {comp}/{total}，失败 {fail}，处理中 {proc}，排队 {pend}", flush=True)
            if comp + fail >= total:
                print(f"ALL_DONE 完成={comp} 失败={fail} 总计={total}", flush=True)
                break
            await asyncio.sleep(interval)


async def _main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--interval", type=int, default=60)
    args = ap.parse_args()
    try:
        await poll(Path(args.run), args.interval)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(_main())
