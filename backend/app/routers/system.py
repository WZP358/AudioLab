"""
系统管理相关API：日志、设置、通知等
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, and_, desc, exists
from typing import Optional, List, Tuple
from datetime import datetime, timedelta
import json
import csv
import io
import re
import logging
import json
from fastapi.responses import StreamingResponse, FileResponse

from app.database import get_db
from dotenv import load_dotenv
import os

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL", "mysql+aiomysql://audiolab:audiolab@db:3306/audiolab")
from app.models import (
    User, SystemLog, SystemConfig, Notification, NotificationRead,
    OperationLog, AudioResource, SeparationTask
)
from app.routers.admin import get_current_admin
from app.routers.auth import get_current_user
from app.utils.log_helper import create_system_log, get_client_ip, get_user_agent
from fastapi import Request
from pathlib import Path

router = APIRouter(prefix="/api/admin/system", tags=["system"])
def _extract_task_meta(metadata_json: Optional[str], comment: Optional[str]) -> dict:
    for raw in (metadata_json, comment):
        if not raw:
            continue
        try:
            data = json.loads(str(raw))
            if isinstance(data, dict):
                return data
        except Exception:
            continue
    return {}


# 公共配置端点（不需要管理员权限）
public_router = APIRouter(prefix="/api/system", tags=["system"])


# ==================== 配置选项定义 ====================

# 定义需要选项限制的配置项及其允许的值
CONFIG_OPTIONS = {
    "email.delivery_mode": ["smtp", "mock"],
    "storage_mode": ["local", "firestore"],
    "system.maintenance_mode": ["true", "false"],
    "security.enable_captcha": ["true", "false"],
    "task.enable_notification": ["true", "false"],
    "notification.enable_email": ["true", "false"],
    "notification.enable_system": ["true", "false"],
    "api.enable_cors": ["true", "false"],
    "user.require_email_verification": ["true", "false"],
    "user.require_admin_approval": ["true", "false"],
    # 系统仅保留 expert / admin 两种身份
    "user.default_role": ["expert", "admin"],
    "log.level": ["DEBUG", "INFO", "WARNING", "ERROR"],
    # 分离任务运行模式：CPU / GPU
    "separation_compute_mode": ["cpu", "gpu"],
}


def get_config_options(key: str) -> Optional[List[str]]:
    """
    获取配置项的可用选项
    
    Args:
        key: 配置键
        
    Returns:
        可用选项列表，如果该配置项不需要选项限制则返回None
    """
    return CONFIG_OPTIONS.get(key.strip())


def validate_config_value(key: str, value: str) -> None:
    """
    验证配置值是否在允许的选项中
    
    Args:
        key: 配置键
        value: 配置值
        
    Raises:
        HTTPException: 配置值不在允许的选项中时抛出
    """
    options = get_config_options(key)
    if options is not None:
        value_stripped = value.strip()
        value_lower = value_stripped.lower()
        
        # 检查精确匹配（区分大小写）
        if value_stripped in options:
            return
        
        # 对于布尔值配置（true/false），允许不区分大小写
        if value_lower in ["true", "false"] and value_lower in [opt.lower() for opt in options]:
            return
        
        # 对于其他配置，需要精确匹配
        raise HTTPException(
            status_code=400,
            detail=f"配置项 '{key}' 的值必须是以下选项之一：{', '.join(options)}。您提供的值：{value}"
        )


# ==================== 辅助函数：输入验证和错误处理 ====================

def parse_date(date_str: str, field_name: str = "日期") -> datetime:
    """
    解析日期字符串，失败时抛出友好的中文错误提示
    
    Args:
        date_str: 日期字符串
        field_name: 字段名称，用于错误提示
        
    Returns:
        datetime对象
        
    Raises:
        HTTPException: 日期格式错误时抛出
    """
    if not date_str or not date_str.strip():
        raise HTTPException(
            status_code=400,
            detail=f"{field_name}不能为空，请提供有效的日期格式（如：2024-01-01T00:00:00 或 2024-01-01）"
        )
    
    date_str = date_str.strip()
    
    # 尝试多种日期格式
    formats = [
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    ]
    
    # 先尝试 ISO 格式
    try:
        return datetime.fromisoformat(date_str.replace('Z', '+00:00'))
    except (ValueError, AttributeError):
        pass
    
    # 尝试其他格式
    for fmt in formats:
        try:
            return datetime.strptime(date_str, fmt)
        except ValueError:
            continue
    
    raise HTTPException(
        status_code=400,
        detail=f"{field_name}格式不正确，请使用标准格式（如：2024-01-01T00:00:00 或 2024-01-01）。您提供的值：{date_str}"
    )


def validate_date_range(start_date: Optional[str], end_date: Optional[str]) -> Tuple[Optional[datetime], Optional[datetime]]:
    """
    验证日期范围，确保开始日期不晚于结束日期
    
    Returns:
        (start_datetime, end_datetime) 元组
        
    Raises:
        HTTPException: 日期范围无效时抛出
    """
    start = None
    end = None
    
    if start_date:
        start = parse_date(start_date, "开始日期")
    
    if end_date:
        end = parse_date(end_date, "结束日期")
    
    if start and end and start > end:
        raise HTTPException(
            status_code=400,
            detail=f"日期范围无效：开始日期（{start_date}）不能晚于结束日期（{end_date}）"
        )
    
    return start, end


def validate_config_key(key: str) -> None:
    """
    验证配置键格式
    
    Raises:
        HTTPException: 配置键格式无效时抛出
    """
    if not key or not key.strip():
        raise HTTPException(
            status_code=400,
            detail="配置键不能为空，请输入有效的配置键名称"
        )
    
    key = key.strip()
    
    # 配置键只能包含字母、数字、下划线和连字符
    if not re.match(r'^[a-zA-Z0-9_-]+$', key):
        raise HTTPException(
            status_code=400,
            detail=f"配置键格式无效：只能包含字母、数字、下划线和连字符。您提供的值：{key}"
        )
    
    if len(key) > 100:
        raise HTTPException(
            status_code=400,
            detail=f"配置键长度不能超过100个字符。当前长度：{len(key)}"
        )


def validate_notification_type(notif_type: str) -> None:
    """
    验证通知类型
    
    Raises:
        HTTPException: 通知类型无效时抛出
    """
    valid_types = ["info", "warning", "error", "success"]
    if notif_type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail=f"通知类型无效：必须是以下之一：{', '.join(valid_types)}。您提供的值：{notif_type}"
        )


def validate_target_type(target_type: str, target_id: Optional[int] = None) -> None:
    """
    验证通知目标类型
    
    Raises:
        HTTPException: 目标类型无效时抛出
    """
    # 仅支持按全部 / 专家 / 指定用户推送
    valid_types = ["all", "expert", "specific"]
    if target_type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail=f"目标类型无效：必须是以下之一：{', '.join(valid_types)}。您提供的值：{target_type}"
        )
    
    if target_type == "specific" and not target_id:
        raise HTTPException(
            status_code=400,
            detail="当目标类型为 'specific' 时，必须提供目标用户ID（target_id）"
        )


# ==================== 系统日志 ====================

@router.get("/logs")
async def get_system_logs(
    operation_type: Optional[str] = Query(None, description="操作类型"),
    resource_type: Optional[str] = Query(None, description="资源类型"),
    user_id: Optional[int] = Query(None, description="用户ID"),
    username: Optional[str] = Query(None, description="用户名（模糊匹配）"),
    resource_id: Optional[int] = Query(None, description="资源ID"),
    ip_address: Optional[str] = Query(None, description="IP地址（模糊匹配）"),
    keyword: Optional[str] = Query(None, description="关键词（在用户名/描述/错误信息/操作类型/资源类型/IP中搜索）"),
    status_filter: Optional[str] = Query(None, description="状态筛选"),
    start_date: Optional[str] = Query(None, description="开始日期"),
    end_date: Optional[str] = Query(None, description="结束日期"),
    page: int = Query(1, ge=1, description="页码，从1开始"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量，最大100"),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取系统日志列表"""
    try:
        # 验证日期范围
        start, end = validate_date_range(start_date, end_date)
        
        query = select(SystemLog)
        conditions = []
        
        if operation_type:
            conditions.append(SystemLog.operation_type == operation_type)
        if resource_type:
            conditions.append(SystemLog.resource_type == resource_type)
        if user_id:
            if user_id <= 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"用户ID必须大于0。您提供的值：{user_id}"
                )
            conditions.append(SystemLog.user_id == user_id)
        if username:
            username = username.strip()
            if username:
                if len(username) > 100:
                    raise HTTPException(
                        status_code=400,
                        detail=f"用户名关键词长度不能超过100个字符。当前长度：{len(username)}"
                    )
                conditions.append(SystemLog.username.like(f"%{username}%"))
        if resource_id is not None:
            if resource_id <= 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"资源ID必须大于0。您提供的值：{resource_id}"
                )
            conditions.append(SystemLog.resource_id == resource_id)
        if ip_address:
            ip_address = ip_address.strip()
            if ip_address:
                if len(ip_address) > 50:
                    raise HTTPException(
                        status_code=400,
                        detail=f"IP关键词长度不能超过50个字符。当前长度：{len(ip_address)}"
                    )
                conditions.append(SystemLog.ip_address.like(f"%{ip_address}%"))
        if keyword:
            keyword = keyword.strip()
            if keyword:
                if len(keyword) > 200:
                    raise HTTPException(
                        status_code=400,
                        detail=f"关键词长度不能超过200个字符。当前长度：{len(keyword)}"
                    )
                like_kw = f"%{keyword}%"
                conditions.append(
                    or_(
                        SystemLog.username.like(like_kw),
                        SystemLog.description.like(like_kw),
                        SystemLog.error_message.like(like_kw),
                        SystemLog.operation_type.like(like_kw),
                        SystemLog.resource_type.like(like_kw),
                        SystemLog.ip_address.like(like_kw),
                    )
                )
        if status_filter:
            conditions.append(SystemLog.status == status_filter)
        if start:
            conditions.append(SystemLog.created_at >= start)
        if end:
            conditions.append(SystemLog.created_at <= end)
        
        if conditions:
            query = query.where(and_(*conditions))
        
        # 总数
        count_query = select(func.count()).select_from(SystemLog)
        if conditions:
            count_query = count_query.where(and_(*conditions))
        total_result = await db.execute(count_query)
        total = total_result.scalar_one()
        
        # 分页
        offset = (page - 1) * page_size
        query = query.order_by(desc(SystemLog.created_at)).offset(offset).limit(page_size)
        
        result = await db.execute(query)
        logs = result.scalars().all()
        
        return {
            "items": [
                {
                    "id": log.id,
                    "user_id": log.user_id,
                    "username": log.username,
                    "operation_type": log.operation_type,
                    "resource_type": log.resource_type,
                    "resource_id": log.resource_id,
                    "description": log.description,
                    "ip_address": log.ip_address,
                    "status": log.status,
                    "error_message": log.error_message,
                    "created_at": log.created_at.isoformat() if log.created_at else None,
                }
                for log in logs
            ],
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size if total > 0 else 0
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"获取系统日志失败：{str(e)}"
        )


