#!/bin/bash
set -u
REPO=/mnt/wzp/AudioLab
KEY=/mnt/wzp/deploy/github_deploy_key
LOG=/tmp/autodeploy.log
export GIT_SSH_COMMAND="ssh -i $KEY -o StrictHostKeyChecking=no -o BatchMode=yes"
echo "[$(date)] autodeploy watcher started" >> "$LOG"
while true; do
  cd "$REPO" 2>/dev/null || { sleep 180; continue; }
  before=$(git rev-parse HEAD 2>/dev/null)
  if git pull --ff-only origin main >> "$LOG" 2>&1; then
    after=$(git rev-parse HEAD 2>/dev/null)
    if [ "$before" != "$after" ]; then
      echo "[$(date)] 新提交已拉取，重建前端并重启后端" >> "$LOG"
      if git diff --name-only "$before" "$after" 2>/dev/null | grep -q '^frontend/'; then
        (cd "$REPO/frontend" && PUBLIC_URL=/ npm run build >> "$LOG" 2>&1)
      fi
      bash "$REPO/deploy/stop_backend.sh" >> "$LOG" 2>&1
      sleep 2
      (cd "$REPO" && nohup bash deploy/start_backend.sh >> /tmp/audiolab.log 2>&1 &)
    fi
  else
    echo "[$(date)] git pull 失败（本地有未提交改动），跳过" >> "$LOG"
  fi
  sleep 180
done
