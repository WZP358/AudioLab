"""
初始化数据库表结构
运行方式: python -m app.init_db
"""
import asyncio
from app.database import engine, Base
# 必须导入所有模型类，这样 SQLAlchemy 才能知道要创建哪些表
from app.models import (
    SeparationTask,
    StemFile,
    Score,
    User,
    PendingUser,
    EmailVerification,
    OutboxEmail,
    AudioResource,
    SystemLog,
    SystemConfig,
    Notification,
    ExpertMessage,
)


async def init_db():
    """
    初始化数据库表结构，并在结束前显式关闭连接池，避免 aiomysql 在事件循环关闭后再清理连接
    导致的 "Event loop is closed" 警告。
    """
    from sqlalchemy import text
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            
            # 修改 users 表的 username 字段为大小写敏感的 collation（如果表已存在）
            # 这样 "wzp" 和 "WZP" 可以被视为不同的用户名
            try:
                await conn.execute(
                    text("ALTER TABLE users MODIFY COLUMN username VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL")
                )
                print("✓ 已修改 users.username 字段为大小写敏感（utf8mb4_bin）")
            except Exception as e:
                # 如果修改失败（可能是表不存在或字段已经是正确的 collation），忽略错误
                error_str = str(e).lower()
                if "duplicate column name" not in error_str and "doesn't exist" not in error_str:
                    print(f"⚠️  修改 username collation 时出现警告（可忽略）: {e}")
        
        print("数据库表创建完成！")
        print(f"已创建的表: {list(Base.metadata.tables.keys())}")
    finally:
        # 显式关闭 AsyncEngine 内部的连接池和所有连接，防止 __del__ 在 loop 关闭后再调度任务
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(init_db())
