from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from fastapi.responses import FileResponse
from .routers import tasks, scores, auth, admin, audio_resources, system, messages, labels, blind_samples, batch, optimization, backup
import os
import logging
from pathlib import Path
import traceback
from contextlib import asynccontextmanager
from app.database import engine
from sqlalchemy import text

# 配置日志：只输出 WARNING 及以上级别（过滤掉正常的 INFO/DEBUG）
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
logging.getLogger("uvicorn").setLevel(logging.WARNING)
# 保留 uvicorn.error 的 INFO 级别，用于显示启动信息
logging.getLogger("uvicorn.error").setLevel(logging.INFO)

@asynccontextmanager
async def lifespan(_app: FastAPI):
    # 启动时做轻量 schema 自愈，避免新版本字段未迁移导致接口直接报 500
    try:
        async with engine.begin() as conn:
            await conn.execute(text("ALTER TABLE separation_tasks ADD COLUMN metadata_json TEXT NULL"))
            print("[OK] Auto-added column separation_tasks.metadata_json")
            try:
                await conn.execute(text("ALTER TABLE blind_samples ADD COLUMN objective_metrics_json TEXT NULL"))
            except Exception as exc:
                if "duplicate column" not in str(exc).lower() and "already exists" not in str(exc).lower():
                    logging.warning("补齐 blind_samples.objective_metrics_json 失败: %s", exc)
            # 保证同一任务+声源+15秒时间片只生成一次盲化样本（DB 级唯一约束兜底）
            try:
                await conn.execute(text("ALTER TABLE blind_samples ADD UNIQUE KEY uq_blind_sample_task_stem_start (task_id, stem_name, start_seconds)"))
                print("[OK] Auto-added unique key blind_samples (task_id, stem_name, start_seconds)")
            except Exception as exc:
                if "duplicate key" not in str(exc).lower() and "already exists" not in str(exc).lower():
                    logging.warning("添加 blind_samples 唯一约束失败（可忽略）: %s", exc)
            # 清理头像相关字段（如果存在）
            try:
                await conn.execute(text("ALTER TABLE users DROP COLUMN avatar_url"))
                print("✓ 已移除 users.avatar_url")
            except Exception as e:
                msg = str(e).lower()
                if "no such column" in msg or "check that column/key exists" in msg or "unknown column" in msg or "does not exist" in msg:
                    pass
                else:
                    logging.warning("删除 users.avatar_url 失败（可忽略或手动迁移）: %s", e)
            try:
                await conn.execute(text("ALTER TABLE pending_users DROP COLUMN avatar_url"))
                print("✓ 已移除 pending_users.avatar_url")
            except Exception as e:
                msg = str(e).lower()
                if "no such column" in msg or "check that column/key exists" in msg or "unknown column" in msg or "does not exist" in msg:
                    pass
                else:
                    logging.warning("删除 pending_users.avatar_url 失败（可忽略或手动迁移）: %s", e)
    except Exception as e:
        # 已存在等情况属于正常，继续启动
        msg = str(e).lower()
        if "duplicate column name" not in msg and "already exists" not in msg:
            logging.warning("自动补齐 metadata_json 字段失败（可手动执行迁移）: %s", e)

    # startup 阶段：输出一次清晰的启动成功提示（使用 print 确保始终显示）
    print("\n" + "="*60)
    print("[OK] AudioLab backend started")
    print("  API: http://127.0.0.1:8000")
    print("  Docs: http://127.0.0.1:8000/docs")
    print("="*60 + "\n")
    # 初始化任务队列管理器
    from app.services.queue_manager import TaskQueueManager
    await TaskQueueManager.get_instance()
    print("[OK] Task queue manager started\n")

    # 数据安全：启动即做一次数据库快照，之后按固定周期自动备份（默认每 24 小时）。
    import asyncio as _asyncio
    from app.services import backup_service as _backup_service

    async def _backup_loop() -> None:
        interval_hours = float(os.getenv("BACKUP_INTERVAL_HOURS", "24") or "24")
        while True:
            try:
                await _asyncio.to_thread(_backup_service.run_database_backup)
            except Exception as exc:  # 备份失败不能拖垮主进程，仅记录
                logging.warning("定时数据库备份失败：%s", exc)
            await _asyncio.sleep(interval_hours * 3600)

    _backup_task = _asyncio.create_task(_backup_loop())
    yield
    _backup_task.cancel()
    try:
        await _backup_task
    except _asyncio.CancelledError:
        pass
    # shutdown：显式释放 SQLAlchemy AsyncEngine 的连接池，避免热重载/退出时 aiomysql 在 __del__
    # 里尝试回收连接却发现 event loop 已关闭，从而刷屏 "RuntimeError: Event loop is closed"
    try:
        await engine.dispose()
    except Exception:
        # 兜底：关闭阶段不阻塞退出
        logging.exception("Failed to dispose async engine on shutdown")


app = FastAPI(title="AudioLab Backend", version="0.1.0", lifespan=lifespan)

