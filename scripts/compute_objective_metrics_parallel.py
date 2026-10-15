#!/usr/bin/env python3
"""并行计算批量分离的 BSS Eval v3 客观指标（多进程，比串行脚本快 ~N 倍）。

与 compute_objective_metrics.py 产出相同结构的 CSV + JSON，但用 ProcessPoolExecutor
并行计算（BSS Eval 是纯 numpy CPU 计算，机器有 104 核，并行收益很大）。

用法：
    cd /mnt/wzp/AudioLab/backend
    .venv/bin/python /mnt/wzp/AudioLab/scripts/compute_objective_metrics_parallel.py \
        --run /mnt/wzp/AudioLab/scripts/separation_run_reconstructed.json \
        [--workers 16] [--out out.csv]
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import json
import os
import sys

# 多进程下避免 BLAS 过度订阅（每个 worker 单线程，靠进程数并行）
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("NUMEXPR_NUM_THREADS", "1")
os.environ.setdefault("VECLIB_MAXIMUM_THREADS", "1")
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from sqlalchemy import text

from app.database import AsyncSessionLocal, engine

STEMS = ["Vocals", "Drums", "Bass", "Other"]


# ---------- 子进程 worker（模块级，需可 pickle）----------
def _compute_one(item: dict) -> dict:
    from app.services.objective_metrics_multisource import compute_bss_metrics_multisource

    track, algo, task_id = item["track"], item["algorithm"], item["task_id"]
    estimates = {s: Path(item["estimates"][s]) for s in STEMS if s in item["estimates"]}
    references = {s: Path(item["references"][s]) for s in STEMS if s in item["references"]}
    if set(estimates) != set(references):
        return {"track": track, "algorithm": algo, "task_id": task_id, "error": "源集合不匹配"}
    try:
        m = compute_bss_metrics_multisource(
            mixture_path=Path(item["mixture"]), estimates=estimates, references=references
        )
    except Exception as e:  # noqa: BLE001
        return {"track": track, "algorithm": algo, "task_id": task_id, "error": str(e)}

    row = {"track": track, "algorithm": algo, "task_id": task_id}
    for s in STEMS:
        mm = m.metrics_by_source[s]
        row[f"{s}_SDR"] = round(mm["sdr"], 3)
        row[f"{s}_SIR"] = round(mm["sir"], 3)
        row[f"{s}_SAR"] = round(mm["sar"], 3)
    row["avg_SDR"] = round(m.get_average_sdr(), 3)
    row["avg_SIR"] = round(m.get_average_sir(), 3)
    row["avg_SAR"] = round(m.get_average_sar(), 3)
    return row


async def collect_items(run_path: Path) -> list[dict]:
    run = json.loads(run_path.read_text(encoding="utf-8"))
    items: list[dict] = []
    async with AsyncSessionLocal() as db:
        for b in run.get("batches", []):
            track = b.get("track")
            for algo, task_id in b.get("task_map", {}).items():
                task_id = int(task_id)
                r = await db.execute(
                    text("SELECT file_path, metadata_json FROM separation_tasks WHERE id=:id"),
                    {"id": task_id},
                )
                row = r.first()
                if not row:
                    items.append({"track": track, "algorithm": algo, "task_id": task_id, "error": "任务不存在"})
                    continue
                file_path, metadata_json = row
                try:
                    refs = json.loads(metadata_json or "{}").get("reference_paths", {})
                except (TypeError, ValueError):
                    refs = {}
                r2 = await db.execute(
                    text("SELECT stem_name, file_path FROM stem_files WHERE task_id=:id"),
                    {"id": task_id},
                )
                est = {s: p for s, p in r2.fetchall()}
                items.append({
                    "track": track, "algorithm": algo, "task_id": task_id,
                    "mixture": file_path, "references": refs, "estimates": est,
                })
    return items


async def _run(run_path: Path, workers: int, out_csv: Path) -> None:
    items = await collect_items(run_path)
    print(f"共 {len(items)} 个任务待计算，workers={workers}", flush=True)

    # 直接带 error 的项（缺任务记录）跳过计算
    todo = [it for it in items if "error" not in it]
    rows = [it for it in items if "error" in it]

    done = 0
    with ProcessPoolExecutor(max_workers=workers) as pool:
        for row in pool.map(_compute_one, todo, chunksize=4):
            done += 1
            rows.append(row)
            if "error" in row:
                print(f"[{done}/{len(todo)}] {row['track']} / {row['algorithm']}: ERROR {row['error']}", flush=True)
            else:
                print(f"[{done}/{len(todo)}] {row['track']} / {row['algorithm']}: avg SDR={row['avg_SDR']}", flush=True)

    # 写 CSV + JSON
    fields = ["track", "algorithm", "task_id", "error"] + [
        f"{s}_{k}" for s in STEMS for k in ("SDR", "SIR", "SAR")
    ] + ["avg_SDR", "avg_SIR", "avg_SAR"]
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for row in rows:
            w.writerow(row)
    json_path = out_csv.with_suffix(".json")
    json_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")

    ok = [r for r in rows if "avg_SDR" in r]
    err = [r for r in rows if "error" in r]
    print(f"\n完成：{len(ok)} 成功 / {len(err)} 失败。CSV -> {out_csv}  JSON -> {json_path}")

    if ok:
        from collections import defaultdict
        import statistics
        by_algo = defaultdict(list)
        for r in ok:
            by_algo[r["algorithm"]].append(r["avg_SDR"])
        print("\n各算法平均 SDR（多源 BSS Eval v3）:")
        for algo in sorted(by_algo):
            print(f"  {algo}: {statistics.mean(by_algo[algo]):.2f} dB")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--workers", type=int, default=int(os.getenv("METRICS_WORKERS", "16")))
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    run_path = Path(args.run)
    if not run_path.exists():
        raise SystemExit(f"运行记录不存在：{run_path}")
    out_dir = Path(args.out).parent if args.out else run_path.parent
    stem = run_path.stem.replace("separation_run", "objective_metrics")
    out_csv = Path(args.out) if args.out else out_dir / f"{stem}.csv"

    try:
        asyncio.run(_run(run_path, args.workers, out_csv))
    finally:
        asyncio.run(engine.dispose())


if __name__ == "__main__":
    main()
