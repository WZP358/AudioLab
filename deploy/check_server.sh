#!/usr/bin/env bash
set -u
fail=0
check_cmd() { command -v "$1" >/dev/null 2>&1 && echo "[OK] $1" || { echo "[FAIL] $1"; fail=1; }; }
check_cmd python3
check_cmd ffmpeg
check_cmd ffprobe
check_cmd nginx
python3 -c 'import torch; print("[OK] torch", torch.__version__, "cuda=", torch.cuda.is_available())' 2>/dev/null || { echo "[WARN] torch/CUDA unavailable"; fail=1; }
test -f backend/.env && echo "[OK] backend/.env" || { echo "[FAIL] backend/.env missing"; fail=1; }
test -d backend/uploads && echo "[OK] uploads directory" || { echo "[WARN] backend/uploads will be created by app"; }
test -d backend/results && echo "[OK] results directory" || { echo "[WARN] backend/results will be created by app"; }
exit "$fail"
