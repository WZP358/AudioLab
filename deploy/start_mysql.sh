#!/usr/bin/env bash
# 便携版 MySQL 启动脚本（路径可用环境变量覆盖，默认适配 /data 部署）
#   MYSQL_DIR=/data/portable  MYSQL_DATA=/data/mysql-data
# 供 install.sh 使用，也用于服务器重启后手动拉起 MySQL。
set -u

MYSQL_DIR="${MYSQL_DIR:-/data/portable}"
MYSQL_DATA="${MYSQL_DATA:-/data/mysql-data}"

export LD_LIBRARY_PATH="$MYSQL_DIR/lib:/lib/x86_64-linux-gnu:/usr/lib/x86_64-linux-gnu"
export PATH="$MYSQL_DIR/bin:$PATH"

mkdir -p /var/run/mysqld

if [ ! -d "$MYSQL_DATA/mysql" ]; then
  echo "[init] 初始化 MySQL 数据目录 $MYSQL_DATA ..."
  "$MYSQL_DIR/bin/mysqld" --initialize-insecure --datadir="$MYSQL_DATA" --user=root \
    --basedir="$MYSQL_DIR" --lc-messages-dir="$MYSQL_DIR/share/mysql/english" \
    --character-sets-dir="$MYSQL_DIR/share/mysql/charsets" > /tmp/mysql_init.log 2>&1 \
    || { echo "[FAIL] init"; tail -20 /tmp/mysql_init.log; exit 1; }
fi

if "$MYSQL_DIR/bin/mysqladmin" ping --silent 2>/dev/null; then
  echo "MySQL already running"
  exit 0
fi

"$MYSQL_DIR/bin/mysqld" --datadir="$MYSQL_DATA" --basedir="$MYSQL_DIR" \
  --lc-messages-dir="$MYSQL_DIR/share/mysql/english" \
  --character-sets-dir="$MYSQL_DIR/share/mysql/charsets" \
  --user=root --port=3306 --bind-address=127.0.0.1 \
  --socket=/var/run/mysqld/mysqld.sock > /tmp/mysqld_portable.log 2>&1 &

for i in $(seq 1 30); do
  "$MYSQL_DIR/bin/mysqladmin" ping --silent 2>/dev/null && { echo "MySQL ready"; exit 0; }
  sleep 2
done
echo "MySQL FAILED"; tail -25 /tmp/mysqld_portable.log; exit 1