@router.get("/logs/export")
async def export_system_logs(
    operation_type: Optional[str] = Query(None, description="操作类型"),
    resource_type: Optional[str] = Query(None, description="资源类型"),
    user_id: Optional[int] = Query(None, description="用户ID"),
    username: Optional[str] = Query(None, description="用户名（模糊匹配）"),
    resource_id: Optional[int] = Query(None, description="资源ID"),
    ip_address: Optional[str] = Query(None, description="IP地址（模糊匹配）"),
    keyword: Optional[str] = Query(None, description="关键词（在用户名/描述/错误信息/操作类型/资源类型/IP中搜索）"),
    status_filter: Optional[str] = Query(None, description="状态筛选"),
    start_date: Optional[str] = Query(None, description="开始日期"),
    end_date: Optional[str] = Query(None, description="结束日期"),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """导出系统日志为CSV"""
    try:
        # 验证日期范围
        start, end = validate_date_range(start_date, end_date)
        
        query = select(SystemLog)
        conditions = []
        
        if operation_type:
            conditions.append(SystemLog.operation_type == operation_type)
        if resource_type:
            conditions.append(SystemLog.resource_type == resource_type)
        if user_id:
            if user_id <= 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"用户ID必须大于0。您提供的值：{user_id}"
                )
            conditions.append(SystemLog.user_id == user_id)
        if username:
            username = username.strip()
            if username:
                if len(username) > 100:
                    raise HTTPException(
                        status_code=400,
                        detail=f"用户名关键词长度不能超过100个字符。当前长度：{len(username)}"
                    )
                conditions.append(SystemLog.username.like(f"%{username}%"))
        if resource_id is not None:
            if resource_id <= 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"资源ID必须大于0。您提供的值：{resource_id}"
                )
            conditions.append(SystemLog.resource_id == resource_id)
        if ip_address:
            ip_address = ip_address.strip()
            if ip_address:
                if len(ip_address) > 50:
                    raise HTTPException(
                        status_code=400,
                        detail=f"IP关键词长度不能超过50个字符。当前长度：{len(ip_address)}"
                    )
                conditions.append(SystemLog.ip_address.like(f"%{ip_address}%"))
        if keyword:
            keyword = keyword.strip()
            if keyword:
                if len(keyword) > 200:
                    raise HTTPException(
                        status_code=400,
                        detail=f"关键词长度不能超过200个字符。当前长度：{len(keyword)}"
                    )
                like_kw = f"%{keyword}%"
                conditions.append(
                    or_(
                        SystemLog.username.like(like_kw),
                        SystemLog.description.like(like_kw),
                        SystemLog.error_message.like(like_kw),
                        SystemLog.operation_type.like(like_kw),
                        SystemLog.resource_type.like(like_kw),
                        SystemLog.ip_address.like(like_kw),
                    )
                )
        if status_filter:
            conditions.append(SystemLog.status == status_filter)
        if start:
            conditions.append(SystemLog.created_at >= start)
        if end:
            conditions.append(SystemLog.created_at <= end)
        
        if conditions:
            query = query.where(and_(*conditions))
        
        query = query.order_by(desc(SystemLog.created_at))
        result = await db.execute(query)
        logs = result.scalars().all()
        
        if not logs:
            raise HTTPException(
                status_code=404,
                detail="没有找到符合条件的日志记录，无法导出"
            )
        
        # 生成CSV
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "ID", "用户ID", "用户名", "操作类型", "资源类型", "资源ID",
            "描述", "IP地址", "状态", "错误信息", "创建时间"
        ])
        
        for log in logs:
            writer.writerow([
                log.id, log.user_id, log.username, log.operation_type,
                log.resource_type, log.resource_id, log.description or "",
                log.ip_address or "", log.status, log.error_message or "",
                log.created_at.isoformat() if log.created_at else ""
            ])
        
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=system_logs.csv"}
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"导出系统日志失败：{str(e)}"
        )


