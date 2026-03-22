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

# 音频资源存储目录（本地开发：backend/audio_resources，支持通过环境变量覆盖）
AUDIO_RESOURCE_DIR = Path(os.getenv("AUDIO_RESOURCE_DIR", "audio_resources"))
if not AUDIO_RESOURCE_DIR.is_absolute():
    base_dir = Path(__file__).resolve().parents[1]  # backend/app/routers -> backend
    AUDIO_RESOURCE_DIR = base_dir / AUDIO_RESOURCE_DIR
AUDIO_RESOURCE_DIR.mkdir(parents=True, exist_ok=True)


@router.get("/resources/title-exists", response_model=dict)
async def check_audio_resource_title_exists(
    title: str = Query(..., description="要检查的标题；bundle=true 时表示基础标题"),
    bundle: bool = Query(False, description="是否按 bundle 基础标题检查（会检查 Mixture + 4 条 Gold 的 5 个派生标题）"),
    db: AsyncSession = Depends(get_db),
):
    """
    上传前标题查重（忽略大小写）。

    - bundle=false: 检查单个 title 是否已存在
    - bundle=true: 认为 title 是基础标题，检查 5 个派生标题是否任意已存在
    """
    raw = (title or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="标题不能为空")

    if bundle:
        titles = [
            f"{raw} [Mixture]",
            f"{raw} [Gold Vocals]",
            f"{raw} [Gold Drums]",
            f"{raw} [Gold Bass]",
            f"{raw} [Gold Other]",
        ]
    else:
        titles = [raw]

    normalized_titles = [t.lower() for t in titles]
    result = await db.execute(
        select(AudioResource.title).where(func.lower(AudioResource.title).in_(normalized_titles))
    )
    conflicts = [row[0] for row in result.all() if row and row[0]]
    return {"exists": len(conflicts) > 0, "conflicts": conflicts}


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
    search: Optional[str] = Query(None, description="搜索标题或描述（支持多关键词，空格分隔）"),
    bundle_title: Optional[str] = Query(
        None,
        description="按成组基础标题筛选（例如 SongName，将匹配 `SongName [Mixture]` / `SongName [Gold Vocals]` 等）",
    ),
    uploader: Optional[str] = Query(None, description="按上传者搜索（用户名或'官方'）"),
    file_format: Optional[str] = Query(None, description="文件格式筛选（mp3, wav, flac等）"),
    role: Optional[str] = Query(
        None,
        description="按资源角色筛选：mixture, gold_vocals, gold_drums, gold_bass, gold_other",
    ),
    role_group: Optional[str] = Query(
        None,
        description="按资源角色组筛选：gold（等价于 gold_vocals/drums/bass/other 的合集）",
    ),
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
    """
    获取公开的音频资源列表（访客和专家可用），支持高级搜索和筛选。

    前端播放器现在支持在客户端侧调整音频播放倍速（例如 0.5x / 1.5x 等），
    这不会改变后端存储的原始音频文件，也不会影响本接口的查询逻辑。
    """
    query = select(AudioResource).where(AudioResource.is_public == True)
    
    # 构建筛选条件
    conditions = [AudioResource.is_public == True]
    
    # 分类筛选
    if category:
        conditions.append(AudioResource.category == category)
    
    # 文件格式筛选
    if file_format:
        conditions.append(AudioResource.file_format == file_format.lower())

    # 成组基础标题筛选：`SongName [Mixture]` / `SongName [Gold Vocals]` 等
    if bundle_title:
        bt = bundle_title.strip()
        if bt:
            # 标题需以 `${bt} [` 开头（中间有一个空格是当前命名约定的一部分）
            conditions.append(AudioResource.title.like(f"{bt} [%"))
    
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

    # 资源角色筛选（基于标题后缀约定：`xxx [Mixture]` / `xxx [Gold Vocals]` 等）
    # 说明：这是为了兼容历史数据与现有库结构，不新增字段即可实现“Input Source 只能选 Mixture”等 UI 约束。
    if role:
        role = role.strip().lower()
        role_suffix_map = {
            "mixture": "[Mixture]",
            "gold_vocals": "[Gold Vocals]",
            "gold_drums": "[Gold Drums]",
            "gold_bass": "[Gold Bass]",
            "gold_other": "[Gold Other]",
        }
        suffix = role_suffix_map.get(role)
        if not suffix:
            raise HTTPException(status_code=400, detail="无效的 role 参数")
        # 标题以该后缀结尾（允许结尾前有空格）
        # 例如：`SongName [Mixture]`
        conditions.append(AudioResource.title.like(f"% {suffix}"))

    # 角色组筛选：gold = 任意 Gold Standard stem
    if role_group:
        rg = role_group.strip().lower()
        if rg == "gold":
            gold_suffixes = ["[Gold Vocals]", "[Gold Drums]", "[Gold Bass]", "[Gold Other]"]
            conditions.append(or_(*[AudioResource.title.like(f"% {s}") for s in gold_suffixes]))
        else:
            raise HTTPException(status_code=400, detail="无效的 role_group 参数")
    
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


