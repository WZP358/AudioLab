"""
系统配置辅助函数
从 SystemConfig 表读取配置，如果没有则使用环境变量或默认值
"""
import os
from typing import Optional, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models import SystemConfig


async def get_config_value(
    db: AsyncSession,
    key: str,
    default: Any = None,
    env_key: Optional[str] = None,
    config_type: type = str,
) -> Any:
    """
    获取系统配置值
    
    Args:
        db: 数据库会话
        key: 配置键
        default: 默认值（如果配置不存在且环境变量也不存在）
        env_key: 环境变量键名（如果为 None，则使用 key）
        config_type: 配置值类型（str, int, float, bool）
    
    Returns:
        配置值，已转换为指定类型
    """
    # 优先从 SystemConfig 读取
    try:
        query = select(SystemConfig).where(SystemConfig.key == key)
        result = await db.execute(query)
        config = result.scalars().first()
        
        if config and config.value:
            value = config.value.strip()
            # 根据类型转换
            if config_type == int:
                return int(value)
            elif config_type == float:
                return float(value)
            elif config_type == bool:
                return value.lower() in ('true', '1', 'yes', 'on')
            else:
                return value
    except Exception:
        # 如果读取失败，继续使用环境变量或默认值
        pass
    
    # 如果 SystemConfig 中没有，尝试从环境变量读取
    env_key = env_key or key
    env_value = os.getenv(env_key)
    
    if env_value is not None:
        try:
            if config_type == int:
                return int(env_value)
            elif config_type == float:
                return float(env_value)
            elif config_type == bool:
                return env_value.lower() in ('true', '1', 'yes', 'on')
            else:
                return env_value.strip()
        except (ValueError, AttributeError):
            pass
    
    # 返回默认值
    return default


async def get_config_value_sync(
    key: str,
    default: Any = None,
    env_key: Optional[str] = None,
    config_type: type = str,
) -> Any:
    """
    获取系统配置值（同步版本，不访问数据库）
    仅从环境变量读取，用于不需要数据库访问的场景
    
    Args:
        key: 配置键（仅用于日志）
        default: 默认值
        env_key: 环境变量键名（如果为 None，则使用 key）
        config_type: 配置值类型
    
    Returns:
        配置值
    """
    env_key = env_key or key
    env_value = os.getenv(env_key)
    
    if env_value is not None:
        try:
            if config_type == int:
                return int(env_value)
            elif config_type == float:
                return float(env_value)
            elif config_type == bool:
                return env_value.lower() in ('true', '1', 'yes', 'on')
            else:
                return env_value.strip()
        except (ValueError, AttributeError):
            pass
    
    return default