# ==================== 系统设置 ====================

@router.get("/configs")
async def get_system_configs(
    category: Optional[str] = Query(None, description="配置分类"),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取系统配置列表"""
    query = select(SystemConfig)
    if category:
        query = query.where(SystemConfig.category == category)
    
    result = await db.execute(query)
    configs = result.scalars().all()
    
    return {
        "items": [
            {
                "id": config.id,
                "key": config.key,
                "value": config.value,
                "description": config.description,
                "category": config.category,
                "updated_by": config.updated_by,
                "updated_at": config.updated_at.isoformat() if config.updated_at else None,
                "options": get_config_options(config.key),  # 返回可用选项
            }
            for config in configs
        ]
    }

@router.post("/configs")
async def create_system_config(
    key: str = Body(..., embed=True, description="配置键"),
    value: str = Body("", embed=True, description="配置值"),
    description: Optional[str] = Body(None, embed=True, description="配置描述"),
    category: Optional[str] = Body(None, embed=True, description="配置分类"),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """创建系统配置（如果 key 已存在则报错）"""
    try:
        # 验证配置键格式
        validate_config_key(key)
        
        # 检查配置键是否已存在
        existing_q = select(SystemConfig).where(SystemConfig.key == key)
        existing_r = await db.execute(existing_q)
        existing = existing_r.scalars().first()
        if existing:
            raise HTTPException(
                status_code=400,
                detail=f"配置键 '{key}' 已存在，请使用不同的键名或使用更新接口修改现有配置"
            )
        
        # 验证描述和分类长度
        if description and len(description) > 500:
            raise HTTPException(
                status_code=400,
                detail=f"配置描述长度不能超过500个字符。当前长度：{len(description)}"
            )
        
        if category and len(category) > 50:
            raise HTTPException(
                status_code=400,
                detail=f"配置分类长度不能超过50个字符。当前长度：{len(category)}"
            )
        
        # 验证配置值是否在允许的选项中
        validate_config_value(key, value)

        config = SystemConfig(
            key=key.strip(),
            value=value,
            description=description.strip() if description else None,
            category=category.strip() if category else None,
            updated_by=current_user.id,
        )
        db.add(config)
        await db.commit()
        await db.refresh(config)
        
        return {
            "message": "配置创建成功",
            "config": {
                "id": config.id,
                "key": config.key,
                "value": config.value,
                "description": config.description,
                "category": config.category,
                "options": get_config_options(config.key),  # 返回可用选项
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"创建系统配置失败：{str(e)}"
        )


@router.get("/configs/{key}")
async def get_system_config(
    key: str,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取单个系统配置"""
    try:
        if not key or not key.strip():
            raise HTTPException(
                status_code=400,
                detail="配置键不能为空，请提供有效的配置键名称"
            )
        
        query = select(SystemConfig).where(SystemConfig.key == key.strip())
        result = await db.execute(query)
        config = result.scalars().first()
        
        if not config:
            raise HTTPException(
                status_code=404,
                detail=f"配置键 '{key}' 不存在，请检查配置键是否正确"
            )
        
        return {
            "id": config.id,
            "key": config.key,
            "value": config.value,
            "description": config.description,
            "category": config.category,
            "options": get_config_options(config.key),  # 返回可用选项
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"获取系统配置失败：{str(e)}"
        )


@router.put("/configs/{key}")
async def update_system_config(
    req: Request,
    key: str,
    value: str = Body(..., embed=True, description="配置值"),
    description: Optional[str] = Body(None, embed=True, description="配置描述"),
    category: Optional[str] = Body(None, embed=True, description="配置分类"),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """更新系统配置（如果不存在则创建）"""
    try:
        # 验证配置键格式
        validate_config_key(key)
        
        # 验证描述和分类长度
        if description is not None and len(description) > 500:
            raise HTTPException(
                status_code=400,
                detail=f"配置描述长度不能超过500个字符。当前长度：{len(description)}"
            )
        
        if category is not None and len(category) > 50:
            raise HTTPException(
                status_code=400,
                detail=f"配置分类长度不能超过50个字符。当前长度：{len(category)}"
            )
        
        # 验证配置值是否在允许的选项中
        validate_config_value(key, value)
        
        query = select(SystemConfig).where(SystemConfig.key == key.strip())
        result = await db.execute(query)
        config = result.scalars().first()
        
        if not config:
            # 创建新配置
            config = SystemConfig(
                key=key.strip(),
                value=value,
                description=description.strip() if description else None,
                category=category.strip() if category else None,
                updated_by=current_user.id
            )
            db.add(config)
            message = "配置创建成功"
            old_value = None
        else:
            old_value = config.value
            config.value = value
            if description is not None:
                config.description = description.strip()
            if category is not None:
                config.category = category.strip()
            config.updated_by = current_user.id
            message = "配置更新成功"
        
        await db.commit()
        await db.refresh(config)
        
        # 记录系统日志
        if key.startswith("algorithm_version."):
            algo_name = key.replace("algorithm_version.", "")
            old_v = (old_value or "").strip() if old_value is not None else ""
            new_v = (value or "").strip()
            op_desc = (
                f"管理员 {current_user.username} 更新算法版本配置：{algo_name} "
                f"'{old_v or '未设置'}' -> '{new_v or '未设置'}'"
            )
        else:
            op_desc = f"管理员 {current_user.username} {message}：{key} = {value[:100] if len(value) > 100 else value}"

        await create_system_log(
            db=db,
            operation_type=OperationLog.SYSTEM_CONFIG_UPDATE.value,
            user_id=current_user.id,
            username=current_user.username,
            resource_type="config",
            description=op_desc,
            status="success",
            ip_address=get_client_ip(req),
            user_agent=get_user_agent(req),
        )
        
        return {
            "message": message,
            "config": {
                "id": config.id,
                "key": config.key,
                "value": config.value,
                "description": config.description,
                "category": config.category,
                "options": get_config_options(config.key),  # 返回可用选项
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"更新系统配置失败：{str(e)}"
        )


@router.post("/configs/init-defaults")
async def init_default_configs(
    req: Request,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """初始化默认系统配置项"""
    try:
        from app.init_system_configs import DEFAULT_CONFIGS
        
        created_count = 0
        updated_count = 0
        skipped_count = 0
        
        for config_data in DEFAULT_CONFIGS:
            # 检查配置是否已存在
            query = select(SystemConfig).where(SystemConfig.key == config_data["key"])
            result = await db.execute(query)
            existing = result.scalars().first()
            
            if existing:
                # 如果配置已存在，检查是否需要更新描述或分类
                updated = False
                if existing.description != config_data.get("description"):
                    existing.description = config_data.get("description")
                    updated = True
                if existing.category != config_data.get("category"):
                    existing.category = config_data.get("category")
                    updated = True
                
                if updated:
                    await db.commit()
                    updated_count += 1
                else:
                    skipped_count += 1
            else:
                # 创建新配置
                config = SystemConfig(
                    key=config_data["key"],
                    value=config_data["value"],
                    description=config_data.get("description"),
                    category=config_data.get("category"),
                    updated_by=current_user.id
                )
                db.add(config)
                await db.commit()
                created_count += 1
        
        # 记录系统日志
        await create_system_log(
            db=db,
            operation_type=OperationLog.SYSTEM_CONFIG_UPDATE.value,
            user_id=current_user.id,
            username=current_user.username,
            resource_type="config",
            description=f"管理员 {current_user.username} 初始化默认系统配置：创建 {created_count} 个，更新 {updated_count} 个，跳过 {skipped_count} 个",
            status="success",
            ip_address=get_client_ip(req),
            user_agent=get_user_agent(req),
        )
        
        return {
            "message": "默认配置初始化完成",
            "created": created_count,
            "updated": updated_count,
            "skipped": skipped_count,
            "total": len(DEFAULT_CONFIGS)
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"初始化默认配置失败：{str(e)}"
        )


# ==================== 通知系统 ====================

@router.get("/notifications")
async def get_notifications(
    is_read: Optional[bool] = Query(None, description="是否已读"),
    type: Optional[str] = Query(None, description="通知类型"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取通知列表（管理员端，可以看到所有通知）"""
    # 管理员可见的通知范围：all / admin / expert / 针对自己的 specific
    visibility_conditions = [
        or_(
            Notification.target_type == "all",
            Notification.target_type == "admin",
            Notification.target_type == "expert",
            and_(
                Notification.target_type == "specific",
                Notification.target_id == current_user.id,
            ),
        )
    ]

    # 过滤过期通知
    visibility_conditions.append(
        or_(
            Notification.expires_at.is_(None),
            Notification.expires_at > datetime.utcnow(),
        )
    )

    # 基础条件
    conditions = list(visibility_conditions)
    if type:
        conditions.append(Notification.type == type)

    # 按当前管理员的已读状态筛选（使用 NotificationRead 表，基于 EXISTS）
    read_exists = exists(
        select(NotificationRead.id).where(
            NotificationRead.user_id == current_user.id,
            NotificationRead.notification_id == Notification.id,
        )
    )

    if is_read is True:
        # 只要当前管理员有已读记录即可
        conditions.append(read_exists)
    elif is_read is False:
        # 未读：当前管理员不存在已读记录
        conditions.append(~read_exists)

    base_query = select(Notification).where(and_(*conditions))

    # 总数
    count_query = select(func.count()).select_from(
        base_query.subquery()
    )
    total_result = await db.execute(count_query)
    total = total_result.scalar_one()

    # 分页
    offset = (page - 1) * page_size
    query = base_query.order_by(desc(Notification.created_at)).offset(offset).limit(page_size)

    result = await db.execute(query)
    notifications = result.scalars().all()

    # 预加载当前管理员对这些通知的已读记录
    notif_ids = [n.id for n in notifications]
    read_map: dict[int, NotificationRead] = {}
    if notif_ids:
        read_result = await db.execute(
            select(NotificationRead).where(
                NotificationRead.user_id == current_user.id,
                NotificationRead.notification_id.in_(notif_ids),
            )
        )
        for r in read_result.scalars().all():
            read_map[r.notification_id] = r

    return {
        "items": [
            {
                "id": str(notif.id),
                "title": notif.title,
                "content": notif.content,
                "type": notif.type,
                "is_read": notif.id in read_map,
                "read_at": read_map[notif.id].read_at.isoformat()
                if notif.id in read_map and read_map[notif.id].read_at
                else None,
                "created_at": notif.created_at.isoformat() if notif.created_at else None,
                "expires_at": notif.expires_at.isoformat() if notif.expires_at else None,
            }
            for notif in notifications
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size if total > 0 else 0,
    }


@router.post("/notifications")
async def create_notification(
    title: str = Body(..., description="通知标题"),
    content: str = Body(..., description="通知内容"),
    type: str = Body("info", description="通知类型：info, warning, error, success"),
    target_type: str = Body("all", description="目标类型：all, expert, specific"),
    target_id: Optional[int] = Body(None, description="目标用户ID（当target_type为specific时必填）"),
    expires_at: Optional[str] = Body(None, description="过期时间"),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """创建通知"""
    try:
        # 验证输入
        if not title or not title.strip():
            raise HTTPException(
                status_code=400,
                detail="通知标题不能为空，请输入有效的标题"
            )
        
        if not content or not content.strip():
            raise HTTPException(
                status_code=400,
                detail="通知内容不能为空，请输入有效的内容"
            )
        
        if len(title.strip()) > 200:
            raise HTTPException(
                status_code=400,
                detail=f"通知标题长度不能超过200个字符。当前长度：{len(title)}"
            )
        
        if len(content.strip()) > 2000:
            raise HTTPException(
                status_code=400,
                detail=f"通知内容长度不能超过2000个字符。当前长度：{len(content)}"
            )
        
        # 验证通知类型
        validate_notification_type(type)
        
        # 验证目标类型
        validate_target_type(target_type, target_id)
        
        # 验证目标用户是否存在（如果指定了特定用户）
        if target_type == "specific" and target_id:
            if target_id <= 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"目标用户ID必须大于0。您提供的值：{target_id}"
                )
            user_query = select(User).where(User.id == target_id)
            user_result = await db.execute(user_query)
            target_user = user_result.scalars().first()
            if not target_user:
                raise HTTPException(
                    status_code=404,
                    detail=f"目标用户ID {target_id} 不存在，请检查用户ID是否正确"
                )
        
        # 解析过期时间
        expires = None
        if expires_at:
            expires = parse_date(expires_at, "过期时间")
            # 检查过期时间是否在未来
            if expires <= datetime.utcnow():
                raise HTTPException(
                    status_code=400,
                    detail=f"过期时间必须是将来的时间。您提供的值：{expires_at}"
                )
        
        notification = Notification(
            title=title.strip(),
            content=content.strip(),
            type=type,
            target_type=target_type,
            target_id=target_id,
            expires_at=expires,
            created_by=current_user.id
        )
        
        db.add(notification)
        await db.commit()
        await db.refresh(notification)
        
        return {"message": "通知创建成功", "id": notification.id}
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"创建通知失败：{str(e)}"
        )


@public_router.put("/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """标记通知为已读（用户端）"""
    try:
        if notification_id <= 0:
            raise HTTPException(
                status_code=400,
                detail=f"通知ID必须大于0。您提供的值：{notification_id}"
            )
        
        query = select(Notification).where(Notification.id == notification_id)
        result = await db.execute(query)
        notification = result.scalars().first()
        
        if not notification:
            # 兼容前端：如果通知不存在（可能已被清理），不再返回404，
            # 而是视为“已读/已处理”，避免用户看到报错
            return {"message": f"通知ID {notification_id} 不存在，视为已处理"}
        
        # 检查用户是否有权限操作此通知
        # 规则：
        # - 所有用户都可以标记 target_type == "all" 的通知
        # - 管理员可以标记 target_type == "admin" 的通知
        # - 普通用户可以标记与自己角色匹配的通知（expert）
        # - 所有用户可以标记针对自己的 specific 通知
        can_read = False

        target_type = notification.target_type
        user_role = getattr(current_user.role, "value", str(current_user.role))

        if target_type == "all":
            can_read = True
        elif target_type == "admin" and user_role == "admin":
            can_read = True
        elif target_type == "expert" and user_role == "expert":
            can_read = True
        elif target_type == "specific" and notification.target_id == current_user.id:
            can_read = True
        
        if not can_read:
            raise HTTPException(
                status_code=403,
                detail="您没有权限操作此通知"
            )
        
        # 检查是否过期
        if notification.expires_at and notification.expires_at <= datetime.utcnow():
            raise HTTPException(
                status_code=400,
                detail="此通知已过期"
            )

        # 查找当前用户是否已有已读记录
        read_query = select(NotificationRead).where(
            NotificationRead.user_id == current_user.id,
            NotificationRead.notification_id == notification.id,
        )
        read_result = await db.execute(read_query)
        read_record = read_result.scalars().first()

        if not read_record:
            # 创建已读记录（仅影响当前用户）
            read_record = NotificationRead(
                user_id=current_user.id,
                notification_id=notification.id,
                read_at=datetime.utcnow(),
            )
            db.add(read_record)
            await db.commit()
            await db.refresh(read_record)
        else:
            # 已经是已读，不需要重复写入
            await db.commit()

        # 标记成功后重新计算当前用户未读数量（基于 NotificationRead 表 + EXISTS）
        user_role = getattr(current_user.role, "value", str(current_user.role))
        target_conditions = [
            Notification.target_type == "all",
            and_(
                Notification.target_type == "specific",
                Notification.target_id == current_user.id,
            ),
        ]
        if user_role == "expert":
            target_conditions.append(Notification.target_type == "expert")
        elif user_role == "admin":
            target_conditions.append(Notification.target_type == "admin")

        read_exists = exists(
            select(NotificationRead.id).where(
                NotificationRead.user_id == current_user.id,
                NotificationRead.notification_id == Notification.id,
            )
        )

        conditions = [
            or_(*target_conditions),
            or_(
                Notification.expires_at.is_(None),
                Notification.expires_at > datetime.utcnow(),
            ),
            ~read_exists,
        ]

        count_query = select(func.count(Notification.id)).where(and_(*conditions))
        count_result = await db.execute(count_query)
        unread_count = count_result.scalar_one()

        return {
            "message": "通知已标记为已读",
            "notification": {
                "id": notification.id,
                "is_read": True,
                "read_at": read_record.read_at.isoformat() if read_record.read_at else None,
            },
            "unread_count": unread_count,
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"标记通知为已读失败：{str(e)}"
        )


@router.put("/notifications/{notification_id}/read")
async def mark_notification_read_admin(
    notification_id: int,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """标记通知为已读（管理员端）"""
    try:
        if notification_id <= 0:
            raise HTTPException(
                status_code=400,
                detail=f"通知ID必须大于0。您提供的值：{notification_id}"
            )
        
        query = select(Notification).where(Notification.id == notification_id)
        result = await db.execute(query)
        notification = result.scalars().first()
        
        if not notification:
            raise HTTPException(
                status_code=404,
                detail=f"通知ID {notification_id} 不存在，请检查通知ID是否正确"
            )

        # 查找当前管理员是否已有已读记录
        read_query = select(NotificationRead).where(
            NotificationRead.user_id == current_user.id,
            NotificationRead.notification_id == notification.id,
        )
        read_result = await db.execute(read_query)
        read_record = read_result.scalars().first()

        if not read_record:
            read_record = NotificationRead(
                user_id=current_user.id,
                notification_id=notification.id,
                read_at=datetime.utcnow(),
            )
            db.add(read_record)
            await db.commit()
            await db.refresh(read_record)
        else:
            await db.commit()

        # 标记成功后重新计算管理员端未读数量（基于 NotificationRead 表 + EXISTS）
        read_exists = exists(
            select(NotificationRead.id).where(
                NotificationRead.user_id == current_user.id,
                NotificationRead.notification_id == Notification.id,
            )
        )

        conditions = [
            or_(
                Notification.target_type == "all",
                Notification.target_type == "admin",
                and_(
                    Notification.target_type == "specific",
                    Notification.target_id == current_user.id,
                ),
            ),
            or_(
                Notification.expires_at.is_(None),
                Notification.expires_at > datetime.utcnow(),
            ),
            ~read_exists,
        ]

        count_query = select(func.count(Notification.id)).where(and_(*conditions))
        count_result = await db.execute(count_query)
        unread_count = count_result.scalar_one()

        return {
            "message": "通知已标记为已读",
            "notification": {
                "id": notification.id,
                "is_read": True,
                "read_at": read_record.read_at.isoformat() if read_record.read_at else None,
            },
            "unread_count": unread_count,
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"标记通知为已读失败：{str(e)}"
        )


@public_router.get("/notifications/unread-count")
async def get_unread_count(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取未读通知数量（用户端，按用户维度）"""
    # 构建目标类型条件（可见通知）
    user_role = getattr(current_user.role, "value", str(current_user.role))
    target_conditions = [
        Notification.target_type == "all",
        and_(
            Notification.target_type == "specific",
            Notification.target_id == current_user.id,
        ),
    ]

    # 如果是管理员，也可以看到 admin 类型的通知
    if user_role == "admin":
        target_conditions.append(Notification.target_type == "admin")
    # expert 角色可以看到专家通知
    elif user_role == "expert":
        target_conditions.append(Notification.target_type == "expert")

    # 当前用户是否已读的判定（EXISTS 表达式）
    read_exists = exists(
        select(NotificationRead.id).where(
            NotificationRead.user_id == current_user.id,
            NotificationRead.notification_id == Notification.id,
        )
    )

    conditions = [
        or_(*target_conditions),
        or_(
            Notification.expires_at.is_(None),
            Notification.expires_at > datetime.utcnow(),
        ),
        # 未读：当前用户不存在已读记录
        ~read_exists,
    ]

    query = select(func.count(Notification.id)).where(and_(*conditions))
    result = await db.execute(query)
    count = result.scalar_one()

    return {"count": count}


@router.get("/notifications/unread-count")
async def get_unread_count_admin(
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取未读通知数量（管理员端，按管理员维度）"""
    # 当前管理员是否已读的判定（EXISTS 表达式）
    read_exists = exists(
        select(NotificationRead.id).where(
            NotificationRead.user_id == current_user.id,
            NotificationRead.notification_id == Notification.id,
        )
    )

    conditions = [
        or_(
            Notification.target_type == "all",
            Notification.target_type == "admin",
            and_(
                Notification.target_type == "specific",
                Notification.target_id == current_user.id,
            ),
        ),
        or_(
            Notification.expires_at.is_(None),
            Notification.expires_at > datetime.utcnow(),
        ),
        # 未读：当前管理员不存在已读记录
        ~read_exists,
    ]

    query = select(func.count(Notification.id)).where(and_(*conditions))
    result = await db.execute(query)
    count = result.scalar_one()

    return {"count": count}


@router.get("/analytics/stats")
async def get_analytics_stats(
    days: int = Query(30, ge=1, le=365, description="统计天数"),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取统计分析数据"""
    end_date = datetime.utcnow()
    start_date = end_date - timedelta(days=days)
    
    # 用户增长趋势
    user_growth_query = select(
        func.date(User.created_at).label('date'),
        func.count(User.id).label('count')
    ).where(
        User.created_at >= start_date
    ).group_by(func.date(User.created_at)).order_by('date')
    
    user_growth_result = await db.execute(user_growth_query)
    user_growth = [
        {"date": str(row.date), "count": row.count}
        for row in user_growth_result.all()
    ]
    
    # 活跃用户数（按日期统计）- 基于系统日志统计
    active_users_daily_query = select(
        func.date(SystemLog.created_at).label('date'),
        func.count(func.distinct(SystemLog.user_id)).label('count')
    ).where(
        SystemLog.created_at >= start_date,
        SystemLog.user_id.isnot(None)
    ).group_by(func.date(SystemLog.created_at)).order_by('date')
    
    active_users_daily_result = await db.execute(active_users_daily_query)
    active_users_daily = [
        {"date": str(row.date), "count": row.count}
        for row in active_users_daily_result.all()
    ]
    
    # 总活跃用户数 - 基于系统日志统计
    active_users_query = select(func.count(func.distinct(SystemLog.user_id))).where(
        SystemLog.created_at >= start_date,
        SystemLog.user_id.isnot(None)
    )
    active_users_result = await db.execute(active_users_query)
    active_users = active_users_result.scalar_one_or_none() or 0
    
    # 资源下载统计
    download_stats_query = select(
        func.sum(AudioResource.download_count).label('total_downloads'),
        func.count(AudioResource.id).label('total_resources')
    )
    download_stats_result = await db.execute(download_stats_query)
    download_stats = download_stats_result.first()
    
    # 每日下载趋势（基于下载计数变化，这里统计资源创建和下载）
    # 由于下载计数是累计的，我们统计资源创建时的下载数变化
    download_trend_query = select(
        func.date(AudioResource.created_at).label('date'),
        func.sum(AudioResource.download_count).label('total_downloads')
    ).where(
        AudioResource.created_at >= start_date
    ).group_by(func.date(AudioResource.created_at)).order_by('date')
    
    download_trend_result = await db.execute(download_trend_query)
    download_trend = [
        {"date": str(row.date), "downloads": row.total_downloads or 0}
        for row in download_trend_result.all()
    ]
    
    # 资源上传趋势
    resource_upload_query = select(
        func.date(AudioResource.created_at).label('date'),
        func.count(AudioResource.id).label('count')
    ).where(
        AudioResource.created_at >= start_date
    ).group_by(func.date(AudioResource.created_at)).order_by('date')
    
    resource_upload_result = await db.execute(resource_upload_query)
    resource_upload = [
        {"date": str(row.date), "count": row.count}
        for row in resource_upload_result.all()
    ]
    
    # 资源类型分布（按文件格式）
    resource_format_query = select(
        AudioResource.file_format,
        func.count(AudioResource.id).label('count')
    ).where(
        AudioResource.created_at >= start_date
    ).group_by(AudioResource.file_format)
    
    resource_format_result = await db.execute(resource_format_query)
    resource_format_dist = [
        {"format": row.file_format or "未知", "count": row.count}
        for row in resource_format_result.all()
    ]
    
    # 资源分类分布
    resource_category_query = select(
        AudioResource.category,
        func.count(AudioResource.id).label('count')
    ).where(
        AudioResource.created_at >= start_date,
        AudioResource.category.isnot(None)
    ).group_by(AudioResource.category)
    
    resource_category_result = await db.execute(resource_category_query)
    resource_category_dist = [
        {"category": row.category, "count": row.count}
        for row in resource_category_result.all()
    ]
    
    # 操作类型统计
    operation_stats_query = select(
        SystemLog.operation_type,
        func.count(SystemLog.id).label('count')
    ).where(
        SystemLog.created_at >= start_date
    ).group_by(SystemLog.operation_type)
    
    operation_stats_result = await db.execute(operation_stats_query)
    operation_stats = [
        {"operation_type": row.operation_type, "count": row.count}
        for row in operation_stats_result.all()
    ]
    
    # 任务统计
    task_stats_query = select(
        SeparationTask.status,
        func.count(SeparationTask.id).label('count')
    ).where(
        SeparationTask.created_at >= start_date
    ).group_by(SeparationTask.status)
    
    task_stats_result = await db.execute(task_stats_query)
    task_stats = [
        {"status": row.status.value if hasattr(row.status, 'value') else str(row.status), "count": row.count}
        for row in task_stats_result.all()
    ]
    
    # 用户角色分布
    user_role_query = select(
        User.role,
        func.count(User.id).label('count')
    ).where(
        User.created_at >= start_date
    ).group_by(User.role)
    
    user_role_result = await db.execute(user_role_query)
    user_role_dist = [
        {"role": row.role.value if hasattr(row.role, 'value') else str(row.role), "count": row.count}
        for row in user_role_result.all()
    ]
    
    # 总用户数（直接从 User 表统计所有用户，不限制时间）
    total_users_query = select(func.count(User.id))
    total_users_result = await db.execute(total_users_query)
    total_users = total_users_result.scalar_one()
    # 确保返回整数类型
    if total_users is None:
        total_users = 0
    # 转换为整数类型
    total_users = int(total_users) if total_users is not None else 0
    # 调试日志
    logging.info(f"总用户数查询结果: {total_users} (类型: {type(total_users)})")
    # 调试日志
    logging.info(f"总用户数查询结果: {total_users} (类型: {type(total_users)})")
    
    # 统计期内新增用户数（用于用户增长卡片显示）
    new_users_in_period = sum(item["count"] for item in user_growth) if user_growth else 0
    
    # 总任务数（所有任务，不限制时间）
    total_tasks_query = select(func.count(SeparationTask.id))
    total_tasks_result = await db.execute(total_tasks_query)
    total_tasks = total_tasks_result.scalar_one_or_none() or 0
    
    # 总存储大小（资源文件，所有资源，不限制时间）
    total_storage_query = select(func.sum(AudioResource.file_size))
    total_storage_result = await db.execute(total_storage_query)
    total_storage = total_storage_result.scalar_one_or_none() or 0
    
    return {
        "user_growth": user_growth,
        "active_users": active_users or 0,
        "active_users_daily": active_users_daily,
        "total_downloads": (download_stats.total_downloads or 0) if download_stats else 0,
        "total_resources": (download_stats.total_resources or 0) if download_stats else 0,
        "download_trend": download_trend,
        "resource_upload": resource_upload,
        "resource_format_dist": resource_format_dist,
        "resource_category_dist": resource_category_dist,
        "operation_stats": operation_stats,
        "task_stats": task_stats,
        "user_role_dist": user_role_dist,
        "total_users": int(total_users) if total_users is not None else 0,  # 确保返回整数
        "new_users_in_period": new_users_in_period,  # 统计期内新增用户数
        "total_tasks": total_tasks,
        "total_storage": total_storage,
        "period": {
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "days": days
        }
    }


@router.get("/tasks/history")
async def get_all_task_history_admin(
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    管理员查看所有分离任务历史记录（简要信息，用于后台列表展示）。

    - 主要字段：id / user_id / original_filename / algorithm / status / created_at / completed_at；
    - 为避免一次性返回过多数据，强制分页。
    """
    page = max(1, int(page or 1))
    page_size = max(1, min(100, int(page_size or 20)))

    base_query = select(SeparationTask)
    count_query = select(func.count(SeparationTask.id))

    total_result = await db.execute(count_query)
    total = int(total_result.scalar() or 0)

    offset = (page - 1) * page_size
    base_query = base_query.order_by(
        SeparationTask.created_at.desc()
    ).offset(offset).limit(page_size)

    result = await db.execute(base_query)
    tasks = result.scalars().all()

    items = []
    for t in tasks:
        meta = _extract_task_meta(getattr(t, "metadata_json", None), getattr(t, "comment", None))
        items.append(
            {
                "id": str(t.id),
                "user_id": str(t.user_id) if t.user_id is not None else None,
                "original_filename": t.original_filename,
                "algorithm": t.algorithm.value if getattr(t, "algorithm", None) else None,
                "model_version": meta.get("model_version"),
                "status": t.status.value if getattr(t, "status", None) else None,
                "created_at": t.created_at.isoformat() if t.created_at else None,
                "completed_at": t.completed_at.isoformat() if t.completed_at else None,
            }
        )

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size if total > 0 else 0,
    }


# ==================== 用户端通知API ====================

@public_router.get("/notifications")
async def get_user_notifications(
    is_read: Optional[bool] = Query(None, description="是否已读"),
    type: Optional[str] = Query(None, description="通知类型"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取用户通知列表（用户端，按用户维度的已读状态）"""
    # 构建目标类型条件（可见通知）
    target_conditions = [
        Notification.target_type == "all",
        and_(
            Notification.target_type == "specific",
            Notification.target_id == current_user.id,
        ),
    ]

    # 根据用户角色添加对应的通知类型
    user_role = getattr(current_user.role, "value", str(current_user.role))
    if user_role == "expert":
        target_conditions.append(Notification.target_type == "expert")
    elif user_role == "admin":
        target_conditions.append(Notification.target_type == "admin")

    conditions = [
        or_(*target_conditions),
        or_(
            Notification.expires_at.is_(None),
            Notification.expires_at > datetime.utcnow(),
        ),
    ]

    if type:
        conditions.append(Notification.type == type)

    # 当前用户是否已读的判定（EXISTS 表达式）
    read_exists = exists(
        select(NotificationRead.id).where(
            NotificationRead.user_id == current_user.id,
            NotificationRead.notification_id == Notification.id,
        )
    )

    # 根据 is_read 参数过滤
    if is_read is True:
        conditions.append(read_exists)
    elif is_read is False:
        # 未读：当前用户不存在已读记录
        conditions.append(~read_exists)

    base_query = select(Notification).where(and_(*conditions))

    # 总数
    count_query = select(func.count()).select_from(base_query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar_one()

    # 分页
    offset = (page - 1) * page_size
    query = base_query.order_by(desc(Notification.created_at)).offset(offset).limit(page_size)

    result = await db.execute(query)
    notifications = result.scalars().all()

    # 预加载当前用户对这些通知的已读记录
    notif_ids = [n.id for n in notifications]
    read_map: dict[int, NotificationRead] = {}
    if notif_ids:
        read_result = await db.execute(
            select(NotificationRead).where(
                NotificationRead.user_id == current_user.id,
                NotificationRead.notification_id.in_(notif_ids),
            )
        )
        for r in read_result.scalars().all():
            read_map[r.notification_id] = r

    return {
        "items": [
            {
                "id": str(notif.id),
                "title": notif.title,
                "content": notif.content,
                "type": notif.type,
                "is_read": notif.id in read_map,
                "read_at": read_map[notif.id].read_at.isoformat()
                if notif.id in read_map and read_map[notif.id].read_at
                else None,
                "created_at": notif.created_at.isoformat() if notif.created_at else None,
                "expires_at": notif.expires_at.isoformat() if notif.expires_at else None,
            }
            for notif in notifications
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size if total > 0 else 0,
    }


# ==================== 公共配置端点 ====================

@public_router.get("/storage-mode")
async def get_storage_mode(
    db: AsyncSession = Depends(get_db),
):
    """获取数据源设置（公共端点，所有用户可访问）"""
    try:
        query = select(SystemConfig).where(SystemConfig.key == "storage_mode")
        result = await db.execute(query)
        config = result.scalars().first()
        
        # 如果配置不存在，返回默认值 "local"
        if not config:
            return {"storage_mode": "local"}
        
        # 验证值是否有效
        mode = config.value.strip().lower()
        if mode not in ["local", "firestore"]:
            return {"storage_mode": "local"}
        
        return {"storage_mode": mode}
    except Exception as e:
        # 出错时返回默认值
        return {"storage_mode": "local"}


@public_router.get("/compute-mode")
async def get_compute_mode(
    db: AsyncSession = Depends(get_db),
):
    """获取分离任务设备模式（公共端点，所有用户可访问）"""
    try:
        query = select(SystemConfig).where(SystemConfig.key == "separation_compute_mode")
        result = await db.execute(query)
        config = result.scalars().first()

        if config and config.value:
            mode = config.value.strip().lower()
        else:
            # 如果配置不存在，尝试从环境变量读取；否则默认 GPU
            mode = (os.getenv("SEPARATION_COMPUTE_MODE") or "gpu").strip().lower()

        if mode not in ["cpu", "gpu"]:
            mode = "gpu"

        return {"compute_mode": mode}
    except Exception:
        # 出错时返回默认值
        return {"compute_mode": "gpu"}
