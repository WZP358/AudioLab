#!/bin/bash
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
bash "$ROOT/deploy/restore.sh"
setsid nohup bash "$ROOT/deploy/switch_sslh.sh" > /tmp/switch_sslh.log 2>&1 < /dev/null &
nohup bash "$ROOT/deploy/autodeploy.sh" > /dev/null 2>&1 &
echo "restore_all: 后端已恢复，端口分流与自动拉取已后台启动"