# 添加CORS中间件，允许前端跨域访问
_cors_origins = [item.strip() for item in (os.getenv("CORS_ORIGINS") or "").split(",") if item.strip()]
if not _cors_origins:
    _cors_origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 开发时友好的全局异常处理器 —— 记录完整 traceback 并以 JSON 返回，便于本地调试
@app.exception_handler(Exception)
async def debug_exception_handler(request: Request, exc: Exception):
    tb = traceback.format_exc()
    logging.error("Unhandled exception:\n%s", tb)
    # 正式环境默认不向客户端泄露 traceback；调试时显式设置 DEBUG_ERRORS=true。
    content = {"detail": "服务器内部错误"}
    if (os.getenv("DEBUG_ERRORS") or "false").lower() in ("1", "true", "yes", "on"):
        content = {"detail": str(exc), "trace": tb}
    return JSONResponse(
        status_code=500,
        content=content,
        headers={
            "Access-Control-Allow-Origin": request.headers.get("origin", "http://localhost:3000"),
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods": "*",
            "Access-Control-Allow-Headers": "*",
        },
    )

# 注册路由
app.include_router(auth.router)
app.include_router(tasks.router)
app.include_router(scores.router)
app.include_router(labels.router)
app.include_router(blind_samples.router)
app.include_router(admin.router)
app.include_router(audio_resources.router)
app.include_router(system.router)
app.include_router(system.public_router)  # 公共系统配置端点
app.include_router(messages.router)
app.include_router(batch.router)
app.include_router(optimization.router)
app.include_router(backup.router)

# 挂载静态文件目录（用于头像和下载文件）
download_dir = Path(__file__).parent.parent / "download"
download_dir.mkdir(parents=True, exist_ok=True)
app.mount("/download", StaticFiles(directory=str(download_dir)), name="download")

# 挂载音频资源目录（如果存在）
import os
audio_resource_dir = Path(os.getenv("AUDIO_RESOURCE_DIR", "audio_resources"))
if not audio_resource_dir.is_absolute():
    audio_resource_dir = Path(__file__).parent.parent / audio_resource_dir
if audio_resource_dir.exists():
    app.mount("/audio_resources", StaticFiles(directory=str(audio_resource_dir)), name="audio_resources")

def _get_frontend_build_dir() -> Path:
    """
    生产/打包场景：后端托管前端 CRA build，保证直链访问 /manual 等前端路由不 404。
    repo_root = AudioLab/
      - frontend/build
      - backend/app/main.py
    """
    repo_root = Path(__file__).resolve().parents[2]
    return repo_root / "frontend" / "build"


frontend_build_dir = _get_frontend_build_dir()
if frontend_build_dir.exists():
    # CRA 的静态资源目录：/static/**
    static_dir = frontend_build_dir / "static"
    if static_dir.exists():
        app.mount("/static", StaticFiles(directory=str(static_dir)), name="frontend_static")

def _get_repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


@app.get("/user-manual.md", include_in_schema=False)
async def user_manual_md():
    """
    用户说明书 Markdown 原文（仓库根目录：AudioLab/用户说明书.md）
    前端 /manual 页面会拉取并渲染该内容。
    """
    manual_path = _get_repo_root() / "用户说明书.md"
    if not manual_path.exists():
        return JSONResponse(status_code=404, content={"detail": "用户说明书.md 不存在"})
    return FileResponse(
        str(manual_path),
        media_type="text/markdown",
        filename="用户说明书.md",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/health", tags=["system"])
async def health_check():
    return {"status": "ok"}

@app.get("/api", tags=["system"])
async def api_root():
    return {
        "message": "AudioLab Backend API",
        "version": "0.1.0",
        "docs": "/docs",
    }

@app.get("/", tags=["system"])
async def root():
    # 如果存在前端 build，则优先返回前端页面
    if frontend_build_dir.exists():
        index_file = frontend_build_dir / "index.html"
        if index_file.exists():
            return FileResponse(str(index_file))
    return {
        "message": "AudioLab Backend API",
        "version": "0.1.0",
        "docs": "/docs",
    }


@app.get("/{full_path:path}", include_in_schema=False)
async def spa_fallback(full_path: str):
    """
    SPA fallback：用于支持 /manual、/stats 等前端路由的直链/刷新。
    - /api/** 由后端路由处理（本函数会被更具体路由优先匹配而不会进入）
    - /docs、/openapi.json 也同理
    """
    if not frontend_build_dir.exists():
        return JSONResponse(status_code=404, content={"detail": "Not Found"})

    # 先尝试直接返回 build 目录下的真实文件（如 favicon.ico、manifest.json 等）
    requested = (frontend_build_dir / full_path).resolve()
    base = frontend_build_dir.resolve()
    if str(requested).startswith(str(base)) and requested.is_file():
        return FileResponse(str(requested))

    # 否则返回 index.html 让前端路由接管
    index_file = frontend_build_dir / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return JSONResponse(status_code=404, content={"detail": "Frontend build not found"})

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "backend.app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,  # 开发时开启热重载
        log_level="warning",
    )

