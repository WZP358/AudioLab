#!/usr/bin/env python3

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import uvicorn

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
        log_level="warning",
    )

