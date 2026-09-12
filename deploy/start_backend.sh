#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/../backend" || exit 1
export PYTHONUNBUFFERED=1
echo "[$(date)] AudioLab backend (re)starting..."
while true; do
    .venv/bin/python run_production.py
    code=$?
    echo "[$(date)] backend exited with code=$code，5 秒后重启"
    sleep 5
done
