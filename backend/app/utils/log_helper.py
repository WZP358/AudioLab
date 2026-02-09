"""
日志记录工具函数
"""
from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, Dict, Any
from app.models import SystemLog
import logging
import json

logger = logging.getLogger(__name__)


def get_client_ip(request: Request) -> Optional[str]:
    """
    从请求中获取客户端IP地址
    支持从 X-Forwarded-For、X-Real-IP 和客户端地址获取
    """
    # 优先从 X-Forwarded-For 获取（代理服务器设置）
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        # X-Forwarded-For 可能包含多个IP，取第一个
        return forwarded_for.split(",")[0].strip()
    
    # 其次从 X-Real-IP 获取
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip.strip()
    
    # 最后从客户端地址获取
    if request.client:
        return request.client.host
    
    return None


def get_user_agent(request: Request) -> Optional[str]:
    """
    从请求中获取用户代理（User-Agent）
    """
    return request.headers.get("User-Agent")


async def create_system_log(
    db: AsyncSession,
    operation_type: str,
    user_id: Optional[int] = None,
    username: Optional[str] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[int] = None,
    description: Optional[str] = None,
    status: str = "success",
    error_message: Optional[str] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> Optional[SystemLog]:
    """
    创建系统日志记录
    
    Args:
        db: 数据库会话
        operation_type: 操作类型（如 "user_create", "login" 等）
        user_id: 操作用户ID
        username: 操作用户名
        resource_type: 资源类型（如 "user", "audio" 等）
        resource_id: 资源ID
        description: 操作描述
        status: 状态（"success" 或 "failed"）
        error_message: 错误信息（失败时）
        ip_address: IP地址
        user_agent: 用户代理
    
    Returns:
        SystemLog 对象，如果创建失败则返回 None
    """
    try:
        # 创建日志记录
        log_entry = SystemLog(
            user_id=user_id,
            username=username,
            operation_type=operation_type,
            resource_type=resource_type,
            resource_id=resource_id,
            description=description,
            ip_address=ip_address,
            user_agent=user_agent,
            status=status,
            error_message=error_message,
        )
        
        db.add(log_entry)
        await db.commit()
        await db.refresh(log_entry)
        
        return log_entry
    except Exception as e:
        # 日志记录失败不应该影响主业务
        # 只记录错误，不抛出异常
        logger.error(f"创建系统日志失败: {str(e)}", exc_info=True)
        try:
            await db.rollback()
        except Exception:
            pass
        return None


