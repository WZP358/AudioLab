from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, BackgroundTasks, Request, Header
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
import os
import uuid
import logging
from pathlib import Path

from app.database import get_db
from app.models import SeparationTask, StemFile, TaskStatus, Algorithm, User
from app.schemas import TaskResponse, StemResponse, TaskAnalysisResponse
from app.services.separation_service import process_separation
from app.services.analysis_service import analyze_audio_file, analysis_to_payload
from app.utils.log_helper import get_client_ip, get_user_agent
import logging

logger = logging.getLogger(__name__)


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

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

# 确保上传目录存在
UPLOAD_DIR = Path("/app/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
RESULTS_DIR = Path("/app/results")
RESULTS_DIR.mkdir(parents=True, exist_ok=True)


@router.post("/upload", response_model=TaskResponse)
async def upload_audio(
    req: Request,
    file: UploadFile = File(...),
    algorithm: Algorithm = Algorithm.DEMUCS_V4,
    current_user: Optional[User] = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
    background_tasks: BackgroundTasks = BackgroundTasks(),
):
    """上传音频文件并创建分离任务"""
    # 获取用户ID（如果已登录则使用用户ID，否则使用"anonymous"）
    user_id = str(current_user.id) if current_user else "anonymous"
    
    # 保存上传的文件
    file_ext = Path(file.filename).suffix
    file_id = str(uuid.uuid4())
    file_path = UPLOAD_DIR / f"{file_id}{file_ext}"
    
    with open(file_path, "wb") as f:
        content = await file.read()
        f.write(content)
    
    # 创建任务记录
    try:
        task = SeparationTask(
            user_id=user_id,
            original_filename=file.filename,
            file_path=str(file_path),
            algorithm=algorithm,
            status=TaskStatus.PENDING,
        )
        db.add(task)
        await db.commit()
        await db.refresh(task)
        
        # 记录任务创建信息（用于调试）
        logger.info(
            f"任务已创建: task_id={task.id} (类型: {type(task.id).__name__}), "
            f"user_id={user_id}, filename={file.filename}, "
            f"algorithm={algorithm}, status={task.status}"
        )
        
        # 验证任务是否真的存在于数据库中
        verify_task = await db.get(SeparationTask, task.id)
        if not verify_task:
            error_msg = (
                f"任务创建后验证失败！\n"
                f"创建的任务ID: {task.id} (类型: {type(task.id).__name__})\n"
                f"数据库中未找到该任务\n"
                f"可能原因: 数据库事务未提交或回滚"
            )
            logger.error(error_msg)
            raise HTTPException(status_code=500, detail=error_msg)
        
        logger.info(
            f"任务验证成功: task_id={task.id}, status={task.status}, "
            f"created_at={task.created_at}"
        )
        
        # 后台处理分离任务
        background_tasks.add_task(process_separation, task.id, str(file_path), algorithm)
        
        # 确保返回的task对象使用TaskResponse序列化，将ID转为字符串
        # 直接返回task对象，FastAPI会自动使用response_model进行序列化
        logger.info(
            f"返回任务响应: task_id={task.id} (类型: {type(task.id).__name__}), "
            f"将序列化为字符串: {str(task.id)}"
        )
        return task
    except Exception as e:
        logger.error(f"创建任务时发生错误: {str(e)}", exc_info=True)
        await db.rollback()
        # 清理已上传的文件
        if file_path.exists():
            try:
                file_path.unlink()
            except:
                pass
        raise HTTPException(status_code=500, detail=f"任务创建失败: {str(e)}")


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(task_id: str, db: AsyncSession = Depends(get_db)):
    """获取任务状态"""
    # 确保 task_id 是有效的整数（支持大整数）
    try:
        task_id_int = int(task_id)
    except (ValueError, TypeError):
        logger.warning(f"无效的任务ID格式: {task_id}")
        raise HTTPException(status_code=400, detail="无效的任务ID")
    
    logger.info(f"查询任务: task_id={task_id} (转换为 int: {task_id_int})")
    
    task = await db.get(SeparationTask, task_id_int)
    if not task:
        # 添加详细的调试信息
        from sqlalchemy import select, func
        count_result = await db.execute(select(func.count(SeparationTask.id)))
        total_count = count_result.scalar()
        
        # 查询最近10个任务ID用于调试
        recent_tasks_result = await db.execute(
            select(SeparationTask.id, SeparationTask.status, SeparationTask.created_at)
            .order_by(SeparationTask.id.desc())
            .limit(10)
        )
        recent_tasks = recent_tasks_result.all()
        recent_info = [
            f"ID={str(tid)} status={status} created={created_at}"
            for tid, status, created_at in recent_tasks
        ]
        
        # 检查是否有相似的任务ID（可能是精度丢失）
        similar_tasks_result = await db.execute(
            select(SeparationTask.id, SeparationTask.status, SeparationTask.created_at)
            .where(
                (SeparationTask.id >= task_id_int - 100) &
                (SeparationTask.id <= task_id_int + 100)
            )
            .order_by(SeparationTask.id.desc())
        )
        similar_tasks = similar_tasks_result.all()
        similar_info = [
            f"ID={str(tid)} (差异={tid - task_id_int}) status={status}"
            for tid, status, created_at in similar_tasks
        ]
        
        error_detail = (
            f"任务未找到: task_id={task_id} (int: {task_id_int})\n"
            f"数据库总任务数: {total_count}\n"
            f"最近10个任务: {', '.join(recent_info[:5])}\n"
            f"相似ID任务: {', '.join(similar_info) if similar_info else '无'}\n"
            f"可能原因: 1) 任务ID精度丢失 2) 任务尚未创建 3) 任务已被删除"
        )
        
        logger.warning(error_detail)
        raise HTTPException(
            status_code=404,
            detail=error_detail
        )
    
    logger.info(f"任务查询成功: task_id={task.id}, status={task.status}")
    return task


@router.get("/{task_id}/stems", response_model=list[StemResponse])
async def get_stems(task_id: str, db: AsyncSession = Depends(get_db)):
    """获取分离后的音频文件列表"""
    # 确保 task_id 是有效的整数（支持大整数）
    try:
        task_id_int = int(task_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="无效的任务ID")
    
    task = await db.get(SeparationTask, task_id_int)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    from sqlalchemy import select
    result = await db.execute(
        select(StemFile).where(StemFile.task_id == task_id_int)
    )
    stems = result.scalars().all()
    return stems


@router.get("/{task_id}/stems/{stem_id}/download")
async def download_stem(
    req: Request,
    task_id: str,
    stem_id: str,
    current_user: Optional[User] = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """下载分离后的音频文件（支持 Range 请求，用于音频播放）"""
    # 确保 task_id 和 stem_id 是有效的整数（支持大整数）
    try:
        task_id_int = int(task_id)
        stem_id_int = int(stem_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="无效的任务ID或Stem ID")
    
    stem = await db.get(StemFile, stem_id_int)
    if not stem or stem.task_id != task_id_int:
        raise HTTPException(status_code=404, detail="Stem not found")
    
    file_path = Path(stem.file_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if file_path.stat().st_size == 0:
        # 0 字节文件在浏览器音频播放时会导致 Range 请求直接 416
        raise HTTPException(status_code=409, detail="Stem file is empty (mock output). Please re-run task.")
    
    from fastapi.responses import FileResponse
    # FileResponse 会自动处理 Range 请求（用于音频 seek/流式播放）
    # 传入 Path 对象确保文件大小等信息能正确获取
    return FileResponse(
        path=file_path,
        media_type="audio/wav",
        filename=f"{stem.stem_name}.wav",
        headers={
            "Accept-Ranges": "bytes",  # 明确告知支持 Range 请求
        }
    )


@router.get("/{task_id}/analysis", response_model=TaskAnalysisResponse)
async def get_task_analysis(
    task_id: str,
    target: str = "Vocals",
    include_all_stems: bool = False,
    db: AsyncSession = Depends(get_db),
):
    """
    返回用于前端"可视化分析"的轻量结果（波形 + 频谱）。

    设计目标：
    - 前后端分离：分析在后端完成，前端只渲染
    - 体积可控：固定尺寸 waveform/spectrogram
    """
    # 确保 task_id 是有效的整数（支持大整数）
    try:
        task_id_int = int(task_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="无效的任务ID")
    
    task = await db.get(SeparationTask, task_id_int)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # 拉取 stems
    from sqlalchemy import select

    result = await db.execute(select(StemFile).where(StemFile.task_id == task_id_int))
    stems = list(result.scalars().all())

    def safe_analyze(path_str: str):
        p = Path(path_str)
        if not p.exists() or p.stat().st_size == 0:
            return None
        try:
            return analysis_to_payload(analyze_audio_file(p))
        except Exception:
            # 例如 mp3 解码失败、音频损坏等：直接降级为空
            return None

    original = safe_analyze(task.file_path)

    # 选择 target stem（默认 Vocals，不存在则取第一个）
    target_stem = None
    target_payload = None
    stems_payload = {}
    for s in stems:
        if include_all_stems:
            stems_payload[s.stem_name] = safe_analyze(s.file_path)

        if target_payload is None and s.stem_name.lower() == target.lower():
            target_stem = s.stem_name
            target_payload = safe_analyze(s.file_path)

    if target_payload is None and stems:
        s0 = stems[0]
        target_stem = s0.stem_name
        target_payload = safe_analyze(s0.file_path)

    return TaskAnalysisResponse(
        task_id=task_id_int,
        target_stem=target_stem,
        original=original,
        target=target_payload,
        stems=stems_payload if include_all_stems else None,
    )
