#!/usr/bin/env python3

import sys
from pathlib import Path
import logging

sys.path.insert(0, str(Path(__file__).resolve().parent))

import uvicorn

# 降低 python-dotenv 的日志等级，避免 .env 解析告警刷屏
logging.getLogger("dotenv.main").setLevel(logging.ERROR)

from app.main import app


if __name__ == "__main__":
    # 获取后端目录的绝对路径
    backend_dir = Path(__file__).resolve().parent
    
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,  # 开发时开启热重载
        reload_dirs=[str(backend_dir)],  # 只监视后端目录的变化
        log_level="info",
        access_log=False,  # 关闭访问日志，只保留关键信息
    )

