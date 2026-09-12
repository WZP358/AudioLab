"""
初始化数据库表结构
运行方式: python -m app.init_db
"""
import asyncio
import sys
from app.database import engine, Base
# 必须导入所有模型类，这样 SQLAlchemy 才能知道要创建哪些表
from app.models import (
    SeparationTask,
    StemFile,
    BlindSample,
    Score,
    StandardLabel,
    User,
    PendingUser,
    EmailVerification,
    OutboxEmail,
    AudioResource,
    SystemLog,
    SystemConfig,
    Notification,
    ExpertMessage,
    BlindExperiment,
    BlindAssignment,
)


async def init_db():
    """
    初始化数据库表结构，并在结束前显式关闭连接池，避免 aiomysql 在事件循环关闭后再清理连接
    导致的 "Event loop is closed" 警告。
    """
    from sqlalchemy import text
    # Windows PowerShell/CMD 可能使用 GBK，确保初始化日志不会因符号输出中断迁移。
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    try:
        print("数据库初始化：模型建表后请执行 backend/migrations/001_patent_scoring.sql 以复现专利评分结构")
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
            # 评分增强字段：对已有数据库幂等补列
            for ddl in (
                "ALTER TABLE separation_tasks MODIFY COLUMN status ENUM('PENDING','PROCESSING','COMPLETED','FAILED','CANCELLED') NULL",
                "ALTER TABLE scores ADD COLUMN overall_acceptability INT NULL",
                "ALTER TABLE scores ADD COLUMN blind_sample_id BIGINT NULL",
                "ALTER TABLE scores ADD COLUMN segment_start FLOAT NULL",
                "ALTER TABLE scores ADD COLUMN segment_end FLOAT NULL",
                "ALTER TABLE scores ADD COLUMN issue_tags TEXT NULL",
                "ALTER TABLE scores ADD COLUMN issue_annotations TEXT NULL",
                "ALTER TABLE scores ADD COLUMN reliability INT NULL",
                "ALTER TABLE scores ADD COLUMN updated_at DATETIME NULL",
                "ALTER TABLE scores ADD COLUMN version INT NOT NULL DEFAULT 1",
                "ALTER TABLE scores ADD COLUMN last_modified_by VARCHAR(255) NULL",
                "ALTER TABLE scores ADD COLUMN modification_reason VARCHAR(500) NULL",
                "ALTER TABLE scores ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE",
                "ALTER TABLE scores ADD COLUMN deleted_at DATETIME NULL",
                "ALTER TABLE scores ADD COLUMN deleted_by VARCHAR(255) NULL",
                "ALTER TABLE scores ADD COLUMN delete_reason VARCHAR(500) NULL",
                "ALTER TABLE blind_samples ADD COLUMN sample_group_key VARCHAR(255) NULL",
                "ALTER TABLE blind_samples ADD COLUMN experiment_id BIGINT NULL",
                "ALTER TABLE scores ADD UNIQUE INDEX uq_scores_user_blind_sample (user_id, blind_sample_id)",
            ):
                try:
                    await conn.execute(text(ddl))
                except Exception as e:
                    error_text = str(e).lower()
                    if "duplicate column" not in error_text and "duplicate key name" not in error_text and "already exists" not in error_text:
                        print(f"评分字段迁移提示（可忽略）: {e}")
            # 首次初始化时写入一组可编辑的标准标签
            from sqlalchemy import select
            from app.models import StandardLabel
            defaults = {
                "Vocals": ["音色变薄", "齿音异常", "人声残留", "伴奏残留"],
                "Drums": ["鼓点瞬态削弱", "鼓声起音模糊", "底鼓低频缺失", "镲片高频缺失"],
                "Bass": ["低频主体缺失", "基频能量削弱", "低频串扰", "延音不完整"],
                "Other": ["其他伴奏残留", "混响残留", "金属感伪影", "颗粒感伪影"],
            }
            for stem_name, labels in defaults.items():
                for label in labels:
                    exists_result = await conn.execute(select(StandardLabel).where(StandardLabel.stem_name == stem_name, StandardLabel.label == label))
                    if exists_result.first() is None:
                        await conn.execute(StandardLabel.__table__.insert().values(stem_name=stem_name, label=label, is_active=True))
        
        print("数据库表创建完成！")
        print(f"已创建的表: {list(Base.metadata.tables.keys())}")
    finally:
        # 显式关闭 AsyncEngine 内部的连接池和所有连接，防止 __del__ 在 loop 关闭后再调度任务
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(init_db())
