"""生产环境启动入口：不启用 reload，单进程保护 GPU 推理和任务队列。"""
import uvicorn


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        workers=1,
        log_level="info",
    )
