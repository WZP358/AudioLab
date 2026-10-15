#!/usr/bin/env python3
"""把解码好的 MUSDB18 测试集批量投给分离队列（每首 4 算法 + 4 金标准）。

用法（backend venv 有 requests）：
    cd /mnt/wzp/AudioLab/backend
    .venv/bin/python /mnt/wzp/AudioLab/scripts/run_testset_separation.py \
        --manifest /mnt/wzp/datasets/musdb18_test/decode_manifest.json \
        [--limit 1]        # 只投前 N 首做试点
        [--poll]           # 投完后轮询直到全部任务完成

产出：结果目录下写一份 separation_run_<时间戳>.json，记录 batch_id/task_id 与曲目、算法的映射，
     供后续客观指标脚本使用。
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

BASE = "http://127.0.0.1:8000"
ALGORITHMS = "MDX23C,Demucs4HT,Band Split RoFormer,SCNet"
ALGO_LIST = [a.strip() for a in ALGORITHMS.split(",") if a.strip()]

# 金标准文件名 -> 上传表单字段名
GOLD_FIELDS = {
    "vocals": "vocals_file",
    "drums": "drums_file",
    "bass": "bass_file",
    "other": "other_file",
}


def login(email: str, password: str) -> str:
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    r.raise_for_status()
    return r.json()["access_token"]


def create_batch(token: str, track: dict) -> dict:
    def _open(path: str):
        return open(path, "rb")

    files = [("file", (f"{track['track']}_mixture.wav", _open(track["mixture"]), "audio/wav"))]
    for stem, field in GOLD_FIELDS.items():
        files.append((field, (f"{track['track']}_{stem}.wav", _open(track[stem]), "audio/wav")))

    data = {
        "algorithms": ALGORITHMS,
        "auto_blind": "false",
        "auto_objective": "false",
        "auto_experiment": "false",
    }
    headers = {"Authorization": f"Bearer {token}"}
    try:
        r = requests.post(f"{BASE}/api/separation-batches", files=files, data=data, headers=headers, timeout=1200)
    finally:
        for _, (_, fh, _) in files:
            fh.close()
    if r.status_code != 200:
        raise RuntimeError(f"batch 创建失败 HTTP {r.status_code}: {r.text[:400]}")
    return r.json()


def poll_all_done(token: str, batch_ids: list[str], interval: int = 30) -> None:
    """轮询所有 batch 直到其子任务全部到终态（COMPLETED/FAILED）。"""
    headers = {"Authorization": f"Bearer {token}"}
    pending = set(batch_ids)
    while pending:
        time.sleep(interval)
        for bid in list(pending):
            r = requests.get(f"{BASE}/api/separation-batches/{bid}", headers=headers, timeout=30)
            if r.status_code != 200:
                continue
            b = r.json()
            statuses = [t["status"] for t in b.get("tasks", [])]
            done = all(s in ("COMPLETED", "FAILED") for s in statuses)
            if done:
                ok = statuses.count("COMPLETED")
                failed = statuses.count("FAILED")
                print(f"batch {bid}: 完成（{ok} 成功 / {failed} 失败）", flush=True)
                pending.discard(bid)
            else:
                print(f"batch {bid}: {statuses}", flush=True)
    print("全部 batch 已到终态。")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out", default=None, help="运行记录输出目录（默认与 manifest 同目录）")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--poll", action="store_true")
    ap.add_argument("--email", default="admin")
    ap.add_argument("--password", default="admin123")
    args = ap.parse_args()

    manifest_path = Path(args.manifest)
    tracks = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not tracks:
        raise SystemExit("manifest 为空")

    for t in tracks:
        for key in ["mixture", "vocals", "drums", "bass", "other"]:
            if not Path(t[key]).exists():
                raise SystemExit(f"缺少音频文件：{t[key]}")

    if args.limit:
        tracks = tracks[: args.limit]
        print(f"仅投前 {len(tracks)} 首（--limit）")

    token = login(args.email, args.password)
    print(f"登录成功（{args.email}），共 {len(tracks)} 首，每首 4 算法")

    run_record = {"created_at": datetime.now(timezone.utc).isoformat(), "batches": []}
    batch_ids: list[str] = []

    for i, track in enumerate(tracks, 1):
        name = track["track"]
        try:
            resp = create_batch(token, track)
        except Exception as e:
            print(f"[{i}/{len(tracks)}] {name} 失败：{e}", file=sys.stderr, flush=True)
            run_record["batches"].append({"track": name, "error": str(e)})
            continue
        # task_ids 与 algorithms 顺序一一对应（batch 端点按 algo_list 顺序创建）
        task_ids = resp["task_ids"]
        algo = resp["algorithms"]
        run_record["batches"].append(
            {
                "track": name,
                "batch_id": resp["batch_id"],
                "task_map": {algo[k]: task_ids[k] for k in range(len(task_ids))},
                "reference_stems": resp.get("reference_stems", []),
            }
        )
        batch_ids.append(resp["batch_id"])
        print(f"[{i}/{len(tracks)}] {name} → batch {resp['batch_id']}（{len(task_ids)} 任务）", flush=True)

    out_dir = Path(args.out) if args.out else manifest_path.parent
    out_path = out_dir / f"separation_run_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    out_path.write_text(json.dumps(run_record, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"运行记录已写入：{out_path}")

    if args.poll and batch_ids:
        poll_all_done(token, batch_ids)


if __name__ == "__main__":
    main()
