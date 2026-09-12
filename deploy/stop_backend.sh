#!/usr/bin/env bash
set -u
pkill -f "run_production.py" 2>/dev/null && echo "已停止 run_production.py"
pkill -f "deploy/start_backend.sh" 2>/dev/null && echo "已停止保活脚本"
pkill -f "start_backend.sh" 2>/dev/null
echo "done"
