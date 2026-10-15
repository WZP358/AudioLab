#!/usr/bin/env bash
# 在当前服务器上打包「便携版 MySQL 二进制 + 数据库快照」，供新服务器部署使用。
#
# 产物：audiolab-mysql-portable.tar.gz
#   内含 portable/   （mysqld/mysql/mysqladmin 二进制 + 依赖库 + share 消息文件）
#         audiolab.sql（mysqldump --single-transaction 的 audiolab 库快照，含建库/建表/数据）
#
# 用法：bash deploy/pack_mysql.sh [输出路径，默认 /mnt/wzp/audiolab-mysql-portable.tar.gz]
# 之后把该文件拷贝到新服务器（如 /data/audiolab-mysql-portable.tar.gz），
# 新服务器上 install.sh 会自动解包、初始化数据目录、启动并导入数据。
set -euo pipefail

# 当前服务器的便携版 MySQL 路径（与生产环境一致）
P="${PACK_MYSQL_DIR:-/mnt/wzp/portable}"
OUT="${1:-/mnt/wzp/audiolab-mysql-portable.tar.gz}"

export LD_LIBRARY_PATH="$P/lib:/lib/x86_64-linux-gnu:/usr/lib/x86_64-linux-gnu"

if [ ! -x "$P/bin/mysqld" ]; then
  echo "未找到便携版 MySQL：$P/bin/mysqld" >&2
  exit 1
fi

echo "===== 导出数据库快照（consistent dump，不中断 MySQL）====="
WORK="$(mktemp -d)"
# 便携版只带 mysqld/mysql/mysqladmin，不带 mysqldump；优先用系统里的 mysqldump。
DUMP_BIN="$(command -v mysqldump || true)"
[ -z "$DUMP_BIN" ] && [ -x "$P/bin/mysqldump" ] && DUMP_BIN="$P/bin/mysqldump"
if [ -z "$DUMP_BIN" ]; then
  echo "未找到 mysqldump，请先 apt-get install -y mysql-client" >&2
  rm -rf "$WORK"
  exit 1
fi
"$DUMP_BIN" -u root --socket=/var/run/mysqld/mysqld.sock \
  --single-transaction --routines --triggers --no-tablespaces --set-gtid-purged=OFF \
  --databases audiolab \
  > "$WORK/audiolab.sql" \
  || { echo "mysqldump 失败（请确认 MySQL 在运行）"; rm -rf "$WORK"; exit 1; }
echo "  快照大小：$(du -h "$WORK/audiolab.sql" | cut -f1)"

echo "===== 复制便携版 MySQL 二进制 ====="
cp -a "$P" "$WORK/portable"

echo "===== 打包 ====="
tar -C "$WORK" -czf "$OUT" portable audiolab.sql
rm -rf "$WORK"
echo "✅ 已生成：$OUT（$(du -h "$OUT" | cut -f1)）"
echo "   请将其拷贝到新服务器，例如："
echo "     scp $OUT root@<新服务器IP>:/data/"
