from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
import os
import logging
from pathlib import Path
from dotenv import load_dotenv

# 确保从 backend 目录加载 .env 文件
backend_dir = Path(__file__).resolve().parent.parent
env_path = backend_dir / ".env"
load_dotenv(dotenv_path=env_path)
if env_path.exists():
    logging.info(f"已加载 .env 文件: {env_path}")
else:
    logging.warning(f".env 文件不存在: {env_path}，将使用系统环境变量")

DATABASE_URL = os.getenv("DATABASE_URL", "mysql+aiomysql://audiolab:audiolab@db:3306/audiolab")

# 禁用 SQLAlchemy 的 INFO 级别日志（只保留 WARNING/ERROR）
logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
logging.getLogger("sqlalchemy.pool").setLevel(logging.WARNING)

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)

Base = declarative_base()


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
