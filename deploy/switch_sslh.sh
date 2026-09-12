#!/bin/bash
set -u
echo "[start] switch begin"
P=/mnt/wzp/portable
export LD_LIBRARY_PATH="$P/lib:/lib/x86_64-linux-gnu:/usr/lib/x86_64-linux-gnu"
SSHD_CFG=/etc/ssh/sshd_config
BAK=/mnt/wzp/deploy/sshd_config.bak
pkill -x sslh 2>/dev/null || true
sleep 1
cp "$SSHD_CFG" "$BAK" 2>/dev/null || true
sed -i '/^Port /d' "$SSHD_CFG"
echo "Port 2222" >> "$SSHD_CFG"
if ! sshd -t 2>/tmp/sshd_test.err; then
  echo "[FAIL] sshd config invalid: $(cat /tmp/sshd_test.err)"
  cp "$BAK" "$SSHD_CFG"
  exit 1
fi
service ssh restart 2>&1 || true
setsid "$P/bin/sslh" -f -n -p 0.0.0.0:22 --ssh 127.0.0.1:2222 --http 127.0.0.1:8000 -P /tmp/sslh.pid > /tmp/sslh.log 2>&1 < /dev/null &
sleep 3
if ss -tlnp 2>/dev/null | grep -q ':22 .*sslh'; then
  echo "[OK] sslh on :22"
else
  echo "[FAIL] sslh not on :22, revert"
  cp "$BAK" "$SSHD_CFG"
  service ssh restart 2>&1 || true
  exit 1
fi
code=$(curl -s -m 8 -o /dev/null -w '%{http_code}' http://127.0.0.1:22/health)
echo "[OK] HTTP /health via :22 => $code"
echo "switch done"
