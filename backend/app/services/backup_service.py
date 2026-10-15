"""数据库与评估数据的备份服务。

目标（对应"评估数据结果不能丢"的需求）：
- 用 mysqldump 把 MySQL 库完整导出为压缩 SQL 快照；
- 同时提供分离结果目录（results/）的清单统计，便于完整性核对；
- 保留最近 N 份快照，自动清理更早的；
- 全部落盘到本地磁盘（backend/results/backups），与业务数据隔离，可被外部 rsync / 云同步带走。

所有函数均为同步实现，由路由层放进线程池执行（asyncio.to_thread），避免阻塞事件循环。
"""
from __future__ import annotations

import gzip
import logging
import os
import re
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from typing import List, Optional
from urllib.parse import unquote, urlparse

logger = logging.getLogger("audiolab.backup")

# 备份根目录：backend/results/backups
_BACKEND_DIR = Path(__file__).resolve().parents[2]
_BACKUP_DIR = _BACKEND_DIR / "results" / "backups"

# 保留最近多少份数据库快照（多余的自动删除）
_KEEP_COUNT = int(os.getenv("BACKUP_KEEP_COUNT", "30"))


def _parse_database_url(url: str) -> dict:
    """从 SQLAlchemy 连接串解析出 mysqldump 需要的字段。"""
    # mysql+aiomysql://user:pass@host:port/dbname
    parsed = urlparse(url)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 3306
    user = unquote(parsed.username or "")
    password = unquote(parsed.password or "")
    dbname = (parsed.path or "/").lstrip("/") or "audiolab"
    return {"host": host, "port": port, "user": user, "password": password, "dbname": dbname}


def backup_dir() -> Path:
    _BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    return _BACKUP_DIR


def _run_mysqldump(target_path: Path) -> dict:
    """执行一次数据库快照，返回元信息；失败抛异常。"""
    from app.database import DATABASE_URL

    cfg = _parse_database_url(DATABASE_URL)
    env = dict(os.environ)
    # 通过环境变量传递密码，避免出现在 ps 命令行里泄露
    env["MYSQL_PWD"] = cfg["password"]

    cmd = [
        "mysqldump",
        "--single-transaction",
        "--routines",
        "--triggers",
        "--events",
        "--no-tablespaces",
        "-h", cfg["host"],
        "-P", str(cfg["port"]),
        "-u", cfg["user"],
        cfg["dbname"],
    ]

    # 先写入 .sql，再 gzip 压缩为 .sql.gz，避免半成品文件污染备份目录
    tmp_sql = target_path.with_suffix(".tmp.sql")
    try:
        with open(tmp_sql, "wb") as fh:
            proc = subprocess.run(cmd, stdout=fh, stderr=subprocess.PIPE, env=env)
        if proc.returncode != 0:
            err = proc.stderr.decode("utf-8", errors="replace").strip()
            tmp_sql.unlink(missing_ok=True)
            raise RuntimeError(f"mysqldump 失败（exit={proc.returncode}）: {err[:500]}")

        with open(tmp_sql, "rb") as fin, gzip.open(target_path, "wb") as fout:
            shutil.copyfileobj(fin, fout, length=1024 * 1024)
        tmp_sql.unlink(missing_ok=True)

        size = target_path.stat().st_size
        return {"size": size, "dbname": cfg["dbname"], "host": cfg["host"], "port": cfg["port"]}
    except Exception:
        tmp_sql.unlink(missing_ok=True)
        raise


def run_database_backup() -> dict:
    """执行一次数据库备份并落盘，返回快照元信息。"""
    backup_dir()
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    target = backup_dir() / f"audiolab_{ts}.sql.gz"
    meta = _run_mysqldump(target)
    result = {
        "filename": target.name,
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "size_bytes": meta["size"],
        "dbname": meta["dbname"],
    }
    _prune_old_backups()
    logger.info("数据库备份完成：%s（%.1f KB）", target.name, meta["size"] / 1024)
    return result


def list_backups() -> List[dict]:
    """列出所有数据库快照，按时间倒序。"""
    backup_dir()
    items = []
    for p in sorted(backup_dir().glob("audiolab_*.sql.gz"), reverse=True):
        items.append({
            "filename": p.name,
            "created_at": datetime.fromtimestamp(p.stat().st_mtime).isoformat(timespec="seconds"),
            "size_bytes": p.stat().st_size,
        })
    return items


def _prune_old_backups() -> None:
    """只保留最近 _KEEP_COUNT 份数据库快照。"""
    files = sorted(backup_dir().glob("audiolab_*.sql.gz"), reverse=True)
    for stale in files[_KEEP_COUNT:]:
        try:
            stale.unlink(missing_ok=True)
            logger.info("清理过期备份：%s", stale.name)
        except OSError as exc:
            logger.warning("清理过期备份失败 %s: %s", stale.name, exc)


def get_backup_path(filename: str) -> Optional[Path]:
    """安全地解析备份文件名，防止路径穿越。"""
    if not re.fullmatch(r"audiolab_\d{8}_\d{6}\.sql\.gz", filename):
        return None
    p = backup_dir() / filename
    return p if p.is_file() else None


def snapshot_results_manifest() -> dict:
    """生成分离结果目录的清单（文件数 + 总大小），供数据完整性核对。"""
    results_dir = _BACKEND_DIR / "results"
    total = 0
    count = 0
    if results_dir.exists():
        for p in results_dir.rglob("*"):
            if p.is_file():
                count += 1
                try:
                    total += p.stat().st_size
                except OSError:
                    pass
    return {"results_file_count": count, "results_total_bytes": total}
