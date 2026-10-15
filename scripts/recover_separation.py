#!/usr/bin/env python3
"""分离跑批收尾：等待队列排空 → 复位两个卡住/失败的任务 → 重启后端重排队 → 确认完成。

背景：磁盘配额写满时，有两个任务被卡住：
  - 367277750198730752  BAND_SPLIT_ROFORMER  "Speak Softly - Like Horses"  残留 PROCESSING（无存活子进程，孤儿）
  - 367277750202925056  SCNET                "Speak Softly - Like Horses"  FAILED（磁盘配额 EDQUOT）
其余任务由双 worker 正常消化中。本脚本等它们全部跑完后，把上面两个复位成 PENDING，
再重启后端（start_backend.sh 看门狗会在 5s 内拉起），让 _restore_pending_tasks 重新入队。

用法：
    cd /mnt/wzp/AudioLab/backend
    .venv/bin/python /mnt/wzp/AudioLab/scripts/recover_separation.py
"""
from __future__ import annotations

import asyncio
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from sqlalchemy import text

from app.database import AsyncSessionLocal, engine

RETRY_IDS = (367277750198730752, 367277750202925056)  # BSR 孤儿 + SCNET 失败
SCNET_RESULTS = Path("/mnt/wzp/AudioLab/backend/results/367277750202925056")
DRAIN_TIMEOUT_S = 3 * 3600  # 排队排空最长等 3 小时


def log(msg: str) -> None:
    print(f"[{time.strftime('%F %T')}] {msg}", flush=True)


async def status_snapshot() -> dict:
    async with AsyncSessionLocal() as db:
        async def cnt(q, **p):
            r = await db.execute(text(q), p or None)
            return r.scalar() or 0

        pending = await cnt("SELECT COUNT(*) FROM separation_tasks WHERE batch_id IS NOT NULL AND status='PENDING'")
        # 排除两个待复位任务本身，只看“其它”还在跑的
        processing_other = await cnt(
            "SELECT COUNT(*) FROM separation_tasks WHERE batch_id IS NOT NULL AND status='PROCESSING' AND id NOT IN :ids",
            ids=RETRY_IDS,
        )
        completed = await cnt("SELECT COUNT(*) FROM separation_tasks WHERE status='COMPLETED'")
        failed = await cnt("SELECT COUNT(*) FROM separation_tasks WHERE status='FAILED'")
        total = await cnt("SELECT COUNT(*) FROM separation_tasks")
    return {"pending": pending, "processing_other": processing_other,
            "completed": completed, "failed": failed, "total": total}


def find_backend_pid() -> int | None:
    try:
        out = subprocess.run(
            ["pgrep", "-f", "python run_production.py"],
            capture_output=True, text=True, timeout=10,
        ).stdout.split()
        return int(out[0]) if out else None
    except Exception:
        return None


def kill_backend(pid: int) -> None:
    log(f"向后端 PID {pid} 发送 SIGTERM（看门狗 start_backend.sh 会在 5s 内拉起）...")
    os.kill(pid, signal.SIGTERM)


async def reset_retry_tasks() -> None:
    # 清理 SCNET 上次失败留下的半成品 stem（无 DB 引用，重跑会覆盖，先删避免脏数据/占空间）
    if SCNET_RESULTS.exists():
        for p in SCNET_RESULTS.iterdir():
            if p.is_dir():
                shutil.rmtree(p, ignore_errors=True)
            else:
                p.unlink(missing_ok=True)
        log(f"已清理 SCNET 失败任务的半成品目录：{SCNET_RESULTS}")

    async with AsyncSessionLocal() as db:
        for tid in RETRY_IDS:
            await db.execute(
                text("UPDATE separation_tasks SET status='PENDING', comment=NULL, updated_at=NOW() WHERE id=:id"),
                {"id": tid},
            )
        await db.commit()
    log(f"已将 {RETRY_IDS} 复位为 PENDING")


async def wait_tasks_terminal(ids: tuple[int, ...], timeout_s: int) -> bool:
    """等待给定任务全部到 COMPLETED/FAILED。"""
    start = time.time()
    while time.time() - start < timeout_s:
        async with AsyncSessionLocal() as db:
            r = await db.execute(
                text("SELECT id, status FROM separation_tasks WHERE id IN :ids"),
                {"ids": ids},
            )
            rows = {x[0]: x[1] for x in r.fetchall()}
        nonterm = [tid for tid in ids if rows.get(tid) not in ("COMPLETED", "FAILED")]
        if not nonterm:
            log(f"复位任务全部到终态：{rows}")
            return True
        log(f"复位任务进行中：{rows}")
        await asyncio.sleep(20)
    log(f"等待复位任务超时（{timeout_s}s），当前：{rows if 'rows' in dir() else '未知'}")
    return False


async def main() -> None:
    # ---------- 阶段 1：等排空 ----------
    log("阶段 1：等待分离队列排空（仅剩两个待复位任务时进入下一阶段）...")
    start = time.time()
    while True:
        s = await status_snapshot()
        log(f"  已完成 {s['completed']}/{s['total']}，排队 {s['pending']}，"
            f"处理中(其它) {s['processing_other']}，失败 {s['failed']}")
        if s["pending"] == 0 and s["processing_other"] == 0:
            log("队列已排空。")
            break
        if time.time() - start > DRAIN_TIMEOUT_S:
            log("等待排空超时，中止（需要人工介入）。")
            return
        await asyncio.sleep(30)

    # ---------- 阶段 2：复位两个任务 ----------
    await reset_retry_tasks()

    # ---------- 阶段 3：重启后端 ----------
    pid = find_backend_pid()
    if not pid:
        log("未找到后端进程，跳过重启（请确认 start_backend.sh 看门狗仍在运行）。")
    else:
        kill_backend(pid)
        # 等新后端起来：轮询到新 PID 且能查到任务被拾取
        log("等待新后端进程拉起...")
        new_pid = None
        for _ in range(60):
            await asyncio.sleep(5)
            np_ = find_backend_pid()
            if np_ and np_ != pid:
                new_pid = np_
                log(f"新后端 PID {new_pid} 已起来。")
                break
        if not new_pid:
            log("警告：5 分钟内未检测到新后端进程，稍后仍会尝试等任务完成。")

    # ---------- 阶段 4：等两个任务完成 ----------
    ok = await wait_tasks_terminal(RETRY_IDS, timeout_s=30 * 60)
    s = await status_snapshot()
    log(f"最终状态：完成 {s['completed']}/{s['total']}，失败 {s['failed']}，排队 {s['pending']}")
    log("RECOVER_DONE" if ok else "RECOVER_INCOMPLETE")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    finally:
        asyncio.run(engine.dispose())
