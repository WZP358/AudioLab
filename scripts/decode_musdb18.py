#!/usr/bin/env python3
"""把 MUSDB18 压缩包（.stem.mp4 / STEMS 格式）解码为每首曲目的 mixture + 4 个金标准 stem WAV。

STEMS 流顺序（stempeg 默认元数据）固定为：
    ['mixture', 'drums', 'bass', 'other', 'vocals']

用法（backend venv 已装 stempeg + soundfile + numpy）：
    cd /mnt/wzp/AudioLab/backend
    .venv/bin/python /mnt/wzp/AudioLab/scripts/decode_musdb18.py \
        --zip /mnt/wzp/datasets/musdb18.zip \
        --out /mnt/wzp/datasets/musdb18_test \
        --split test            # 只解码 test 子集；--split "" 解全部
        [--limit 1]             # 可选：只解前 N 首做验证
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
import zipfile
from pathlib import Path

import numpy as np
import soundfile as sf
import stempeg

STEM_ORDER = ["mixture", "drums", "bass", "other", "vocals"]


def find_tracks(zip_path: Path, split: str) -> list[str]:
    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()

    tracks: list[str] = []
    for n in names:
        if not n.lower().endswith(".stem.mp4"):
            continue
        parts = Path(n).parts
        # 结构为 test/<track>.stem.mp4、train/<track>.stem.mp4（无外层 musdb18/ 包目录）
        if split:
            if split.lower() not in {p.lower() for p in parts}:
                continue
        tracks.append(n)
    return sorted(tracks)


def decode_one(archive: zipfile.ZipFile, entry: str, out_dir: Path) -> dict:
    track_name = Path(entry).name.removesuffix(".stem.mp4")  # 去掉 .stem.mp4
    safe = "".join(c if c not in "/\\:*?\"<>|" else "_" for c in track_name).strip()
    track_dir = out_dir / safe
    track_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td) / "track.stem.mp4"
        with archive.open(entry) as src, open(tmp, "wb") as dst:
            dst.write(src.read())

        info = stempeg.Info(str(tmp))
        n = info.nb_audio_streams
        if n != 5:
            raise SystemExit(f"{entry}: 期望 5 条音频流，实际 {n} 条")

        stems, sr = stempeg.read_stems(str(tmp), multiprocess=False)
        # stems shape: (5, samples, channels)
        written: dict[str, str] = {}
        for i, stem in enumerate(STEM_ORDER):
            data = np.clip(stems[i], -1.0, 1.0)
            pcm = (data * 32767.0).astype(np.int16)
            out_path = track_dir / f"{stem}.wav"
            sf.write(str(out_path), pcm, sr, subtype="PCM_16")
            written[stem] = str(out_path)

    return {"track": track_name, "dir": str(track_dir), **written}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--split", default="test", help="test/train，空字符串表示全部")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    zip_path = Path(args.zip)
    if not zip_path.exists():
        raise SystemExit(f"压缩包不存在：{zip_path}")

    tracks = find_tracks(zip_path, args.split)
    if not tracks:
        raise SystemExit("未在压缩包中找到任何 .stem.mp4 曲目（请检查 --split）")
    print(f"找到 {len(tracks)} 首曲目（split={args.split or '全部'}）")

    if args.limit:
        tracks = tracks[: args.limit]
        print(f"仅处理前 {len(tracks)} 首（--limit）")

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    manifest = []
    with zipfile.ZipFile(zip_path) as zf:
        for i, entry in enumerate(tracks, 1):
            print(f"[{i}/{len(tracks)}] 解码 {Path(entry).name.removesuffix('.stem.mp4')} ...", flush=True)
            try:
                rec = decode_one(zf, entry, out_dir)
                manifest.append(rec)
            except Exception as e:
                print(f"  失败：{e}", file=sys.stderr, flush=True)
                raise

    manifest_path = out_dir / "decode_manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"完成：{len(manifest)} 首，清单写入 {manifest_path}")


if __name__ == "__main__":
    main()
