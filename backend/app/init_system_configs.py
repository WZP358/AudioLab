"""
初始化系统配置项
运行方式: python -m app.init_system_configs
"""
import asyncio
import os
from app.database import AsyncSessionLocal, engine
from app.models import SystemConfig
from sqlalchemy import select


# 预定义的配置项列表
DEFAULT_CONFIGS = [
    # ==================== 邮件配置 ====================
    {
        "key": "email.smtp_host",
        "value": os.getenv("SMTP_HOST", "smtp.qq.com"),
        "description": "SMTP服务器地址（如：smtp.qq.com, smtp.gmail.com）",
        "category": "email"
    },
    {
        "key": "email.smtp_port",
        "value": os.getenv("SMTP_PORT", "587"),
        "description": "SMTP服务器端口（常用：587, 465, 25）",
        "category": "email"
    },
    {
        "key": "email.smtp_user",
        "value": os.getenv("SMTP_USER", ""),
        "description": "SMTP登录用户名（通常是邮箱地址）",
        "category": "email"
    },
    {
        "key": "email.smtp_password",
        "value": os.getenv("SMTP_PASS", ""),
        "description": "SMTP登录密码或授权码（敏感信息，建议使用环境变量）",
        "category": "email"
    },
    {
        "key": "email.mail_from",
        "value": os.getenv("MAIL_FROM", ""),
        "description": "发件人邮箱地址（如果为空则使用smtp_user）",
        "category": "email"
    },
    {
        "key": "email.delivery_mode",
        "value": os.getenv("EMAIL_DELIVERY_MODE", "smtp"),
        "description": "邮件投递模式：smtp（真实发送）或 mock（仅记录日志，不实际发送）",
        "category": "email"
    },
    {
        "key": "email.verification_ttl_min",
        "value": "15",
        "description": "邮箱验证码有效期（分钟）",
        "category": "email"
    },
    {
        "key": "verification_send_interval_seconds",
        "value": "30",
        "description": "验证码发送间隔时间（秒），每个邮箱独立计算",
        "category": "email"
    },
    {
        "key": "verification_max_per_hour",
        "value": "5",
        "description": "每个邮箱每小时最多发送验证码次数",
        "category": "email"
    },
    {
        "key": "email.max_retries",
        "value": "3",
        "description": "邮件发送最大重试次数",
        "category": "email"
    },
    
    # ==================== 文件上传配置 ====================
    {
        "key": "upload.max_file_size_mb",
        "value": "100",
        "description": "单个文件最大上传大小（MB）",
        "category": "upload"
    },
    {
        "key": "upload.allowed_extensions",
        "value": "mp3,wav,flac,aac,m4a",
        "description": "允许上传的音频文件扩展名（逗号分隔）",
        "category": "upload"
    },
    {
        "key": "upload.max_files_per_user",
        "value": "10",
        "description": "每个用户同时可上传的最大文件数",
        "category": "upload"
    },
    {
        "key": "upload.auto_delete_days",
        "value": "30",
        "description": "上传文件自动删除天数（0表示不自动删除）",
        "category": "upload"
    },
    
    # ==================== 安全配置 ====================
    {
        "key": "security.jwt_expire_hours",
        "value": "24",
        "description": "JWT Token过期时间（小时）",
        "category": "security"
    },
    {
        "key": "security.password_min_length",
        "value": "8",
        "description": "密码最小长度",
        "category": "security"
    },
    {
        "key": "security.login_max_attempts",
        "value": "5",
        "description": "登录失败最大尝试次数（超过后锁定账户）",
        "category": "security"
    },
    {
        "key": "security.login_lockout_minutes",
        "value": "30",
        "description": "登录失败后账户锁定时间（分钟）",
        "category": "security"
    },
    {
        "key": "security.enable_captcha",
        "value": "false",
        "description": "是否启用验证码（true/false）",
        "category": "security"
    },
    {
        "key": "security.session_timeout_minutes",
        "value": "60",
        "description": "会话超时时间（分钟，0表示不超时）",
        "category": "security"
    },
    
    # ==================== 系统参数 ====================
    {
        "key": "system.site_name",
        "value": "AudioLab",
        "description": "网站名称",
        "category": "system"
    },
    {
        "key": "system.site_url",
        "value": "http://localhost:3000",
        "description": "网站URL",
        "category": "system"
    },
    {
        "key": "system.maintenance_mode",
        "value": "false",
        "description": "维护模式开关（true/false）",
        "category": "system"
    },
    {
        "key": "system.maintenance_message",
        "value": "系统维护中，请稍后再试",
        "description": "维护模式提示信息",
        "category": "system"
    },
    {
        "key": "system.timezone",
        "value": "Asia/Shanghai",
        "description": "系统时区",
        "category": "system"
    },
    {
        "key": "system.language",
        "value": "zh-CN",
        "description": "系统默认语言",
        "category": "system"
    },
    
    # ==================== 任务处理配置 ====================
    {
        "key": "task.max_concurrent_tasks",
        "value": "5",
        "description": "最大并发任务数",
        "category": "task"
    },
    {
        "key": "task.task_timeout_seconds",
        "value": "3600",
        "description": "任务超时时间（秒）",
        "category": "task"
    },
    {
        "key": "task.auto_cleanup_days",
        "value": "7",
        "description": "任务结果自动清理天数（0表示不自动清理）",
        "category": "task"
    },
    {
        "key": "task.enable_notification",
        "value": "true",
        "description": "任务完成时是否发送通知（true/false）",
        "category": "task"
    },
    
    # ==================== 分离/计算配置 ====================
    {
        "key": "separation_compute_mode",
        "value": os.getenv("SEPARATION_COMPUTE_MODE", "gpu"),
        "description": "分离任务运行模式：cpu 或 gpu（仅在支持 GPU 的环境下生效）",
        "category": "separation"
    },
    
    # ==================== 存储配置 ====================
    {
        "key": "storage_mode",
        "value": "local",
        "description": "数据源模式：local（本地存储）或 firestore（Firestore云存储）",
        "category": "system"
    },
    {
        "key": "storage.local_path",
        "value": "/app/uploads",
        "description": "本地存储路径",
        "category": "storage"
    },
    {
        "key": "storage.max_storage_gb",
        "value": "100",
        "description": "最大存储空间（GB）",
        "category": "storage"
    },
    
    # ==================== 通知配置 ====================
    {
        "key": "notification.enable_email",
        "value": "true",
        "description": "是否启用邮件通知（true/false）",
        "category": "notification"
    },
    {
        "key": "notification.enable_system",
        "value": "true",
        "description": "是否启用系统内通知（true/false）",
        "category": "notification"
    },
    {
        "key": "notification.retention_days",
        "value": "30",
        "description": "通知保留天数（0表示永久保留）",
        "category": "notification"
    },
    
    # ==================== 日志配置 ====================
    {
        "key": "log.level",
        "value": "INFO",
        "description": "日志级别：DEBUG, INFO, WARNING, ERROR",
        "category": "log"
    },
    {
        "key": "log.retention_days",
        "value": "90",
        "description": "日志保留天数",
        "category": "log"
    },
    {
        "key": "log.max_file_size_mb",
        "value": "100",
        "description": "单个日志文件最大大小（MB）",
        "category": "log"
    },
    
    # ==================== API配置 ====================
    {
        "key": "api.rate_limit_per_minute",
        "value": "60",
        "description": "API每分钟请求限制",
        "category": "api"
    },
    {
        "key": "api.enable_cors",
        "value": "true",
        "description": "是否启用CORS跨域（true/false）",
        "category": "api"
    },
    {
        "key": "api.cors_origins",
        "value": "http://localhost:3000,http://127.0.0.1:3000",
        "description": "允许的CORS来源（逗号分隔）",
        "category": "api"
    },
    
    # ==================== 用户配置 ====================
    {
        "key": "user.require_email_verification",
        "value": "true",
        "description": "注册时是否要求邮箱验证（true/false）",
        "category": "user"
    },
    {
        "key": "user.require_admin_approval",
        "value": "true",
        "description": "注册时是否要求管理员审批（true/false）",
        "category": "user"
    },
    {
        "key": "user.default_role",
        # 系统仅保留 expert / admin 两种身份，默认专家
        "value": "expert",
        "description": "新用户默认角色：expert, admin",
        "category": "user"
    },
]