@router.get("/resources/bundle/gold-stems", response_model=dict)
async def get_gold_stems_by_bundle(
    bundle_title: str = Query(..., description="成组音频的基础标题（例如 SongName）"),
    db: AsyncSession = Depends(get_db),
):
    """
    根据mixture的bundle_title获取所有对应的gold标准音源

    返回格式：
    {
        "vocals": AudioResourceResponse | null,
        "drums": AudioResourceResponse | null,
        "bass": AudioResourceResponse | null,
        "other": AudioResourceResponse | null
    }
    """
    bt = bundle_title.strip()
    if not bt:
        raise HTTPException(status_code=400, detail="bundle_title不能为空")

    # 构建4个gold stem的标题
    gold_titles = {
        "vocals": f"{bt} [Gold Vocals]",
        "drums": f"{bt} [Gold Drums]",
        "bass": f"{bt} [Gold Bass]",
        "other": f"{bt} [Gold Other]",
    }

    # 查询所有gold stems
    result = {}
    for stem_key, title in gold_titles.items():
        query = select(AudioResource).where(
            AudioResource.title == title,
            AudioResource.is_public == True
        )
        db_result = await db.execute(query)
        resource = db_result.scalars().first()
        result[stem_key] = AudioResourceResponse.from_orm(resource) if resource else None

    return result


async def _save_audio_resource(
    *,
    req: Request,
    db: AsyncSession,
    current_user: User,
    file: UploadFile,
    title: str,
    description: Optional[str],
    category: Optional[str],
    is_public: bool,
):
    """内部工具函数：保存单个音频资源，并写入系统日志。"""
    from app.utils.config_helper import get_config_value

    max_file_size_mb = await get_config_value(
        db, "max_audio_file_size_mb", 100, "MAX_AUDIO_FILE_SIZE_MB", int
    )
    MAX_FILE_SIZE = max_file_size_mb * 1024 * 1024

    allowed_extensions = {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac"}
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件格式。支持的格式: {', '.join(allowed_extensions)}",
        )

    if len(title.strip()) == 0:
        raise HTTPException(status_code=400, detail="标题不能为空")
    if len(title) > 255:
        raise HTTPException(status_code=400, detail="标题长度不能超过255个字符")

    file_id = str(uuid.uuid4())
    safe_filename = re.sub(r"[^A-Za-z0-9._-]", "_", file.filename)
    file_path = AUDIO_RESOURCE_DIR / f"{file_id}_{safe_filename}"

    file_size = 0
    try:
        with open(file_path, "wb") as f:
            while True:
                chunk = await file.read(8192)
                if not chunk:
                    break
                file_size += len(chunk)
                if file_size > MAX_FILE_SIZE:
                    if file_path.exists():
                        file_path.unlink()
                    raise HTTPException(
                        status_code=400,
                        detail=f"文件大小超过限制（最大 {MAX_FILE_SIZE // (1024*1024)}MB）",
                    )
                f.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        if file_path.exists():
            file_path.unlink()
        raise HTTPException(status_code=500, detail=f"文件保存失败: {str(e)}")

    duration = None
    try:
        analysis = analyze_audio_file(file_path)
        duration = analysis.duration_s
    except Exception as e:
        import logging

        logging.warning(f"音频文件分析失败 (文件: {file_path}): {str(e)}")

    relative_path = (
        file_path.relative_to(AUDIO_RESOURCE_DIR)
        if file_path.is_relative_to(AUDIO_RESOURCE_DIR)
        else file_path.name
    )
    static_path = f"/audio_resources/{relative_path}"

    created_by = "官方" if current_user.role == Role.ADMIN else current_user.username

    # 所有通过本接口上传的音频资源一律设为公开
    audio_resource = AudioResource(
        title=title,
        description=description,
        file_path=static_path,
        file_size=file_size,
        duration=duration,
        file_format=file_ext[1:] if file_ext else None,
        category=category,
        uploader_id=current_user.id,
        created_by=created_by,
        is_public=True,
    )

    db.add(audio_resource)
    try:
        await db.commit()
        await db.refresh(audio_resource)
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
        return audio_resource
    except Exception as e:
        await db.rollback()
        if file_path.exists():
            file_path.unlink()
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


