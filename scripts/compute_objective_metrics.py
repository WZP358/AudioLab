#!/usr/bin/env python3
"""对已完成的分离任务计算完整 BSS Eval v3（多源）客观指标，写 CSV + JSON 汇总。

依赖 separation_run_*.json（run_testset_separation.py 的产物）里的 task_map，
从数据库读取每个任务的 reference_paths（金标准）与 stem_files（分离结果），
用 app.services.objective_metrics_multisource.compute_bss_metrics_multisource 计算。

用法：
    cd /mnt/wzp/AudioLab/backend
    .venv/bin/python /mnt/wzp/AudioLab/scripts/compute_objective_metrics.py \
        --run /mnt/wzp/datasets/musdb18_test/separation_run_xxx.json
"""
from __future__ import annotations

import argparse
import asyncio
import csv
import json
import sys
from datetime import datetime
from pathlib import Path

# 让脚本能 import app（backend 目录）
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from sqlalchemy import text

from app.database import AsyncSessionLocal, engine
from app.services.objective_metrics_multisource import compute_bss_metrics_multisource

STEMS = ["Vocals", "Drums", "Bass", "Other"]


async def fetch_task_info(db, task_id: int) -> dict:
    """读取任务的混合音频路径、金标准参考路径、分离结果路径。"""
    r = await db.execute(
        text("SELECT file_path, metadata_json FROM separation_tasks WHERE id = :id"),
        {"id": task_id},
    )
    row = r.first()
    if not row:
        return {}
    file_path, metadata_json = row
    reference_paths = {}
    try:
        md = json.loads(metadata_json or "{}")
        reference_paths = md.get("reference_paths", {})
    except (TypeError, ValueError):
        pass

    r2 = await db.execute(
        text("SELECT stem_name, file_path FROM stem_files WHERE task_id = :id"),
        {"id": task_id},
    )
    estimates = {stem: Path(p) for stem, p in r2.fetchall()}
    return {"mixture": Path(file_path), "references": reference_paths, "estimates": estimates}


async def compute_for_run(run_path: Path) -> list[dict]:
    run = json.loads(run_path.read_text(encoding="utf-8"))
    batches = run.get("batches", [])
    rows: list[dict] = []

    async with AsyncSessionLocal() as db:
        for b in batches:
            track = b.get("track")
            task_map = b.get("task_map", {})
            for algo, task_id in task_map.items():
                task_id = int(task_id)
                info = await fetch_task_info(db, task_id)
                if not info or not info["estimates"] or not info["references"]:
                    rows.append({"track": track, "algorithm": algo, "task_id": task_id, "error": "缺少分离结果或金标准"})
                    continue
                # 统一为 4 源
                estimates = {s: info["estimates"][s] for s in STEMS if s in info["estimates"]}
                references = {s: Path(info["references"][s]) for s in STEMS if s in info["references"]}
                if set(estimates) != set(references):
                    rows.append({"track": track, "algorithm": algo, "task_id": task_id, "error": "源集合不匹配"})
                    continue
                try:
                    m = compute_bss_metrics_multisource(
                        mixture_path=info["mixture"], estimates=estimates, references=references
                    )
                except Exception as e:
                    rows.append({"track": track, "algorithm": algo, "task_id": task_id, "error": str(e)})
                    continue
                row = {"track": track, "algorithm": algo, "task_id": task_id}
                for s in STEMS:
                    mm = m.metrics_by_source[s]
                    row[f"{s}_SDR"] = round(mm["sdr"], 3)
                    row[f"{s}_SIR"] = round(mm["sir"], 3)
                    row[f"{s}_SAR"] = round(mm["sar"], 3)
                row["avg_SDR"] = round(m.get_average_sdr(), 3)
                row["avg_SIR"] = round(m.get_average_sir(), 3)
                row["avg_SAR"] = round(m.get_average_sar(), 3)
                rows.append(row)
                print(f"{track} / {algo}: avg SDR={row['avg_SDR']} SIR={row['avg_SIR']} SAR={row['avg_SAR']}", flush=True)

    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True, help="separation_run_*.json 路径")
    ap.add_argument("--out", default=None, help="CSV 输出路径（默认与 run 同目录）")
    args = ap.parse_args()

    run_path = Path(args.run)
    if not run_path.exists():
        raise SystemExit(f"运行记录不存在：{run_path}")

    rows = asyncio.run(_run(run_path))

    out_dir = Path(args.out).parent if args.out else run_path.parent
    stem = run_path.stem.replace("separation_run", "objective_metrics")
    csv_path = Path(args.out) if args.out else out_dir / f"{stem}.csv"
    json_path = csv_path.with_suffix(".json")

    fields = ["track", "algorithm", "task_id", "error"] + [
        f"{s}_{k}" for s in STEMS for k in ("SDR", "SIR", "SAR")
    ] + ["avg_SDR", "avg_SIR", "avg_SAR"]
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for row in rows:
            w.writerow(row)
    json_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")

    ok = [r for r in rows if "avg_SDR" in r]
    err = [r for r in rows if "error" in r]
    print(f"\n完成：{len(ok)} 成功 / {len(err)} 失败。CSV -> {csv_path}  JSON -> {json_path}")

    # 按算法汇总平均
    if ok:
        from collections import defaultdict
        by_algo = defaultdict(list)
        for r in ok:
            by_algo[r["algorithm"]].append(r["avg_SDR"])
        print("\n各算法平均 SDR（多源 BSS Eval v3）:")
        for algo in sorted(by_algo):
            import statistics
            print(f"  {algo}: {statistics.mean(by_algo[algo]):.2f} dB")


async def _run(run_path: Path) -> list[dict]:
    try:
        return await compute_for_run(run_path)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    main()
