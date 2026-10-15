"""数据备份管理端点（仅管理员）。

- POST /api/backup/run       立即执行一次数据库备份
- GET  /api/backup/list      列出历史快照
- GET  /api/backup/status    数据存储完整性概览（快照数 + 结果文件清单）
- GET  /api/backup/download/{filename}  下载指定快照
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app.models import Role, User
from app.routers.auth import get_current_user
from app.services import backup_service

router = APIRouter(prefix="/api/backup", tags=["backup"])


async def _require_admin(current_user: User) -> None:
    if current_user.role != Role.ADMIN:
        raise HTTPException(status_code=403, detail="仅管理员可执行数据备份操作")


@router.post("/run")
async def run_backup(current_user: User = Depends(get_current_user)):
    await _require_admin(current_user)
    try:
        result = await asyncio.to_thread(backup_service.run_database_backup)
    except Exception as exc:  # 备份失败要显式回传，不能让管理员以为已备份成功
        raise HTTPException(status_code=500, detail=f"数据库备份失败：{exc}")
    return {"status": "ok", "backup": result}


@router.get("/list")
async def list_backups(current_user: User = Depends(get_current_user)):
    await _require_admin(current_user)
    return {"backups": await asyncio.to_thread(backup_service.list_backups)}


@router.get("/status")
async def backup_status(current_user: User = Depends(get_current_user)):
    await _require_admin(current_user)
    backups = await asyncio.to_thread(backup_service.list_backups)
    manifest = await asyncio.to_thread(backup_service.snapshot_results_manifest)
    return {
        "backup_count": len(backups),
        "latest_backup": backups[0] if backups else None,
        "results_manifest": manifest,
    }


@router.get("/download/{filename}")
async def download_backup(filename: str, current_user: User = Depends(get_current_user)):
    await _require_admin(current_user)
    path = await asyncio.to_thread(backup_service.get_backup_path, filename)
    if path is None:
        raise HTTPException(status_code=404, detail="备份文件不存在")
    return FileResponse(str(path), media_type="application/gzip", filename=filename)