@router.post("/resources/upload", response_model=AudioResourceResponse)
async def upload_audio_resource(
    req: Request,
    file: UploadFile = File(...),
    title: str = Body(...),
    description: Optional[str] = Body(None),
    category: Optional[str] = Body(None),
    is_public: bool = Body(True),
    current_user: Optional[User] = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """上传单个音频资源（所有登录用户都可以上传）。"""
    if not current_user:
        raise HTTPException(status_code=401, detail="请先登录")

    # 标题唯一性校验（忽略大小写）
    normalized_title = (title or "").strip()
    if not normalized_title:
        raise HTTPException(status_code=400, detail="标题不能为空")
    existing = await db.execute(
        select(AudioResource.id)
        .where(func.lower(AudioResource.title) == normalized_title.lower())
        .limit(1)
    )
    if existing.scalar() is not None:
        raise HTTPException(status_code=409, detail="标题已存在，请换一个唯一标题")

    resource = await _save_audio_resource(
        req=req,
        db=db,
        current_user=current_user,
        file=file,
        title=normalized_title,
        description=description,
        category=category,
        # 统一强制公开，忽略传入的 is_public
        is_public=True,
    )
    return AudioResourceResponse.from_orm(resource)


@router.post("/resources/upload-bundle", response_model=dict)
async def upload_audio_resource_bundle(
    req: Request,
    mixture: UploadFile = File(..., description="Mixture（混合音）"),
    vocals: UploadFile = File(..., description="Gold Standard Vocals"),
    drums: UploadFile = File(..., description="Gold Standard Drums"),
    bass: UploadFile = File(..., description="Gold Standard Bass"),
    other: UploadFile = File(..., description="Gold Standard Other"),
    title: str = Body(..., description="这组音频的基础标题"),
    description: Optional[str] = Body(None),
    category: Optional[str] = Body(None),
    is_public: bool = Body(True),
    current_user: Optional[User] = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """
    一次性上传 Mixture + 4 个 Gold Standard Stem。

    这样可以保证同一组音频在资源库中成对出现，方便进行算法对比。
    """
    if not current_user:
        raise HTTPException(status_code=401, detail="请先登录")

    base_title = (title or "").strip()
    if not base_title:
        raise HTTPException(status_code=400, detail="标题不能为空")

    # 预先构造 5 个标题，并做“整体唯一性”校验，避免上传到一半才因标题冲突失败
    mixture_title = f"{base_title} [Mixture]"
    vocals_title = f"{base_title} [Gold Vocals]"
    drums_title = f"{base_title} [Gold Drums]"
    bass_title = f"{base_title} [Gold Bass]"
    other_title = f"{base_title} [Gold Other]"
    all_titles = [mixture_title, vocals_title, drums_title, bass_title, other_title]

    too_long = [t for t in all_titles if len(t) > 255]
    if too_long:
        raise HTTPException(status_code=400, detail="标题过长（含后缀后不能超过255个字符），请缩短标题")

    normalized_titles = [t.lower() for t in all_titles]
    conflict = await db.execute(
        select(AudioResource.title)
        .where(func.lower(AudioResource.title).in_(normalized_titles))
        .limit(5)
    )
    conflict_titles = [row[0] for row in conflict.all() if row and row[0]]
    if conflict_titles:
        # 返回一个对用户友好的提示（列出已存在标题，便于快速改名）
        shown = "；".join(conflict_titles[:3])
        more = "…" if len(conflict_titles) > 3 else ""
        raise HTTPException(status_code=409, detail=f"标题已存在，请换一个唯一标题（冲突：{shown}{more}）")

    resources = []

    # Mixture
    mixture_res = await _save_audio_resource(
        req=req,
        db=db,
        current_user=current_user,
        file=mixture,
        title=mixture_title,
        description=description,
        category=category,
        is_public=True,
    )
    # 目前 AudioResource 模型中没有 bundle_id 字段；这里使用 Mixture 的资源 ID 作为该组的稳定标识返回，
    # 前端/管理端如需“成组操作”，可以依赖这个 bundle_id（无需改表即可避免 NameError）。
    bundle_id = str(mixture_res.id)
    resources.append(
        {
            "role": "mixture",
            "resource": AudioResourceResponse.from_orm(mixture_res),
        }
    )

    # Vocals
    vocals_res = await _save_audio_resource(
        req=req,
        db=db,
        current_user=current_user,
        file=vocals,
        title=vocals_title,
        description=description,
        category=category,
        is_public=True,
    )
    resources.append(
        {
            "role": "gold_vocals",
            "resource": AudioResourceResponse.from_orm(vocals_res),
        }
    )

    # Drums
    drums_res = await _save_audio_resource(
        req=req,
        db=db,
        current_user=current_user,
        file=drums,
        title=drums_title,
        description=description,
        category=category,
        is_public=True,
    )
    resources.append(
        {
            "role": "gold_drums",
            "resource": AudioResourceResponse.from_orm(drums_res),
        }
    )

    # Bass
    bass_res = await _save_audio_resource(
        req=req,
        db=db,
        current_user=current_user,
        file=bass,
        title=bass_title,
        description=description,
        category=category,
        is_public=True,
    )
    resources.append(
        {
            "role": "gold_bass",
            "resource": AudioResourceResponse.from_orm(bass_res),
        }
    )

    # Other
    other_res = await _save_audio_resource(
        req=req,
        db=db,
        current_user=current_user,
        file=other,
        title=other_title,
        description=description,
        category=category,
        is_public=True,
    )
    resources.append(
        {
            "role": "gold_other",
            "resource": AudioResourceResponse.from_orm(other_res),
        }
    )

    return {
        "bundle_id": bundle_id,
        "items": resources,
    }


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
        
        # 获取音频资源目录（与上传逻辑保持一致）
        audio_resource_dir = AUDIO_RESOURCE_DIR
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
