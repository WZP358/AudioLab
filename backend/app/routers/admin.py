from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Query, Body, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, and_
from sqlalchemy.exc import IntegrityError
from typing import Optional, List, Union
from pathlib import Path
import os
import time
import re
import uuid
import logging
from datetime import datetime

from app.database import get_db
from app.models import (
    User,
    Role,
    AudioResource,
    OperationLog,
    SeparationTask,
    StemFile,
    Score,
    ExpertMessage,
    Notification,
    NotificationRead,
)
from app.schemas import (
    UserListResponse,
    UserUpdateRequest,
    PaginatedUserListResponse,
    AudioResourceResponse,
    AudioResourceCreate,
    AudioResourceUpdate,
)
from app.routers.auth import get_current_user
from app.services.analysis_service import analyze_audio_file
from app.utils.log_helper import create_system_log, get_client_ip, get_user_agent

router = APIRouter(prefix="/api/admin", tags=["admin"])

# 统一的基础目录与结果目录，用于清理分离任务产生的本地文件
BASE_DIR = Path(__file__).resolve().parents[1]  # backend
RESULTS_DIR = Path(os.getenv("RESULTS_DIR", "results"))
if not RESULTS_DIR.is_absolute():
    RESULTS_DIR = BASE_DIR / RESULTS_DIR


# 管理员依赖函数
async def get_current_admin(current_user: User = Depends(get_current_user)):
    """确保当前用户是管理员"""
    if current_user.role != Role.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅管理员可访问此功能"
        )
    return current_user


async def _cascade_delete_expert_related_data(
    *,
    target_user: User,
    current_admin: User,
    req: Optional[Request],
    db: AsyncSession,
):
    """
    级联删除与专家账号相关的业务数据：
    - 该专家本人创建的分离任务及其 Stem、评分记录和本地结果文件
    - 该专家提交的主观评分记录（Score.user_id）
    - 该专家上传的音频资源及对应文件
    - 该专家发出的专家建议 / 站内信
    - 针对该专家的通知已读记录，以及仅针对该专家的定向通知

    说明：
    - 仅对 Role.EXPERT 生效，管理员账号仍只删除用户本身，保留审计数据。
    - 尽量在数据库事务内完成记录删除，文件删除失败不会回滚事务，仅记录警告日志。
    """
    # 仅专家执行级联清理
    if target_user.role != Role.EXPERT:
        return

    logger = logging.getLogger(__name__)

    user_id_int = int(target_user.id)
    user_id_str = str(target_user.id)

    # 收集需要删除的任务 ID 与相关本地文件路径
    file_paths: list[Path] = []
    task_result_dirs: list[Path] = []

    # 1) 查找该专家创建的所有分离任务
    task_result = await db.execute(
        select(SeparationTask).where(SeparationTask.user_id == user_id_str)
    )
    tasks = list(task_result.scalars().all())

    for task in tasks:
        # 原始上传文件
        if task.file_path:
            file_paths.append(Path(task.file_path))

        # 结果目录（backend/results/{task_id} 以及 /app/results/{task_id}）
        task_id_int = int(task.id)
        local_results_dir = RESULTS_DIR / str(task_id_int)
        docker_results_dir = Path("/app/results") / str(task_id_int)
        task_result_dirs.append(local_results_dir)
        task_result_dirs.append(docker_results_dir)

        # 所有 stem 文件
        stems_result = await db.execute(
            select(StemFile).where(StemFile.task_id == task_id_int)
        )
        stems = list(stems_result.scalars().all())
        for s in stems:
            if s.file_path:
                file_paths.append(Path(s.file_path))

        # 删除该任务相关的评分记录
        scores_result = await db.execute(
            select(Score).where(Score.task_id == task_id_int)
        )
        scores = list(scores_result.scalars().all())
        for sc in scores:
            await db.delete(sc)

        # 删除 stems
        for s in stems:
            await db.delete(s)

        # 删除任务本身
        await db.delete(task)

    # 2) 删除该专家作为评分人的所有 Score 记录（不论任务归属谁）
    extra_scores_result = await db.execute(
        select(Score).where(Score.user_id == user_id_str)
    )
    extra_scores = list(extra_scores_result.scalars().all())
    for sc in extra_scores:
        await db.delete(sc)

    # 3) 删除该专家上传的音频资源及对应文件
    audio_result = await db.execute(
        select(AudioResource).where(AudioResource.uploader_id == user_id_int)
    )
    audio_resources = list(audio_result.scalars().all())

    from app.routers.admin import AUDIO_RESOURCE_DIR  # type: ignore  # noqa: F401
    # 为避免循环引用问题，这里不重新导入，而是复用本模块已定义的 AUDIO_RESOURCE_DIR

    # AUDIO_RESOURCE_DIR 在下方音频管理区域已定义，这里仅静态类型提示
    try:
        audio_base_dir = AUDIO_RESOURCE_DIR  # type: ignore[name-defined]
    except Exception:
        # 理论上不会发生，仅作兜底
        audio_base_dir = Path(os.getenv("AUDIO_RESOURCE_DIR", "audio_resources"))
        if not audio_base_dir.is_absolute():
            audio_base_dir = BASE_DIR / audio_base_dir

    for res in audio_resources:
        # 记录文件路径
        if res.file_path:
            if str(res.file_path).startswith("/audio_resources/"):
                relative_path = str(res.file_path).replace("/audio_resources/", "", 1)
                fp = audio_base_dir / relative_path
            else:
                fp = Path(res.file_path)
            file_paths.append(fp)
        await db.delete(res)

    # 4) 删除专家建议 / 站内信
    msg_result = await db.execute(
        select(ExpertMessage).where(ExpertMessage.expert_id == user_id_int)
    )
    messages = list(msg_result.scalars().all())
    for msg in messages:
        await db.delete(msg)

    # 5) 删除通知已读记录 & 针对该专家的定向通知
    nr_result = await db.execute(
        select(NotificationRead).where(NotificationRead.user_id == user_id_int)
    )
    nr_items = list(nr_result.scalars().all())
    for nr in nr_items:
        await db.delete(nr)

    notif_result = await db.execute(
        select(Notification).where(
            Notification.target_type == "specific",
            Notification.target_id == user_id_int,
        )
    )
    notifs = list(notif_result.scalars().all())
    for n in notifs:
        await db.delete(n)

    # 提交数据库层面的所有删除
    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        logger.error(
            "级联删除专家相关数据失败（数据库层）：user_id=%s err=%s",
            user_id_int,
            e,
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail=f"删除专家关联数据失败：{type(e).__name__}: {str(e)}",
        )

    # 提交成功后再尝试删除本地文件，失败仅记录日志
    def _safe_remove(p: Path):
        try:
            if p.is_file():
                p.unlink(missing_ok=True)  # type: ignore[call-arg]
            elif p.is_dir():
                for child in p.rglob("*"):
                    if child.is_file():
                        child.unlink(missing_ok=True)  # type: ignore[call-arg]
                p.rmdir()
        except Exception as e:
            logger.warning("删除文件/目录失败: path=%s err=%s", p, e)

    for fp in file_paths:
        _safe_remove(fp)

    for d in task_result_dirs:
        _safe_remove(d)


