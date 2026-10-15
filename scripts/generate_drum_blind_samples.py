#!/usr/bin/env python3
"""为全部 50 首 × 4 算法（已完成分离的 batch 任务）生成每首 1 段的鼓声盲化样本，
用于重新导出完整的鼓声离线评分包（覆盖范围按用户选择「全50首×4算法，每首1段」）。

步骤：
  1. 清理旧的 Drums 盲化样本（都是 batch_id=None 的 legacy 试点任务，"mixture.wav"）。
  2. 对每个 COMPLETED 的 batch 任务调用 generate_blind_samples_for_task(stem_names=["Drums"],
     max_segments_per_stem=1)，即每任务只取第一个 15 秒片段（start=0）。

用法：
    cd /mnt/wzp/AudioLab/backend
    .venv/bin/python /mnt/wzp/AudioLab/scripts/generate_drum_blind_samples.py
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from sqlalchemy import select

from app.database import AsyncSessionLocal, engine
from app.models import BlindSample, SeparationTask, TaskStatus
from app.services.blind_sample_service import generate_blind_samples_for_task


async def main() -> None:
    async with AsyncSessionLocal() as db:
        # 1. 清理旧的 Drums 盲化样本（legacy 试点，batch_id=None）
        r = await db.execute(select(BlindSample).where(BlindSample.stem_name == "Drums"))
        old = list(r.scalars().all())
        for s in old:
            p = Path(s.file_path)
            if p.exists():
                p.unlink(missing_ok=True)
            await db.delete(s)
        await db.commit()
        print(f"已清理旧 Drums 盲化样本 {len(old)} 条", flush=True)

        # 2. 找出所有已完成的 batch 任务
        r = await db.execute(
            select(SeparationTask).where(
                SeparationTask.batch_id.isnot(None),
                SeparationTask.status == TaskStatus.COMPLETED,
            )
        )
        tasks = list(r.scalars().all())
        print(f"待生成鼓声样本的任务数：{len(tasks)}", flush=True)

        ok = 0
        fail = 0
        for i, t in enumerate(tasks, 1):
            try:
                res = await generate_blind_samples_for_task(
                    db, t.id, stem_names=["Drums"], max_segments_per_stem=1
                )
                ok += res["created_or_existing"]
            except Exception as e:  # noqa: BLE001
                fail += 1
                print(f"  [{i}/{len(tasks)}] 任务 {t.id} 失败：{e}", flush=True)
            if i % 25 == 0 or i == len(tasks):
                print(f"  [{i}/{len(tasks)}] 累计成功 {ok} 段，失败 {fail}", flush=True)

    await engine.dispose()
    print(f"\n完成：成功 {ok} 段 / 失败 {fail}")


if __name__ == "__main__":
    asyncio.run(main())