async def init_system_configs():
    """初始化系统配置项（如果不存在则创建）"""
    async with AsyncSessionLocal() as db:
        try:
            created_count = 0
            updated_count = 0
            skipped_count = 0
            
            for config_data in DEFAULT_CONFIGS:
                # 检查配置是否已存在
                query = select(SystemConfig).where(SystemConfig.key == config_data["key"])
                result = await db.execute(query)
                existing = result.scalars().first()
                
                if existing:
                    # 如果配置已存在，检查是否需要更新描述、分类或值
                    updated = False
                    if existing.description != config_data.get("description"):
                        existing.description = config_data.get("description")
                        updated = True
                    if existing.category != config_data.get("category"):
                        existing.category = config_data.get("category")
                        updated = True
                    # 对于特定配置项，如果值是旧默认值，自动更新为新默认值
                    if config_data["key"] == "verification_send_interval_seconds" and existing.value == "60":
                        existing.value = config_data["value"]
                        updated = True
                    
                    if updated:
                        await db.commit()
                        updated_count += 1
                        print(f"✓ 更新配置: {config_data['key']}")
                    else:
                        skipped_count += 1
                        print(f"- 跳过配置（已存在）: {config_data['key']}")
                else:
                    # 创建新配置
                    config = SystemConfig(
                        key=config_data["key"],
                        value=config_data["value"],
                        description=config_data.get("description"),
                        category=config_data.get("category"),
                        updated_by=None  # 系统初始化
                    )
                    db.add(config)
                    await db.commit()
                    created_count += 1
                    print(f"+ 创建配置: {config_data['key']}")
            
            print("\n" + "="*60)
            print(f"配置初始化完成！")
            print(f"  创建: {created_count} 个")
            print(f"  更新: {updated_count} 个")
            print(f"  跳过: {skipped_count} 个")
            print(f"  总计: {len(DEFAULT_CONFIGS)} 个")
            print("="*60)
            
        except Exception as e:
            await db.rollback()
            print(f"❌ 初始化失败: {str(e)}")
            raise
        finally:
            # 显式关闭数据库引擎，避免事件循环关闭后的连接清理警告
            await engine.dispose()


if __name__ == "__main__":
    asyncio.run(init_system_configs())
