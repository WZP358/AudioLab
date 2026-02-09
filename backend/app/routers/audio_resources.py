from fastapi import APIRouter, Depends, HTTPException, status, Query, Header, UploadFile, File, Body, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, and_, case
from typing import Optional, List
from pathlib import Path
from fastapi.responses import FileResponse
import os
import uuid
import re

from app.database import get_db
from app.models import AudioResource, User, Role, OperationLog
from app.schemas import AudioResourceResponse
from app.routers.auth import get_current_user
from app.services.analysis_service import analyze_audio_file
from app.utils.log_helper import create_system_log, get_client_ip, get_user_agent

router = APIRouter(prefix="/api/audio", tags=["audio_resources"])

# 音频资源存储目录（兼容Docker和本地环境）
AUDIO_RESOURCE_DIR = Path(os.getenv("AUDIO_RESOURCE_DIR", "/app/audio_resources"))
if not AUDIO_RESOURCE_DIR.is_absolute():
    base_dir = Path(__file__).resolve().parents[1]  # backend/app/routers -> backend
    AUDIO_RESOURCE_DIR = base_dir / AUDIO_RESOURCE_DIR
AUDIO_RESOURCE_DIR.mkdir(parents=True, exist_ok=True)


async def get_optional_user(authorization: Optional[str] = Header(None), db: AsyncSession = Depends(get_db)):
    """可选的用户认证，如果未提供token则返回None"""
    if not authorization:
        return None
    try:
        from app.routers.auth import SECRET_KEY, ALGORITHM
        import jwt
        from sqlalchemy import select
        
        parts = authorization.split(" ")
        token = parts[1] if len(parts) > 1 else parts[0]
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload.get("sub"))
        q = select(User).where(User.id == user_id)
        res = await db.execute(q)
        user = res.scalars().first()
        return user
    except:
        return None