# ==================== 用户管理 ====================

@router.get("/users", response_model=PaginatedUserListResponse)
async def list_users(
    role: Optional[str] = Query(None, description="按角色筛选"),
    is_active: Optional[bool] = Query(None, description="按激活状态筛选"),
    is_approved: Optional[bool] = Query(None, description="按审批状态筛选"),
    search: Optional[str] = Query(None, description="搜索用户名或邮箱"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取用户列表（支持筛选、搜索、分页）"""
    query = select(User)
    
    # 构建筛选条件
    conditions = []
    if role:
        try:
            role_enum = Role(role)
            conditions.append(User.role == role_enum)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"无效的角色: {role}")
    
    if is_active is not None:
        conditions.append(User.is_active == is_active)
    
    if is_approved is not None:
        conditions.append(User.is_approved == is_approved)
    
    if search:
        search_pattern = f"%{search}%"
        conditions.append(
            or_(
                User.username.like(search_pattern),
                User.email.like(search_pattern)
            )
        )
    
    if conditions:
        query = query.where(and_(*conditions))
    
    # 获取总数
    count_query = select(func.count()).select_from(User)
    if conditions:
        count_query = count_query.where(and_(*conditions))
    total_result = await db.execute(count_query)
    total = total_result.scalar_one()
    
    # 分页
    offset = (page - 1) * page_size
    query = query.order_by(User.created_at.desc()).offset(offset).limit(page_size)
    
    result = await db.execute(query)
    users = result.scalars().all()
    
    return PaginatedUserListResponse(
        items=[UserListResponse.from_orm(user) for user in users],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size,
    )


@router.get("/users/stats")
async def get_user_stats(
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取用户统计信息"""
    # 总用户数
    total_query = select(func.count(User.id))
    total_result = await db.execute(total_query)
    total = total_result.scalar_one()
    
    # 按角色统计
    role_query = select(User.role, func.count(User.id)).group_by(User.role)
    role_result = await db.execute(role_query)
    role_stats = {role.value: count for role, count in role_result.all()}
    
    # 激活/未激活统计
    active_query = select(func.count(User.id)).where(User.is_active == True)
    active_result = await db.execute(active_query)
    active_count = active_result.scalar_one()
    
    # 已审批/未审批统计
    approved_query = select(func.count(User.id)).where(User.is_approved == True)
    approved_result = await db.execute(approved_query)
    approved_count = approved_result.scalar_one()
    
    return {
        "total": total,
        "active": active_count,
        "inactive": total - active_count,
        "approved": approved_count,
        "pending": total - approved_count,
        "by_role": role_stats
    }


@router.get("/users/{user_id}", response_model=UserListResponse)
async def get_user(
    user_id: int,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取用户详情"""
    query = select(User).where(User.id == user_id)
    result = await db.execute(query)
    user = result.scalars().first()
    
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    
    return UserListResponse.from_orm(user)


@router.put("/users/{user_id}", response_model=UserListResponse)
async def update_user(
    user_id: int,
    update_data: UserUpdateRequest,
    req: Request,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """更新用户信息"""
    # 1) 先按 ID 精确查 users 表
    query = select(User).where(User.id == user_id)
    result = await db.execute(query)
    user = result.scalars().first()

    # 2) 如果按 ID 没找到，尝试按 email / username 兜底查 users 表
    #    这样可以处理历史上因为前端 ID 精度问题导致的"假 ID"，
    #    但前端传来的邮箱 / 用户名仍然能对应到真实 users 记录
    if not user:
        fallback_user = None
        if update_data.email:
            fb_query = select(User).where(User.email == update_data.email)
            fb_result = await db.execute(fb_query)
            fallback_user = fb_result.scalars().first()

        if not fallback_user and update_data.username:
            fb_query = select(User).where(User.username == update_data.username)
            fb_result = await db.execute(fb_query)
            fallback_user = fb_result.scalars().first()

        if fallback_user:
            user = fallback_user
        else:
            raise HTTPException(status_code=404, detail="用户不存在或已被删除，请刷新列表后重试")
    
    # 更新字段
    update_dict = update_data.dict(exclude_unset=True)
    
    # 验证角色
    if "role" in update_dict:
        try:
            update_dict["role"] = Role(update_dict["role"])
        except ValueError:
            raise HTTPException(status_code=400, detail=f"无效的角色: {update_dict['role']}")
    
    # 如果更新用户名，检查新用户名是否已存在（大小写敏感）
    if "username" in update_dict and update_dict["username"] != user.username:
        from sqlalchemy import text, bindparam
        q_username_check = select(User).where(
            text("BINARY users.username = :username").bindparams(bindparam("username", update_dict["username"]))
        ).where(User.id != user_id)
        result_check = await db.execute(q_username_check)
        existing_user = result_check.scalars().first()
        if existing_user:
            raise HTTPException(status_code=400, detail="用户名已被使用，请选择其他用户名")
    
    for key, value in update_dict.items():
        setattr(user, key, value)
    
    try:
        await db.commit()
        await db.refresh(user)
        # 记录系统日志
        update_fields = ", ".join([f"{k}={v}" for k, v in update_dict.items()])
        await create_system_log(
            db=db,
            operation_type=OperationLog.USER_UPDATE.value,
            user_id=current_user.id,
            username=current_user.username,
            resource_type="user",
            resource_id=user_id,
            description=f"管理员 {current_user.username} 更新用户 {user.username}：{update_fields}",
            status="success",
            ip_address=get_client_ip(req),
            user_agent=get_user_agent(req),
        )
        return UserListResponse.from_orm(user)
    except IntegrityError as e:
        await db.rollback()
        error_str = str(e.orig) if hasattr(e, 'orig') else str(e)
        # 记录失败日志
        await create_system_log(
            db=db,
            operation_type=OperationLog.USER_UPDATE.value,
            user_id=current_user.id,
            username=current_user.username,
            resource_type="user",
            resource_id=user_id,
            description=f"管理员 {current_user.username} 更新用户失败",
            status="failed",
            error_message=error_str,
            ip_address=get_client_ip(req),
            user_agent=get_user_agent(req),
        )
        if 'username' in error_str.lower():
            raise HTTPException(status_code=400, detail="用户名已被使用")
        elif 'email' in error_str.lower():
            raise HTTPException(status_code=400, detail="邮箱已被使用")
        raise HTTPException(status_code=400, detail="更新失败: 数据冲突")


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: int,
    req: Request,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """删除用户

    对于专家账号（Role.EXPERT）：
    - 在删除用户本身之前，会递归清理与该专家相关的业务数据：
      - 该专家创建的分离任务及其 Stem、评分记录和本地结果文件
      - 该专家提交的主观评分记录
      - 该专家上传的音频资源及对应文件
      - 该专家发出的专家建议 / 站内信
      - 针对该专家的通知已读记录及仅针对该专家的定向通知
    管理员账号只删除用户记录本身，保留审计日志和其他系统数据。
    """
    # 不能删除自己
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="不能删除自己的账户")
    
    query = select(User).where(User.id == user_id)
    result = await db.execute(query)
    user = result.scalars().first()

    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    # 检查是否是最后一个管理员
    if user.role == Role.ADMIN:
        admin_count_query = select(func.count(User.id)).where(
            User.role == Role.ADMIN, User.is_active == True
        )
        admin_count_result = await db.execute(admin_count_query)
        admin_count = admin_count_result.scalar_one()
        if admin_count <= 1:
            raise HTTPException(
                status_code=400, detail="不能删除最后一个活跃的管理员"
            )

    username_before_delete = user.username

    # 对专家账号执行级联清理
    await _cascade_delete_expert_related_data(
        target_user=user, current_admin=current_user, req=req, db=db
    )

    # 删除用户本身
    await db.delete(user)
    await db.commit()

    # 记录系统日志
    await create_system_log(
        db=db,
        operation_type=OperationLog.USER_DELETE.value,
        user_id=current_user.id,
        username=current_user.username,
        resource_type="user",
        resource_id=user_id,
        description=f"管理员 {current_user.username} 删除用户 {username_before_delete}",
        status="success",
        ip_address=get_client_ip(req),
        user_agent=get_user_agent(req),
    )
    
    return {"message": "用户已删除", "user_id": user_id}


@router.post("/users/batch_delete")
async def batch_delete_users(
    req: Request,
    user_ids: List[int] = Body(...),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """批量删除用户

    对于其中的专家账号（Role.EXPERT）：
    - 在删除用户本身之前，会递归清理与各自专家相关的业务数据（分离任务、评分、音频资源、专家建议、通知等）。
    管理员账号仍只删除用户记录本身，保留审计与系统级数据。
    """
    if not user_ids:
        raise HTTPException(status_code=400, detail="请至少选择一个用户")
    
    if len(user_ids) > 100:
        raise HTTPException(status_code=400, detail="一次最多删除100个用户")
    
    # 不能删除自己
    if current_user.id in user_ids:
        raise HTTPException(status_code=400, detail="不能删除自己的账户")
    
    query = select(User).where(User.id.in_(user_ids))
    result = await db.execute(query)
    users = result.scalars().all()

    if len(users) != len(user_ids):
        raise HTTPException(status_code=404, detail="部分用户不存在")

    # 检查是否会删除所有管理员
    admin_users = [u for u in users if u.role == Role.ADMIN and u.is_active]
    if admin_users:
        remaining_admin_query = select(func.count(User.id)).where(
            User.role == Role.ADMIN,
            User.is_active == True,
            ~User.id.in_([u.id for u in admin_users]),
        )
        remaining_admin_result = await db.execute(remaining_admin_query)
        remaining_admin_count = remaining_admin_result.scalar_one()
        if remaining_admin_count == 0:
            raise HTTPException(status_code=400, detail="不能删除所有活跃的管理员")

    deleted_count = 0
    deleted_usernames: list[str] = []

    # 先对每个专家账号执行级联清理，再删除用户记录本身
    for user in users:
        deleted_usernames.append(user.username)
        await _cascade_delete_expert_related_data(
            target_user=user, current_admin=current_user, req=req, db=db
        )
        await db.delete(user)
        deleted_count += 1

    await db.commit()

    # 记录系统日志
    await create_system_log(
        db=db,
        operation_type=OperationLog.USER_BATCH_DELETE.value,
        user_id=current_user.id,
        username=current_user.username,
        resource_type="user",
        description=f"管理员 {current_user.username} 批量删除 {deleted_count} 个用户：{', '.join(deleted_usernames[:5])}{'...' if len(deleted_usernames) > 5 else ''}",
        status="success",
        ip_address=get_client_ip(req),
        user_agent=get_user_agent(req),
    )
    
    return {
        "message": f"成功删除 {deleted_count} 个用户",
        "deleted_count": deleted_count
    }


# ==================== 音频资源管理 ====================

# 音频资源存储目录（本地开发：backend/audio_resources，支持通过环境变量覆盖）
AUDIO_RESOURCE_DIR = Path(os.getenv("AUDIO_RESOURCE_DIR", "audio_resources"))
if not AUDIO_RESOURCE_DIR.is_absolute():
    # 如果是相对路径，则相对于backend目录
    base_dir = Path(__file__).resolve().parents[1]  # backend/app/routers -> backend
    AUDIO_RESOURCE_DIR = base_dir / AUDIO_RESOURCE_DIR
AUDIO_RESOURCE_DIR.mkdir(parents=True, exist_ok=True)

def _extract_base_title_from_audio_title(title: Optional[str]) -> Optional[str]:
    """
    从 `SongName [Mixture]` / `SongName [Gold Vocals]` 等标题中提取基础标题 `SongName`。
    如果不符合约定，返回原始标题（去空格）或 None。
    """
    if not title:
        return None
    raw = str(title).strip()
    if not raw:
        return None
    # 约定：基础标题后紧跟一个空格和 '['，例如：`SongName [Mixture]`
    if " [" in raw:
        return raw.split(" [", 1)[0].strip() or raw
    return raw


def _extract_bundle_id_from_tags(tags: Optional[str]) -> Optional[str]:
    """
    兼容旧数据：从 tags 中解析形如 `bundle:<id>` 的 bundle 标识。
    当前新上传的成组音频主要依赖标题后缀约定，此函数用于避免历史接口 NameError。
    """
    if not tags:
        return None
    try:
        m = re.search(r"(?:^|[,\s])bundle:([A-Za-z0-9_-]+)", str(tags))
        return m.group(1) if m else None
    except Exception:
        return None


@router.post("/audio/upload", response_model=AudioResourceResponse)
async def upload_audio_resource(
    req: Request,
    file: UploadFile = File(...),
    title: str = Body(...),
    description: Optional[str] = Body(None),
    category: Optional[str] = Body(None),
    tags: Optional[str] = Body(None),
    is_public: bool = Body(True),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """上传音频资源"""
    # 从系统配置读取文件大小限制
    from app.utils.config_helper import get_config_value
    max_file_size_mb = await get_config_value(
        db, "max_audio_file_size_mb", 100, "MAX_AUDIO_FILE_SIZE_MB", int
    )
    MAX_FILE_SIZE = max_file_size_mb * 1024 * 1024
    
    # 验证文件类型
    allowed_extensions = {'.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac'}
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件格式。支持的格式: {', '.join(allowed_extensions)}"
        )
    
    # 验证标题长度
    if len(title.strip()) == 0:
        raise HTTPException(status_code=400, detail="标题不能为空")
    if len(title) > 255:
        raise HTTPException(status_code=400, detail="标题长度不能超过255个字符")
    
    # 生成唯一文件名
    file_id = str(uuid.uuid4())
    safe_filename = re.sub(r"[^A-Za-z0-9._-]", "_", file.filename)
    file_path = AUDIO_RESOURCE_DIR / f"{file_id}_{safe_filename}"
    
    # 保存文件（流式写入，避免大文件占用内存）
    file_size = 0
    try:
        with open(file_path, "wb") as f:
            while True:
                chunk = await file.read(8192)  # 8KB chunks
                if not chunk:
                    break
                file_size += len(chunk)
                if file_size > MAX_FILE_SIZE:
                    # 删除部分写入的文件
                    if file_path.exists():
                        file_path.unlink()
                    raise HTTPException(
                        status_code=400,
                        detail=f"文件大小超过限制（最大 {MAX_FILE_SIZE // (1024*1024)}MB）"
                    )
                f.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        if file_path.exists():
            file_path.unlink()
        raise HTTPException(status_code=500, detail=f"文件保存失败: {str(e)}")
    
    # 分析音频文件获取时长等信息
    duration = None
    try:
        analysis = analyze_audio_file(file_path)
        duration = analysis.duration_s
    except Exception as e:
        # 如果分析失败，不影响上传，但记录日志
        import logging
        logging.warning(f"音频文件分析失败 (文件: {file_path}): {str(e)}")
        pass
    
    # 创建资源记录（存储相对路径，便于静态文件服务）
    # 计算相对于音频资源目录的路径
    relative_path = file_path.relative_to(AUDIO_RESOURCE_DIR) if file_path.is_relative_to(AUDIO_RESOURCE_DIR) else file_path.name
    static_path = f"/audio_resources/{relative_path}"
    
    # 管理员上传显示为"官方"
    created_by = "官方"
    
    # 所有管理员上传的音频资源一律设为公开
    audio_resource = AudioResource(
        title=title,
        description=description,
        file_path=static_path,  # 使用静态文件路径
        file_size=file_size,
        duration=duration,
        file_format=file_ext[1:] if file_ext else None,  # 去掉点号
        category=category,
        tags=tags,
        uploader_id=current_user.id,
        created_by=created_by,
        is_public=True,
    )
    
    db.add(audio_resource)
    try:
        await db.commit()
        await db.refresh(audio_resource)
        # 记录系统日志
        await create_system_log(
            db=db,
            operation_type=OperationLog.AUDIO_UPLOAD.value,
            user_id=current_user.id,
            username=current_user.username,
            resource_type="audio",
            resource_id=audio_resource.id,
            description=f"管理员 {current_user.username} 上传音频资源：{title}",
            status="success",
            ip_address=get_client_ip(req),
            user_agent=get_user_agent(req),
        )
        return AudioResourceResponse.from_orm(audio_resource)
    except Exception as e:
        await db.rollback()
        # 删除已上传的文件
        if file_path.exists():
            file_path.unlink()
        # 记录失败日志
        await create_system_log(
            db=db,
            operation_type=OperationLog.AUDIO_UPLOAD.value,
            user_id=current_user.id,
            username=current_user.username,
            resource_type="audio",
            description=f"管理员 {current_user.username} 上传音频资源失败：{title}",
            status="failed",
            error_message=str(e),
            ip_address=get_client_ip(req),
            user_agent=get_user_agent(req),
        )
        raise HTTPException(status_code=500, detail=f"上传失败: {str(e)}")


@router.get("/audio", response_model=dict)
async def list_audio_resources(
    category: Optional[str] = Query(None, description="按分类筛选"),
    is_public: Optional[bool] = Query(None, description="按公开状态筛选"),
    search: Optional[str] = Query(None, description="搜索标题或描述（支持多关键词，空格分隔）"),
    uploader: Optional[str] = Query(None, description="按上传者搜索（用户名或'官方'）"),
    file_format: Optional[str] = Query(None, description="文件格式筛选（mp3, wav, flac等）"),
    min_duration: Optional[float] = Query(None, description="最小时长（秒）"),
    max_duration: Optional[float] = Query(None, description="最大时长（秒）"),
    min_size: Optional[int] = Query(None, description="最小文件大小（字节）"),
    max_size: Optional[int] = Query(None, description="最大文件大小（字节）"),
    sort_by: Optional[str] = Query("created_at", description="排序字段：created_at, download_count, duration, file_size, title"),
    sort_order: Optional[str] = Query("desc", description="排序顺序：asc, desc"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取音频资源列表（管理员视图，包含所有资源），支持高级搜索和筛选"""
    query = select(AudioResource)
    
    # 构建筛选条件
    conditions = []
    if category:
        conditions.append(AudioResource.category == category)
    
    if is_public is not None:
        conditions.append(AudioResource.is_public == is_public)
    
    # 文件格式筛选
    if file_format:
        conditions.append(AudioResource.file_format == file_format.lower())
    
    # 时长范围筛选
    if min_duration is not None:
        conditions.append(AudioResource.duration >= min_duration)
    if max_duration is not None:
        conditions.append(AudioResource.duration <= max_duration)
    
    # 文件大小范围筛选
    if min_size is not None:
        conditions.append(AudioResource.file_size >= min_size)
    if max_size is not None:
        conditions.append(AudioResource.file_size <= max_size)
    
    # 按上传者搜索
    if uploader:
        uploader_pattern = f"%{uploader}%"
        conditions.append(AudioResource.created_by.like(uploader_pattern))
    
    # 搜索功能（支持多关键词，空格分隔，仅按标题匹配）
    if search:
        keywords = [kw.strip() for kw in search.split() if kw.strip()]
        if keywords:
            search_conditions = []
            for keyword in keywords:
                search_pattern = f"%{keyword}%"
                search_conditions.append(AudioResource.title.like(search_pattern))
            if search_conditions:
                conditions.append(and_(*search_conditions))  # 所有关键词都要匹配
    
    if conditions:
        query = query.where(and_(*conditions))
    
    # 获取总数
    count_query = select(func.count()).select_from(AudioResource)
    if conditions:
        count_query = count_query.where(and_(*conditions))
    total_result = await db.execute(count_query)
    total = total_result.scalar_one()
    
    # 排序
    sort_field_map = {
        "created_at": AudioResource.created_at,
        "download_count": AudioResource.download_count,
        "duration": AudioResource.duration,
        "file_size": AudioResource.file_size,
        "title": AudioResource.title,
    }
    sort_field = sort_field_map.get(sort_by, AudioResource.created_at)
    if sort_order.lower() == "asc":
        query = query.order_by(sort_field.asc())
    else:
        query = query.order_by(sort_field.desc())
    
    # 分页
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)
    
    result = await db.execute(query)
    resources = result.scalars().all()
    
    return {
        "items": [AudioResourceResponse.from_orm(resource) for resource in resources],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size
    }


@router.get("/audio/stats")
async def get_audio_stats(
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取音频资源统计信息"""
    # 总资源数
    total_query = select(func.count(AudioResource.id))
    total_result = await db.execute(total_query)
    total = total_result.scalar_one()
    
    # 公开/私有统计
    public_query = select(func.count(AudioResource.id)).where(AudioResource.is_public == True)
    public_result = await db.execute(public_query)
    public_count = public_result.scalar_one()
    
    # 总下载次数
    download_query = select(func.sum(AudioResource.download_count))
    download_result = await db.execute(download_query)
    total_downloads = download_result.scalar_one() or 0
    
    # 按分类统计
    category_query = select(
        AudioResource.category,
        func.count(AudioResource.id)
    ).group_by(AudioResource.category)
    category_result = await db.execute(category_query)
    category_stats = {cat or "未分类": count for cat, count in category_result.all()}
    
    # 总文件大小
    size_query = select(func.sum(AudioResource.file_size))
    size_result = await db.execute(size_query)
    total_size = size_result.scalar_one() or 0
    
    return {
        "total": total,
        "public": public_count,
        "private": total - public_count,
        "total_downloads": total_downloads,
        "total_size_bytes": total_size,
        "total_size_mb": round(total_size / (1024 * 1024), 2),
        "by_category": category_stats
    }


@router.get("/audio/{resource_id}", response_model=AudioResourceResponse)
async def get_audio_resource(
    resource_id: str,  # 改为字符串类型，避免大整数精度丢失
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """获取音频资源详情"""
    # 确保 resource_id 是有效的整数（支持大整数）
    try:
        resource_id_int = int(resource_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="无效的资源ID")
    
    query = select(AudioResource).where(AudioResource.id == resource_id_int)
    result = await db.execute(query)
    resource = result.scalars().first()
    
    if not resource:
        raise HTTPException(status_code=404, detail="音频资源不存在")
    
    return AudioResourceResponse.from_orm(resource)


@router.put("/audio/{resource_id}", response_model=AudioResourceResponse)
async def update_audio_resource(
    resource_id: str,  # 改为字符串类型，避免大整数精度丢失
    update_data: AudioResourceUpdate,
    req: Request,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """更新音频资源信息"""
    # 确保 resource_id 是有效的整数（支持大整数）
    try:
        resource_id_int = int(resource_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="无效的资源ID")
    
    query = select(AudioResource).where(AudioResource.id == resource_id_int)
    result = await db.execute(query)
    resource = result.scalars().first()
    
    if not resource:
        raise HTTPException(status_code=404, detail="音频资源不存在")
    
    # 更新字段
    update_dict = update_data.dict(exclude_unset=True)
    for key, value in update_dict.items():
        setattr(resource, key, value)
    
    try:
        await db.commit()
        await db.refresh(resource)
        # 记录系统日志
        update_fields = ", ".join([f"{k}={v}" for k, v in update_dict.items()])
        await create_system_log(
            db=db,
            operation_type=OperationLog.AUDIO_UPDATE.value,
            user_id=current_user.id,
            username=current_user.username,
            resource_type="audio",
            resource_id=resource_id_int,
            description=f"管理员 {current_user.username} 更新音频资源 {resource.title}：{update_fields}",
            status="success",
            ip_address=get_client_ip(req),
            user_agent=get_user_agent(req),
        )
        return AudioResourceResponse.from_orm(resource)
    except Exception as e:
        await db.rollback()
        # 记录失败日志
        await create_system_log(
            db=db,
            operation_type=OperationLog.AUDIO_UPDATE.value,
            user_id=current_user.id,
            username=current_user.username,
            resource_type="audio",
            resource_id=resource_id_int,
            description=f"管理员 {current_user.username} 更新音频资源失败",
            status="failed",
            error_message=str(e),
            ip_address=get_client_ip(req),
            user_agent=get_user_agent(req),
        )
        raise HTTPException(status_code=500, detail=f"更新失败: {str(e)}")


@router.delete("/audio/{resource_id}")
async def delete_audio_resource(
    resource_id: str,  # 改为字符串类型，避免大整数精度丢失
    req: Request,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """删除音频资源"""
    # 确保 resource_id 是有效的整数（支持大整数）
    try:
        resource_id_int = int(resource_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="无效的资源ID")
    
    resource_id = resource_id_int

    # 先查出当前资源，用于决定是否需要"成组删除"
    query = select(AudioResource).where(AudioResource.id == resource_id)
    result = await db.execute(query)
    resource = result.scalars().first()

    if not resource:
        # 添加调试信息：检查是否有其他资源
        all_resources_query = select(AudioResource.id, AudioResource.title).limit(10)
        all_resources_result = await db.execute(all_resources_query)
        all_resources = all_resources_result.all()
        logging.warning(
            f"删除音频资源失败: resource_id={resource_id} (类型: {type(resource_id)}), "
            f"当前用户: {current_user.username}, 数据库中存在的前10个资源ID: {[r.id for r in all_resources]}"
        )
        raise HTTPException(status_code=404, detail="音频资源不存在")

    # 成组级联删除：
    # - 优先兼容旧数据：tags 中有 bundle:<id> 则按 tags 级联删除
    # - 否则按标题基础名 `BaseTitle [` 约定级联删除（Mixture + 4 个 Gold Stem）
    deleted_titles: list[str] = []
    file_deleted_count = 0

    bundle_id = _extract_bundle_id_from_tags(getattr(resource, "tags", None))
    base_title = _extract_base_title_from_audio_title(resource.title)

    resources_to_delete: list[AudioResource] = []

    if bundle_id:
        bundle_query = (
            select(AudioResource)
            .where(
                AudioResource.tags.isnot(None),
                AudioResource.tags.like(f"%bundle:{bundle_id}%"),
            )
        )
        bundle_result = await db.execute(bundle_query)
        resources_to_delete = bundle_result.scalars().all()
    elif base_title and resource.title and " [" in str(resource.title):
        # 只在看起来像"成组标题"的情况下做级联删除，避免误删普通资源
        group_query = select(AudioResource).where(AudioResource.title.like(f"{base_title} [%"))
        group_result = await db.execute(group_query)
        resources_to_delete = group_result.scalars().all()

    # 兜底：确保至少删除当前这一条
    if not resources_to_delete:
        resources_to_delete = [resource]

    # 去重（避免 tags + title 同时命中造成重复）
    unique_by_id: dict[int, AudioResource] = {}
    for r in resources_to_delete:
        if r and getattr(r, "id", None) is not None:
            unique_by_id[int(r.id)] = r
    resources_to_delete = list(unique_by_id.values())

    for r in resources_to_delete:
        deleted_titles.append(r.title)
        # 删除文件
        if r.file_path and str(r.file_path).startswith("/audio_resources/"):
            relative_path = str(r.file_path).replace("/audio_resources/", "", 1)
            file_path = AUDIO_RESOURCE_DIR / relative_path
        else:
            file_path = Path(r.file_path) if r.file_path else None

        if file_path and file_path.exists():
            try:
                file_path.unlink()
                file_deleted_count += 1
            except Exception as e:
                print(f"警告: 删除文件失败 {file_path}: {e}")

        await db.delete(r)

    await db.commit()
    deleted_count = len(resources_to_delete)

    # 记录系统日志
    if deleted_count > 1:
        group_label = bundle_id or base_title or (deleted_titles[0] if deleted_titles else resource_id)
        desc = (
            f"管理员 {current_user.username} 成组删除音频资源：{group_label}"
            f"（共 {deleted_count} 条，文件删除 {file_deleted_count} 个）"
        )
    else:
        desc = f"管理员 {current_user.username} 删除音频资源：{deleted_titles[0] if deleted_titles else resource_id}"

    await create_system_log(
        db=db,
        operation_type=OperationLog.AUDIO_DELETE.value,
        user_id=current_user.id,
        username=current_user.username,
        resource_type="audio",
        resource_id=resource_id,
        description=desc,
        status="success",
        ip_address=get_client_ip(req),
        user_agent=get_user_agent(req),
    )

    return {
        "message": f"音频资源已删除（共 {deleted_count} 条，文件删除 {file_deleted_count} 个）",
        "resource_id": resource_id,
        "deleted_count": deleted_count,
        "file_deleted_count": file_deleted_count,
        "bundle_id": bundle_id or base_title,
    }


@router.post("/audio/batch_delete")
async def batch_delete_audio_resources(
    req: Request,
    resource_ids: List[Union[int, str]] = Body(...),  # 支持字符串和整数，避免大整数精度丢失
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """批量删除音频资源"""
    if not resource_ids:
        raise HTTPException(status_code=400, detail="请至少选择一个资源")
    
    if len(resource_ids) > 100:
        raise HTTPException(status_code=400, detail="一次最多删除100个资源")
    
    # 转换所有 ID 为整数（支持字符串和整数）
    try:
        resource_ids_int = [int(rid) for rid in resource_ids]
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=400, detail=f"无效的资源ID: {str(e)}")
    
    query = select(AudioResource).where(AudioResource.id.in_(resource_ids_int))
    result = await db.execute(query)
    resources = result.scalars().all()

    if len(resources) != len(resource_ids_int):
        raise HTTPException(status_code=404, detail="部分资源不存在")

    # 扩展为"成组删除"：
    # - 优先：若资源 tags 带 bundle:<id>，按 bundle 级联
    # - 否则：按标题基础名 `BaseTitle [` 约定级联（Mixture + 4 Gold）
    all_resources_to_delete = list(resources)

    bundle_ids = set()
    base_titles = set()
    for res in resources:
        bid = _extract_bundle_id_from_tags(getattr(res, "tags", None))
        if bid:
            bundle_ids.add(bid)
        bt = _extract_base_title_from_audio_title(getattr(res, "title", None))
        # 只对"看起来像成组标题"的条目收集基础名，避免误扩散
        if bt and getattr(res, "title", None) and " [" in str(res.title):
            base_titles.add(bt)

    existing_ids = {r.id for r in all_resources_to_delete}

    if bundle_ids:
        bundle_conditions = [AudioResource.tags.like(f"%bundle:{bid}%") for bid in bundle_ids]
        bundle_query = select(AudioResource).where(AudioResource.tags.isnot(None), or_(*bundle_conditions))
        bundle_result = await db.execute(bundle_query)
        for r in bundle_result.scalars().all():
            if r.id not in existing_ids:
                all_resources_to_delete.append(r)
                existing_ids.add(r.id)

    if base_titles:
        title_conditions = [AudioResource.title.like(f"{bt} [%") for bt in base_titles]
        title_query = select(AudioResource).where(or_(*title_conditions))
        title_result = await db.execute(title_query)
        for r in title_result.scalars().all():
            if r.id not in existing_ids:
                all_resources_to_delete.append(r)
                existing_ids.add(r.id)

    deleted_count = 0
    file_deleted_count = 0
    deleted_titles = []
    # 保存资源信息用于记录活动（在删除前保存）
    resources_info = []

    for resource in all_resources_to_delete:
        deleted_titles.append(resource.title)
        # 保存资源信息
        resources_info.append(
            {
                "id": resource.id,
                "title": resource.title,
            }
        )
        # 删除文件
        if resource.file_path.startswith("/audio_resources/"):
            relative_path = resource.file_path.replace("/audio_resources/", "")
            file_path = AUDIO_RESOURCE_DIR / relative_path
        else:
            file_path = Path(resource.file_path)

        if file_path.exists():
            try:
                file_path.unlink()
                file_deleted_count += 1
            except Exception:
                pass

        await db.delete(resource)
        deleted_count += 1

    await db.commit()

    # 记录系统日志
    await create_system_log(
        db=db,
        operation_type=OperationLog.AUDIO_BATCH_DELETE.value,
        user_id=current_user.id,
        username=current_user.username,
        resource_type="audio",
        description=(
            f"管理员 {current_user.username} 批量删除 {deleted_count} 个音频资源"
            f"（包含按 bundle 级联删除的成组音频）："
            f"{', '.join(deleted_titles[:5])}{'...' if len(deleted_titles) > 5 else ''}"
        ),
        status="success",
        ip_address=get_client_ip(req),
        user_agent=get_user_agent(req),
    )

    return {
        "message": f"成功删除 {deleted_count} 个音频资源（文件删除 {file_deleted_count} 个）",
        "deleted_count": deleted_count,
        "file_deleted_count": file_deleted_count,
    }


@router.get("/audio/{resource_id}/download")
async def download_audio_resource(
    resource_id: str,  # 改为字符串类型，避免大整数精度丢失
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """下载音频资源（管理员专用，用于测试）"""
    from fastapi.responses import FileResponse, RedirectResponse
    
    # 确保 resource_id 是有效的整数（支持大整数）
    try:
        resource_id_int = int(resource_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="无效的资源ID")
    
    query = select(AudioResource).where(AudioResource.id == resource_id_int)
    result = await db.execute(query)
    resource = result.scalars().first()
    
    if not resource:
        raise HTTPException(status_code=404, detail="音频资源不存在")
    
    # 处理静态文件路径（/audio_resources/...）或绝对路径
    if resource.file_path.startswith("/audio_resources/"):
        # 静态文件路径，重定向到静态文件服务
        resource.download_count += 1
        await db.commit()
        return RedirectResponse(url=resource.file_path)
    else:
        # 绝对路径，使用FileResponse
        file_path = Path(resource.file_path)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="音频文件不存在")
        
        # 增加下载计数
        resource.download_count += 1
        await db.commit()
        
        return FileResponse(
            path=str(file_path),
            filename=Path(resource.file_path).name,
            media_type="audio/mpeg"
        )


@router.post("/audio/{resource_id}/reanalyze")
async def reanalyze_audio_duration(
    resource_id: str,
    current_user: User = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """重新分析音频资源的时长（管理员专用）"""
    # 确保 resource_id 是有效的整数（支持大整数）
    try:
        resource_id_int = int(resource_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="无效的资源ID")
    
    query = select(AudioResource).where(AudioResource.id == resource_id_int)
    result = await db.execute(query)
    resource = result.scalars().first()
    
    if not resource:
        raise HTTPException(status_code=404, detail="音频资源不存在")
    
    # 获取音频资源目录（与上传逻辑保持一致）
    audio_resource_dir = AUDIO_RESOURCE_DIR
    
    # 解析文件路径
    file_path = None
    if resource.file_path.startswith("/audio_resources/"):
        # 静态文件路径
        relative_path = resource.file_path.replace("/audio_resources/", "", 1)
        file_path = audio_resource_dir / relative_path
    else:
        # 绝对路径或相对路径
        file_path = Path(resource.file_path)
        if not file_path.is_absolute():
            file_path = audio_resource_dir / file_path
    
    # 检查文件是否存在
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"音频文件不存在: {file_path}")
    
    # 分析音频文件
    try:
        analysis = analyze_audio_file(file_path)
        duration = analysis.duration_s
        
        if duration and duration > 0:
            # 更新数据库
            resource.duration = duration
            await db.commit()
            
            # 记录系统日志
            await create_system_log(
                db=db,
                operation_type=OperationLog.AUDIO_UPDATE.value,
                user_id=current_user.id,
                username=current_user.username,
                resource_type="audio",
                resource_id=resource.id,
                description=f"管理员 {current_user.username} 重新分析音频资源时长：{resource.title} (新时长: {duration:.2f}秒)",
                status="success",
            )
            
            return {
                "success": True,
                "message": f"成功更新时长: {duration:.2f} 秒",
                "duration": duration
            }
        else:
            raise HTTPException(status_code=400, detail="分析结果无效：时长为 0")
            
    except Exception as e:
        logging.error(f"重新分析音频文件失败 (资源ID: {resource_id}, 文件: {file_path}): {str(e)}")
        
        # 记录失败日志
        await create_system_log(
            db=db,
            operation_type=OperationLog.AUDIO_UPDATE.value,
            user_id=current_user.id,
            username=current_user.username,
            resource_type="audio",
            resource_id=resource.id,
            description=f"管理员 {current_user.username} 重新分析音频资源时长失败：{resource.title}",
            status="failed",
            error_message=str(e),
        )
        
        raise HTTPException(status_code=500, detail=f"分析失败: {str(e)}")
