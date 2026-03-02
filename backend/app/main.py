from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
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


@app.get("/health", tags=["system"])
async def health_check():
    return {"status": "ok"}


@app.get("/", tags=["system"])
async def root():
    return {
        "message": "AudioLab Backend API",
        "version": "0.1.0",
        "docs": "/docs"
    }

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "backend.app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,  # 开发时开启热重载
        log_level="info",
    )