@router.get("/resources", response_model=dict)
async def list_public_audio_resources(
    category: Optional[str] = Query(None, description="按分类筛选"),
    search: Optional[str] = Query(None, description="搜索标题、描述或标签（支持多关键词，空格分隔）"),
    uploader: Optional[str] = Query(None, description="按上传者搜索（用户名或'官方'）"),
    tags: Optional[str] = Query(None, description="标签筛选（逗号分隔多个标签）"),
    file_format: Optional[str] = Query(None, description="文件格式筛选（mp3, wav, flac等）"),
    min_duration: Optional[float] = Query(None, description="最小时长（秒）"),
    max_duration: Optional[float] = Query(None, description="最大时长（秒）"),
    min_size: Optional[int] = Query(None, description="最小文件大小（字节）"),
    max_size: Optional[int] = Query(None, description="最大文件大小（字节）"),
    sort_by: Optional[str] = Query("created_at", description="排序字段：created_at, download_count, duration, file_size, title"),
    sort_order: Optional[str] = Query("desc", description="排序顺序：asc, desc"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
    db: AsyncSession = Depends(get_db),
):
    """获取公开的音频资源列表（访客和专家可用），支持高级搜索和筛选"""
    query = select(AudioResource).where(AudioResource.is_public == True)
    
    # 构建筛选条件
    conditions = [AudioResource.is_public == True]
    
    # 分类筛选
    if category:
        conditions.append(AudioResource.category == category)
    
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
    
    # 标签筛选（支持多个标签，逗号分隔）
    if tags:
        tag_list = [tag.strip() for tag in tags.split(",") if tag.strip()]
        if tag_list:
            tag_conditions = []
            for tag in tag_list:
                tag_pattern = f"%{tag}%"
                tag_conditions.append(AudioResource.tags.like(tag_pattern))
            if tag_conditions:
                conditions.append(or_(*tag_conditions))
    
    # 按上传者搜索
    if uploader:
        uploader_pattern = f"%{uploader}%"
        conditions.append(AudioResource.created_by.like(uploader_pattern))
    
    # 搜索功能（支持多关键词，空格分隔）
    if search:
        keywords = [kw.strip() for kw in search.split() if kw.strip()]
        if keywords:
            search_conditions = []
            for keyword in keywords:
                search_pattern = f"%{keyword}%"
                search_conditions.append(
                    or_(
                        AudioResource.title.like(search_pattern),
                        AudioResource.description.like(search_pattern),
                        AudioResource.tags.like(search_pattern)  # 支持标签搜索
                    )
                )
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


@router.get("/resources/{resource_id}", response_model=AudioResourceResponse)
async def get_public_audio_resource(
    resource_id: int,
    db: AsyncSession = Depends(get_db),
):
    """获取公开音频资源详情"""
    query = select(AudioResource).where(
        AudioResource.id == resource_id,
        AudioResource.is_public == True
    )
    result = await db.execute(query)
    resource = result.scalars().first()
    
    if not resource:
        raise HTTPException(status_code=404, detail="音频资源不存在或未公开")
    
    return AudioResourceResponse.from_orm(resource)


@router.post("/resources/upload", response_model=AudioResourceResponse)
async def upload_audio_resource(
    req: Request,
    file: UploadFile = File(...),
    title: str = Body(...),
    description: Optional[str] = Body(None),
    category: Optional[str] = Body(None),
    tags: Optional[str] = Body(None),
    is_public: bool = Body(True),
    current_user: Optional[User] = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """上传音频资源（所有登录用户都可以上传）"""
    if not current_user:
        raise HTTPException(status_code=401, detail="请先登录")
    
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
    relative_path = file_path.relative_to(AUDIO_RESOURCE_DIR) if file_path.is_relative_to(AUDIO_RESOURCE_DIR) else file_path.name
    static_path = f"/audio_resources/{relative_path}"
    
    # 确定 created_by 字段：管理员显示"官方"，其他用户显示用户名
    created_by = "官方" if current_user.role == Role.ADMIN else current_user.username
    
    audio_resource = AudioResource(
        title=title,
        description=description,
        file_path=static_path,
        file_size=file_size,
        duration=duration,
        file_format=file_ext[1:] if file_ext else None,  # 去掉点号
        category=category,
        tags=tags,
        uploader_id=current_user.id,
        created_by=created_by,
        is_public=is_public,
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
            description=f"用户 {current_user.username} 上传音频资源：{title}",
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
            user_id=current_user.id if current_user else None,
            username=current_user.username if current_user else None,
            resource_type="audio",
            description=f"用户上传音频资源失败：{title}",
            status="failed",
            error_message=str(e),
            ip_address=get_client_ip(req),
            user_agent=get_user_agent(req),
        )
        raise HTTPException(status_code=500, detail=f"上传失败: {str(e)}")


@router.get("/resources/{resource_id}/download")
async def download_public_audio_resource(
    req: Request,
    resource_id: int,
    current_user: Optional[User] = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """下载公开的音频资源（访客和专家可用）"""
    query = select(AudioResource).where(
        AudioResource.id == resource_id,
        AudioResource.is_public == True
    )
    result = await db.execute(query)
    resource = result.scalars().first()
    
    if not resource:
        raise HTTPException(status_code=404, detail="音频资源不存在或未公开")
    
    # file_path 可能是静态文件路径（/audio_resources/...）或绝对路径
    if resource.file_path.startswith("/audio_resources/"):
        # 静态文件路径，需要找到实际的文件路径
        relative_path = resource.file_path.replace("/audio_resources/", "", 1)
        
        # 获取音频资源目录
        audio_resource_dir = Path(os.getenv("AUDIO_RESOURCE_DIR", "/app/audio_resources"))
        if not audio_resource_dir.is_absolute():
            base_dir = Path(__file__).resolve().parents[1]  # backend/app/routers -> backend
            audio_resource_dir = base_dir / audio_resource_dir
        
        # 构建实际文件路径
        file_path = audio_resource_dir / relative_path
        
        if not file_path.exists():
            raise HTTPException(status_code=404, detail=f"音频文件不存在: {file_path}")
        
        # 增加下载计数
        resource.download_count += 1
        await db.commit()
        
        # 根据文件扩展名确定媒体类型
        media_type = "audio/mpeg"  # 默认
        if file_path.suffix.lower() == ".wav":
            media_type = "audio/wav"
        elif file_path.suffix.lower() == ".flac":
            media_type = "audio/flac"
        elif file_path.suffix.lower() == ".ogg":
            media_type = "audio/ogg"
        elif file_path.suffix.lower() == ".m4a":
            media_type = "audio/mp4"
        elif file_path.suffix.lower() == ".aac":
            media_type = "audio/aac"
        
        return FileResponse(
            path=str(file_path),
            filename=file_path.name,
            media_type=media_type
        )
    else:
        # 绝对路径，使用FileResponse
        file_path = Path(resource.file_path)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="音频文件不存在")
        
        # 增加下载计数
        resource.download_count += 1
        await db.commit()
        
        # 根据文件扩展名确定媒体类型
        media_type = "audio/mpeg"  # 默认
        if file_path.suffix.lower() == ".wav":
            media_type = "audio/wav"
        elif file_path.suffix.lower() == ".flac":
            media_type = "audio/flac"
        elif file_path.suffix.lower() == ".ogg":
            media_type = "audio/ogg"
        elif file_path.suffix.lower() == ".m4a":
            media_type = "audio/mp4"
        elif file_path.suffix.lower() == ".aac":
            media_type = "audio/aac"
        
        return FileResponse(
            path=str(file_path),
            filename=file_path.name,
            media_type=media_type
        )


@router.get("/categories")
async def get_categories(
    db: AsyncSession = Depends(get_db),
):
    """获取所有音频资源分类列表"""
    query = select(
        AudioResource.category,
        func.count(AudioResource.id).label("count")
    ).where(
        AudioResource.is_public == True,
        AudioResource.category.isnot(None)
    ).group_by(AudioResource.category)
    
    result = await db.execute(query)
    categories = [{"name": cat, "count": count} for cat, count in result.all()]
    
    return {"categories": categories}


@router.get("/tags")
async def get_tags(
    db: AsyncSession = Depends(get_db),
):
    """获取所有标签列表（用于标签筛选）"""
    query = select(AudioResource.tags).where(
        AudioResource.is_public == True,
        AudioResource.tags.isnot(None)
    )
    result = await db.execute(query)
    
    # 收集所有标签
    all_tags = set()
    for row in result.all():
        if row[0]:
            tags = [tag.strip() for tag in row[0].split(",") if tag.strip()]
            all_tags.update(tags)
    
    # 统计每个标签的使用次数
    tag_counts = {}
    for tag in all_tags:
        tag_pattern = f"%{tag}%"
        count_query = select(func.count()).select_from(AudioResource).where(
            AudioResource.is_public == True,
            AudioResource.tags.like(tag_pattern)
        )
        count_result = await db.execute(count_query)
        tag_counts[tag] = count_result.scalar_one()
    
    # 按使用次数排序
    sorted_tags = sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)
    
    return {
        "tags": [{"name": tag, "count": count} for tag, count in sorted_tags]
    }


@router.get("/formats")
async def get_formats(
    db: AsyncSession = Depends(get_db),
):
    """获取所有文件格式列表（用于格式筛选）"""
    query = select(
        AudioResource.file_format,
        func.count(AudioResource.id).label("count")
    ).where(
        AudioResource.is_public == True,
        AudioResource.file_format.isnot(None)
    ).group_by(AudioResource.file_format)
    
    result = await db.execute(query)
    formats = [{"name": fmt, "count": count} for fmt, count in result.all() if fmt]
    
    return {"formats": formats}
