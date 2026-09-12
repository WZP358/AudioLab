#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
PORTABLE=/mnt/wzp/portable
echo "===== [1/4] 启动便携版 MySQL ====="
bash "$PORTABLE/start-mysql.sh" || { echo "⚠ MySQL 启动失败"; exit 1; }
echo "===== [2/4] 初始化数据库（幂等） ====="
cd "$BACKEND" || exit 1
.venv/bin/python -m app.init_db 2>&1 | tail -1
.venv/bin/python -m app.init_system_configs 2>&1 | tail -1
ADMIN_PASSWORD=3c21308b16e00f2d EXPERT_PASSWORD=79faced824a70914 \
    .venv/bin/python -m app.create_admin 2>&1 | grep -E "已创建|已更新|失败" | head -5
echo "===== [3/4] 启动后端（保活） ====="
if pgrep -f run_production.py >/dev/null; then
  echo "后端已在运行。"
else
  cd "$ROOT" || exit 1
  nohup bash deploy/start_backend.sh > /tmp/audiolab.log 2>&1 &
  echo "后端启动中..."
fi
echo "===== [4/4] 健康检查 ====="
sleep 6
if curl -s http://127.0.0.1:8000/health 2>/dev/null | grep -q '"ok"'; then
  echo "✅ 后端 /health 正常"
else
  echo "⚠ 后端健康检查未通过，见 /tmp/audiolab.log"
fi
echo "===== restore 完成 ====="
