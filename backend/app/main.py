from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from fastapi.responses import FileResponse
from .routers import tasks, scores, auth, admin, audio_resources, system, messages
import os
import logging
from pathlib import Path
import traceback
from contextlib import asynccontextmanager
from app.database import engine

# 配置日志：只输出 WARNING 及以上级别（过滤掉正常的 INFO/DEBUG）
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
logging.getLogger("uvicorn").setLevel(logging.WARNING)

@asynccontextmanager
async def lifespan(_app: FastAPI):
    # startup 阶段：输出一次清晰的启动成功提示
    logging.getLogger("uvicorn.error").info(
        "AudioLab 后端已启动，API 地址：http://127.0.0.1:8000 ，文档：http://127.0.0.1:8000/docs"
    )
    yield
    # shutdown：显式释放 SQLAlchemy AsyncEngine 的连接池，避免热重载/退出时 aiomysql 在 __del__
    # 里尝试回收连接却发现 event loop 已关闭，从而刷屏 "RuntimeError: Event loop is closed"
    try:
        await engine.dispose()
    except Exception:
        # 兜底：关闭阶段不阻塞退出
        logging.exception("Failed to dispose async engine on shutdown")


app = FastAPI(title="AudioLab Backend", version="0.1.0", lifespan=lifespan)

# 添加CORS中间件，允许前端跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],  
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 开发时友好的全局异常处理器 —— 记录完整 traceback 并以 JSON 返回，便于本地调试
@app.exception_handler(Exception)
async def debug_exception_handler(request: Request, exc: Exception):
    tb = traceback.format_exc()
    logging.error("Unhandled exception:\n%s", tb)
    # 返回简洁的错误信息和 traceback（仅在本地开发时使用）
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc), "trace": tb},
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
app.include_router(admin.router)
app.include_router(audio_resources.router)
app.include_router(system.router)
app.include_router(system.public_router)  # 公共系统配置端点
app.include_router(messages.router)

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
        log_level="info",
    )

