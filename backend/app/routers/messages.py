from typing import Optional, List
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status, Query, Body, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, desc

from app.database import get_db
from app.models import User, Role, ExpertMessage, ExpertMessageStatus
from app.schemas import (
    ExpertMessageCreate,
    ExpertMessageResponse,
    PaginatedExpertMessageResponse,
    AdminReplyRequest,
)
from app.routers.auth import get_current_user
from app.utils.log_helper import create_system_log, get_client_ip, get_user_agent


router = APIRouter(prefix="/api/messages", tags=["messages"])


async def get_current_expert(current_user: User = Depends(get_current_user)) -> User:
    """确保当前用户是专家"""
    if current_user.role != Role.EXPERT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅专家可访问此功能",
        )
    return current_user


async def get_current_admin(current_user: User = Depends(get_current_user)) -> User:
    """确保当前用户是管理员"""
    if current_user.role != Role.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅管理员可访问此功能",
        )
    return current_user


# ==================== 专家侧接口 ====================


@router.post("/expert", response_model=ExpertMessageResponse)
async def create_expert_message(
    payload: ExpertMessageCreate,
    req: Request,
    current_user: User = Depends(get_current_expert),
    db: AsyncSession = Depends(get_db),
):
    """
    专家发送建议 / 站内信给管理员
    """
    subject = (payload.subject or "").strip()
    content = (payload.content or "").strip()

    if not subject:
        raise HTTPException(status_code=400, detail="主题不能为空")
    if len(subject) > 255:
        raise HTTPException(status_code=400, detail="主题长度不能超过255个字符")
    if not content:
        raise HTTPException(status_code=400, detail="内容不能为空")

    msg = ExpertMessage(
        expert_id=current_user.id,
        subject=subject,
        content=content,
        status=ExpertMessageStatus.PENDING,
        is_read_by_admin=False,
        is_read_by_expert=True,
    )
    db.add(msg)
    await db.flush()

    # 记录系统日志（不强依赖）
    try:
        await create_system_log(
            db=db,
            operation_type="expert_message_create",
            user_id=current_user.id,
            username=current_user.username,
            resource_type="expert_message",
            resource_id=msg.id,
            description=f"专家 {current_user.username} 提交建议：{subject}",
            status="success",
            ip_address=get_client_ip(req),
            user_agent=get_user_agent(req),
        )
    except Exception:
        pass

    await db.commit()
    await db.refresh(msg)
    return ExpertMessageResponse.from_orm(msg)


@router.get("/expert", response_model=List[ExpertMessageResponse])
async def list_my_messages(
    status_filter: Optional[ExpertMessageStatus] = Query(None, description="按状态筛选"),
    limit: int = Query(50, ge=1, le=200, description="最多返回条数"),
    current_user: User = Depends(get_current_expert),
    db: AsyncSession = Depends(get_db),
):
    """
    专家查看自己的历史建议列表（按时间倒序）
    """
    query = select(ExpertMessage).where(ExpertMessage.expert_id == current_user.id)
    if status_filter:
        query = query.where(ExpertMessage.status == status_filter)
    query = query.order_by(desc(ExpertMessage.created_at)).limit(limit)

    res = await db.execute(query)
    items = res.scalars().all()
    return [ExpertMessageResponse.from_orm(m) for m in items]


@router.get("/expert/{message_id}", response_model=ExpertMessageResponse)
async def get_my_message_detail(
    message_id: int,
    current_user: User = Depends(get_current_expert),
    db: AsyncSession = Depends(get_db),
):
    """
    专家查看单条建议详情，同时标记为"已读"（针对管理员回复的查看）
    """
    query = select(ExpertMessage).where(
        ExpertMessage.id == message_id,
        ExpertMessage.expert_id == current_user.id,
    )
    res = await db.execute(query)
    msg = res.scalars().first()
    if not msg:
        raise HTTPException(status_code=404, detail="消息不存在")

    if not msg.is_read_by_expert:
        msg.is_read_by_expert = True
        await db.commit()
        await db.refresh(msg)

    return ExpertMessageResponse.from_orm(msg)


# ==================== 管理员侧接口 ====================


@router.get("/admin", response_model=PaginatedExpertMessageResponse)
async def list_all_expert_messages(
    status_filter: Optional[ExpertMessageStatus] = Query(None, description="按状态筛选"),
    expert_id: Optional[int] = Query(None, description="按专家ID筛选"),
    search: Optional[str] = Query(None, description="按主题或内容模糊搜索"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    管理员查看所有专家建议（支持按状态、专家、关键词筛选，分页）
    """
    query = select(ExpertMessage)
    count_query = select(func.count()).select_from(ExpertMessage)

    conditions = []
    if status_filter:
        conditions.append(ExpertMessage.status == status_filter)
    if expert_id:
        conditions.append(ExpertMessage.expert_id == expert_id)
    if search:
        like_kw = f"%{search.strip()}%"
        conditions.append(
            (ExpertMessage.subject.like(like_kw)) | (ExpertMessage.content.like(like_kw))
        )

    if conditions:
        for cond in conditions:
            query = query.where(cond)
            count_query = count_query.where(cond)

    total_result = await db.execute(count_query)
    total = total_result.scalar_one()

    offset = (page - 1) * page_size
    query = query.order_by(
        desc(ExpertMessage.status == ExpertMessageStatus.PENDING),
        desc(ExpertMessage.created_at),
    ).offset(offset).limit(page_size)

    res = await db.execute(query)
    msgs = res.scalars().all()

    return PaginatedExpertMessageResponse(
        items=[ExpertMessageResponse.from_orm(m) for m in msgs],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size if total > 0 else 0,
    )


@router.get("/admin/{message_id}", response_model=ExpertMessageResponse)
async def get_expert_message_detail_admin(
    message_id: int,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    管理员查看单条专家建议详情，同时标记为"管理员已读"
    """
    query = select(ExpertMessage).where(ExpertMessage.id == message_id)
    res = await db.execute(query)
    msg = res.scalars().first()
    if not msg:
        raise HTTPException(status_code=404, detail="消息不存在")

    if not msg.is_read_by_admin:
        msg.is_read_by_admin = True
        await db.commit()
        await db.refresh(msg)

    return ExpertMessageResponse.from_orm(msg)


@router.post("/admin/{message_id}/reply", response_model=ExpertMessageResponse)
async def reply_expert_message(
    message_id: int,
    payload: AdminReplyRequest = Body(...),
    req: Request = None,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    管理员回复专家建议
    """
    query = select(ExpertMessage).where(ExpertMessage.id == message_id)
    res = await db.execute(query)
    msg = res.scalars().first()
    if not msg:
        raise HTTPException(status_code=404, detail="消息不存在")

    reply_text = (payload.reply_content or "").strip()
    if not reply_text:
        raise HTTPException(status_code=400, detail="回复内容不能为空")

    msg.reply_content = reply_text
    msg.status = ExpertMessageStatus.ANSWERED
    msg.replied_at = datetime.utcnow()
    msg.is_read_by_admin = True
    msg.is_read_by_expert = False

    # 记录系统日志（不强依赖）
    try:
        await create_system_log(
            db=db,
            operation_type="expert_message_reply",
            user_id=current_user.id,
            username=current_user.username,
            resource_type="expert_message",
            resource_id=msg.id,
            description=f"管理员 {current_user.username} 回复专家建议：{msg.subject}",
            status="success",
            ip_address=get_client_ip(req) if req else None,
            user_agent=get_user_agent(req) if req else None,
        )
    except Exception:
        pass

    await db.commit()
    await db.refresh(msg)
    return ExpertMessageResponse.from_orm(msg)

