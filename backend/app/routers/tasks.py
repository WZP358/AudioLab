from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, BackgroundTasks, Request, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, update
from typing import List, Optional
import os
import uuid
import logging
from pathlib import Path
from datetime import datetime, timedelta, timezone

import numpy as np
from pydantic import BaseModel

from app.database import get_db
from app.models import SeparationTask, StemFile, TaskStatus, Algorithm, User, Role, Score
from app.routers.auth import get_current_user
from app.services.separation_engine import mark_task_cancelled
from app.schemas import (
    TaskResponse,
    StemResponse,
    TaskAnalysisResponse,
    ObjectiveMetricsResponse,
    ObjectiveAlgorithmStats,
    ObjectiveAlgorithmDistribution,
    AudioAnalysisPayload,
    PaginatedTaskListResponse,
)
from app.services.separation_service import process_separation
from app.services.queue_manager import TaskQueueManager
from app.services.analysis_service import analyze_audio_file, analysis_to_payload, _read_audio_any
from app.services.objective_metrics import compute_bss_metrics_two_source, compute_residual_mix_minus_est
from app.utils.log_helper import get_client_ip, get_user_agent
import logging
import tempfile
import soundfile as sf

logger = logging.getLogger(__name__)


class MixRequest(BaseModel):
    """
    多 stem 混合请求：
    - stem_names: 参与运算的 stem 名称（与 StemFile.stem_name 大小写不敏感匹配）
    - mode: "keep" 表示只保留这些 stem 混合；"remove" 表示从整体中消除这些 stem（等价于保留其它 stem）
    """
    stem_names: List[str]
    mode: str = "remove"  # "keep" | "remove"


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

# 本地开发：将上传和结果目录放在 backend/uploads、backend/results（可用环境变量覆盖）
base_dir = Path(__file__).resolve().parents[1]  # backend
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "uploads"))
if not UPLOAD_DIR.is_absolute():
    UPLOAD_DIR = base_dir / UPLOAD_DIR
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

RESULTS_DIR = Path(os.getenv("RESULTS_DIR", "results"))
if not RESULTS_DIR.is_absolute():
    RESULTS_DIR = base_dir / RESULTS_DIR
RESULTS_DIR.mkdir(parents=True, exist_ok=True)


@router.post("/{task_id}/mix")
async def mix_stems_for_task(
    task_id: str,
    body: MixRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    根据用户选择的 stems 生成混合音频（可作为“自定义残差”或“自定义伴奏”使用）：
    - mode == "keep": 只用这些 stem 相加做混音
    - mode == "remove": 从所有 stem 中排除这些，再把剩余 stem 相加（等价于“消除这些声源”）
    """
    try:
        task_id_int = int(task_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="无效的任务ID")

    task = await db.get(SeparationTask, task_id_int)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    if not body.stem_names:
        raise HTTPException(status_code=400, detail="stem_names 不能为空")

    # 拉取该任务下所有 stems
    result = await db.execute(
        select(StemFile).where(StemFile.task_id == task_id_int)
    )
    all_stems = list(result.scalars().all())
    if not all_stems:
        raise HTTPException(status_code=404, detail="该任务尚未生成任何 stem")

    # 根据名称匹配（大小写不敏感）
    target_names = {name.strip().lower() for name in body.stem_names if name.strip()}
    if not target_names:
        raise HTTPException(status_code=400, detail="stem_names 解析为空")

    if body.mode not in ("keep", "remove"):
        raise HTTPException(status_code=400, detail="mode 必须为 'keep' 或 'remove'")

    if body.mode == "keep":
        mix_stems = [
            s for s in all_stems if s.stem_name and s.stem_name.lower() in target_names
        ]
    else:  # remove: 保留其余的
        mix_stems = [
            s for s in all_stems if s.stem_name and s.stem_name.lower() not in target_names
        ]

    if not mix_stems:
        raise HTTPException(status_code=400, detail="根据当前选择没有任何 stem 参与混合")

    # 读取所有参与混合的 stem 音频
    arrays = []
    sample_rate = None
    num_channels = None
    for s in mix_stems:
        p = Path(s.file_path)
        if not p.exists() or p.stat().st_size == 0:
            raise HTTPException(status_code=404, detail=f"Stem 文件不存在或为空: {s.stem_name}")
        y, sr, _ = _read_audio_any(p)  # y: float32, shape [T, C]
        if y.size == 0:
            continue
        if sample_rate is None:
            sample_rate = sr
        elif sample_rate != sr:
            raise HTTPException(status_code=500, detail="参与混合的 stems 采样率不一致，无法直接混合")
        if num_channels is None:
            num_channels = y.shape[1]
        elif num_channels != y.shape[1]:
            raise HTTPException(status_code=500, detail="参与混合的 stems 声道数不一致，无法直接混合")
        arrays.append(y)

    if not arrays or sample_rate is None or num_channels is None:
        raise HTTPException(status_code=500, detail="无法读取有效的 stem 音频数据")

    # 对齐长度并相加
    max_len = max(a.shape[0] for a in arrays)
    mix = np.zeros((max_len, num_channels), dtype=np.float32)
    for a in arrays:
        cur_len = a.shape[0]
        if cur_len < max_len:
            pad = np.zeros((max_len - cur_len, num_channels), dtype=np.float32)
            a_pad = np.concatenate([a, pad], axis=0)
        else:
            a_pad = a[:max_len, :]
        mix += a_pad

    # 简单防止削波：归一化到 [-1, 1]
    peak = float(np.max(np.abs(mix)))
    if peak > 1.0e-6:
        mix = np.clip(mix / max(1.0, peak), -1.0, 1.0)

    # 输出到 /app/results/{task_id}/custom_mix_*.wav
    out_dir = RESULTS_DIR / str(task_id_int)
    out_dir.mkdir(parents=True, exist_ok=True)

    safe_mode = body.mode
    safe_tag = "_".join(sorted(target_names))[:80] or "mix"
    safe_tag = "".join(ch for ch in safe_tag if ch.isalnum() or ch in "._-")
    out_path = out_dir / f"custom_mix_{safe_mode}_{safe_tag}.wav"

    try:
        sf.write(out_path, mix, sample_rate, subtype="PCM_16")
    except Exception as e:
        logger.error(
            "写入混合音频失败: task_id=%s mode=%s stems=%s err=%s",
            task_id_int,
            body.mode,
            body.stem_names,
            e,
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail=f"写入混合音频失败: {type(e).__name__}: {str(e)}")

    if not out_path.exists() or out_path.stat().st_size == 0:
        raise HTTPException(status_code=500, detail="混合音频生成失败（文件为空或不存在）")

    from fastapi.responses import FileResponse

    return FileResponse(
        path=str(out_path),
        media_type="audio/wav",
        filename=out_path.name,
        headers={"Accept-Ranges": "bytes"},
    )


@router.post("/upload", response_model=TaskResponse)
async def upload_audio(
    req: Request,
    file: UploadFile = File(...),
    algorithm: Algorithm = Algorithm.DEMUCS_V4,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    background_tasks: BackgroundTasks = BackgroundTasks(),
):
    """上传音频文件并创建分离任务"""
    # 当前版本前端强制登录后使用，因此任务必须绑定到登录用户
    user_id = str(current_user.id)
    
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
        
        # 将任务加入队列，而不是直接处理
        queue_manager = await TaskQueueManager.get_instance()
        await queue_manager.add_task(task.id, str(file_path), algorithm)
        
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


@router.post("/history/claim-anonymous")
async def claim_anonymous_task_history(
    days: int = 30,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    将历史上以 user_id='anonymous' 创建的任务“找回”到当前账号名下（仅限本地/单用户场景）。

    - 这是一个显式操作，避免自动归属带来的潜在数据串号风险；
    - 默认只处理最近 `days` 天的匿名任务。
    """
    days = max(1, min(3650, int(days or 30)))
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    stmt = (
        update(SeparationTask)
        .where(
            and_(
                SeparationTask.user_id == "anonymous",
                SeparationTask.created_at >= cutoff,
            )
        )
        .values(user_id=str(current_user.id))
    )
    result = await db.execute(stmt)
    await db.commit()

    updated = int(getattr(result, "rowcount", 0) or 0)
    return {"updated": updated, "days": days}


@router.get("/queue/{task_id}/position")
async def get_queue_position(task_id: str):
    """
    获取任务在队列中的位置信息
    
    返回:
    - position: 位置（从1开始，0表示正在处理）
    - queue_length: 队列总长度（包括正在处理的任务）
    - is_processing: 是否正在处理
    - 如果任务不在队列中，返回 None
    """
    try:
        task_id_int = int(task_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="无效的任务ID")
    
    queue_manager = await TaskQueueManager.get_instance()
    position_info = await queue_manager.get_queue_position(task_id_int)
    
    if position_info is None:
        raise HTTPException(status_code=404, detail="任务不在队列中（可能已完成或失败）")
    
    return position_info


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
        raise HTTPException(status_code=404, detail="任务不存在或已被删除")
    
    logger.info(f"任务查询成功: task_id={task.id}, status={task.status}")
    return task


@router.get("/history/me", response_model=PaginatedTaskListResponse)
async def get_my_task_history(
    page: int = 1,
    page_size: int = 20,
    search: Optional[str] = None,
    status: Optional[TaskStatus] = None,
    algorithm: Optional[Algorithm] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    当前登录用户的分离任务历史记录（分页）。
    
    - 用于“分离历史”页面展示“我的历史记录”；
    - 仅返回当前用户自己的任务，避免泄露其他用户信息。
    """

    page = max(1, int(page or 1))
    page_size = max(1, min(100, int(page_size or 20)))

    user_id_str = str(current_user.id)

    # 所有已经登录的用户都可以查看自己的历史任务
    conditions = [SeparationTask.user_id == user_id_str]
    if status is not None:
        conditions.append(SeparationTask.status == status)
    if algorithm is not None:
        conditions.append(SeparationTask.algorithm == algorithm)
    if search:
        s = search.strip()
        if s:
            # 尝试按 ID 精确匹配，否则按文件名模糊搜索
            try:
                sid = int(s)
                conditions.append(SeparationTask.id == sid)
            except ValueError:
                like_kw = f"%{s}%"
                conditions.append(SeparationTask.original_filename.like(like_kw))

    q = select(SeparationTask).where(and_(*conditions))

    count_q = select(func.count(SeparationTask.id)).where(and_(*conditions))
    total_result = await db.execute(count_q)
    total = int(total_result.scalar() or 0)

    offset = (page - 1) * page_size
    q = q.order_by(SeparationTask.created_at.desc()).offset(offset).limit(page_size)

    result = await db.execute(q)
    tasks = result.scalars().all()

    return PaginatedTaskListResponse(
        items=[TaskResponse.model_validate(t) for t in tasks],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size if total > 0 else 0,
    )


@router.get("/history/admin", response_model=PaginatedTaskListResponse)
async def get_all_task_history(
    page: int = 1,
    page_size: int = 20,
    search: Optional[str] = None,
    status: Optional[TaskStatus] = None,
    algorithm: Optional[Algorithm] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    管理员查看所有分离任务历史记录（分页）。

    - 管理员可在后台查看并管理所有用户的历史分离任务；
    - 前端可通过筛选/分页避免一次性加载过多数据。
    """
    if current_user.role != Role.ADMIN:
        raise HTTPException(status_code=403, detail="仅管理员可查看所有历史记录")

    page = max(1, int(page or 1))
    page_size = max(1, min(100, int(page_size or 20)))

    conditions = []
    if status is not None:
        conditions.append(SeparationTask.status == status)
    if algorithm is not None:
        conditions.append(SeparationTask.algorithm == algorithm)
    if search:
        s = search.strip()
        if s:
            try:
                sid = int(s)
                conditions.append(SeparationTask.id == sid)
            except ValueError:
                like_kw = f"%{s}%"
                conditions.append(SeparationTask.original_filename.like(like_kw))

    q = select(SeparationTask)
    if conditions:
        q = q.where(and_(*conditions))

    count_q = select(func.count(SeparationTask.id))
    if conditions:
        count_q = count_q.where(and_(*conditions))

    total_result = await db.execute(count_q)
    total = int(total_result.scalar() or 0)

    offset = (page - 1) * page_size
    q = q.order_by(SeparationTask.created_at.desc()).offset(offset).limit(page_size)

    result = await db.execute(q)
    tasks = result.scalars().all()

    return PaginatedTaskListResponse(
        items=[TaskResponse.model_validate(t) for t in tasks],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size if total > 0 else 0,
    )


@router.delete("/history/{task_id}")
async def delete_task_history(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    删除单条分离任务历史记录，同时清理对应本地文件：
    - 上传的混合音频文件（SeparationTask.file_path）
    - 所有 stem 文件（StemFile.file_path）
    - 任务结果目录（backend/results/{task_id} 以及 /app/results/{task_id}）

    权限规则：
    - 专家：仅可删除自己的任务；
    - 管理员：可删除任意任务。
    """
    try:
        task_id_int = int(task_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="无效的任务ID")

    task = await db.get(SeparationTask, task_id_int)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在或已被删除")

    # 权限校验
    if current_user.role != Role.ADMIN:
        if str(task.user_id) != str(current_user.id):
            raise HTTPException(status_code=403, detail="仅可删除自己的历史记录")

    # 收集需要删除的文件路径
    file_paths: list[Path] = []

    # 上传的原始文件
    if task.file_path:
        file_paths.append(Path(task.file_path))

    # 所有 stem 文件
    stems_result = await db.execute(
        select(StemFile).where(StemFile.task_id == task_id_int)
    )
    stems = stems_result.scalars().all()
    for s in stems:
        if s.file_path:
            file_paths.append(Path(s.file_path))

    # 结果目录（本地 backend/results/{task_id} 和容器内 /app/results/{task_id}）
    local_results_dir = RESULTS_DIR / str(task_id_int)
    docker_results_dir = Path("/app/results") / str(task_id_int)

    # 先删除数据库记录（Scores -> Stems -> Task），再尝试删除文件
    try:
        # 删除评分记录，避免悬挂引用
        scores_result = await db.execute(
            select(Score).where(Score.task_id == task_id_int)
        )
        scores = scores_result.scalars().all()
        for sc in scores:
            await db.delete(sc)

        # 删除 stems
        for s in stems:
            await db.delete(s)

        # 删除任务本身
        await db.delete(task)

        await db.commit()
    except Exception as e:
        await db.rollback()
        logger.error("删除任务历史记录失败（数据库层）：task_id=%s err=%s", task_id_int, e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"删除任务历史记录失败：{type(e).__name__}: {str(e)}")

    # 文件删除放在事务提交之后执行，避免文件已删但数据库仍存在的极端情况
    def _safe_remove(p: Path):
        try:
            if p.is_file():
                p.unlink(missing_ok=True)  # type: ignore[call-arg]
            elif p.is_dir():
                # 递归删除目录内容
                for child in p.rglob("*"):
                    if child.is_file():
                        child.unlink(missing_ok=True)  # type: ignore[call-arg]
                p.rmdir()
        except Exception as e:
            # 记录但不抛出，让整体删除流程尽可能完成
            logger.warning("删除文件/目录失败: path=%s err=%s", p, e)

    # 删除单个文件
    for fp in file_paths:
        _safe_remove(fp)

    # 删除结果目录
    _safe_remove(local_results_dir)
    _safe_remove(docker_results_dir)

    return {
        "message": "历史记录及对应文件已删除",
        "task_id": str(task_id_int),
    }


@router.post("/{task_id}/cancel", response_model=TaskResponse)
async def cancel_task(task_id: str, db: AsyncSession = Depends(get_db)):
    """
    取消一个正在排队或处理中的分离任务。

    说明：
    - 该接口为“软取消”：如果后端分离引擎已经在运行，可能无法立刻中断计算；
      但会将任务状态标记为 FAILED，并在 comment 中写入“任务已被用户取消”，
      前端可以据此识别为“用户主动取消”，而不是普通失败。
    """
    try:
        task_id_int = int(task_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="无效的任务ID")

    task = await db.get(SeparationTask, task_id_int)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    # 已经结束/失败的任务不允许重复取消，直接返回当前状态
    if task.status in (TaskStatus.COMPLETED, TaskStatus.FAILED):
        return task

    # 使用 FAILED 状态 + 特殊 comment 表示"用户主动取消"
    task.status = TaskStatus.FAILED
    task.comment = "任务已被用户取消"

    # 从队列中移除任务
    try:
        queue_manager = await TaskQueueManager.get_instance()
        await queue_manager.remove_task(task_id_int)
    except Exception:
        logger.warning("从队列移除任务失败（不影响状态持久化）: task_id=%s", task_id_int)

    # 标记任务需要硬中断，分离引擎会轮询并终止对应的子进程
    try:
        mark_task_cancelled(task_id_int)
    except Exception:
        logger.warning("标记任务取消失败（不影响状态持久化）: task_id=%s", task_id_int)

    await db.commit()
    await db.refresh(task)

    logger.info(f"任务已取消: task_id={task.id}, status={task.status}")
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
        raise HTTPException(status_code=404, detail="任务不存在")
    
    result = await db.execute(
        select(StemFile).where(StemFile.task_id == task_id_int)
    )
    stems = result.scalars().all()
    return stems


@router.get("/stats/objective", response_model=List[ObjectiveAlgorithmStats])
async def get_objective_stats(db: AsyncSession = Depends(get_db)):
    """
    按算法聚合任务级客观指标（SDR/SIR/SAR）。

    用途：
    - 为前端的“客观指标雷达图”“算法排行榜”等提供数据支撑；
    - 只统计 sdr 非空的任务（即分离引擎或外部服务确实返回了客观指标）。
    """
    result = await db.execute(
        select(
            SeparationTask.algorithm.label("algorithm"),
            func.count(SeparationTask.id).label("count_tasks"),
            func.avg(SeparationTask.sdr).label("avg_sdr"),
            func.avg(SeparationTask.sir).label("avg_sir"),
            func.avg(SeparationTask.sar).label("avg_sar"),
        )
        .where(SeparationTask.sdr.isnot(None))
        .group_by(SeparationTask.algorithm)
    )

    rows = result.all()
    stats: List[ObjectiveAlgorithmStats] = []
    for row in rows:
        stats.append(
            ObjectiveAlgorithmStats(
                algorithm=row.algorithm,
                count_tasks=int(row.count_tasks or 0),
                avg_sdr=float(row.avg_sdr) if row.avg_sdr is not None else None,
                avg_sir=float(row.avg_sir) if row.avg_sir is not None else None,
                avg_sar=float(row.avg_sar) if row.avg_sar is not None else None,
            )
        )

    return stats


@router.get("/stats/objective-distribution", response_model=List[ObjectiveAlgorithmDistribution])
async def get_objective_distribution(db: AsyncSession = Depends(get_db)):
    """
    返回每个算法对应的 SDR 样本分布（仅包含 sdr 非空的任务）。

    前端可以基于该分布绘制箱线图/蜂群散点等“分布型”可视化，
    以展示同一算法在多首歌曲上的性能波动情况。
    """
    result = await db.execute(
        select(
            SeparationTask.algorithm,
            SeparationTask.sdr,
        ).where(SeparationTask.sdr.isnot(None))
    )

    rows = result.all()
    buckets: dict[Algorithm, list[float]] = {}
    for algo, sdr in rows:
        if sdr is None:
            continue
        if algo not in buckets:
            buckets[algo] = []
        # 统一转 float，避免 Decimal 等类型在序列化时出问题
        try:
            buckets[algo].append(float(sdr))
        except (TypeError, ValueError):
            continue

    out: List[ObjectiveAlgorithmDistribution] = []
    for algo, values in buckets.items():
        # 可选：按大小截断极端 outlier，当前先直接返回
        out.append(
            ObjectiveAlgorithmDistribution(
                algorithm=algo,
                sdr_values=values,
            )
        )

    return out


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
        raise HTTPException(status_code=404, detail="未找到对应的声部文件")
    
    file_path = Path(stem.file_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    if file_path.stat().st_size == 0:
        # 0 字节文件在浏览器音频播放时会导致 Range 请求直接 416
        raise HTTPException(status_code=409, detail="声部文件为空（可能为模拟输出），请重新运行任务。")
    
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


@router.get("/{task_id}/mixture/download")
async def download_mixture_audio(
    task_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    下载原始混合音频文件（用于历史任务导入时还原 Input Source）。
    """
    try:
        task_id_int = int(task_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="无效的任务ID")

    task = await db.get(SeparationTask, task_id_int)
    if not task or not task.file_path:
        raise HTTPException(status_code=404, detail="任务不存在")

    file_path = Path(task.file_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="原始混合音频不存在")
    if file_path.stat().st_size == 0:
        raise HTTPException(status_code=409, detail="原始混合音频为空")

    from fastapi.responses import FileResponse

    return FileResponse(
        path=file_path,
        media_type="audio/wav",
        filename=file_path.name,
        headers={
            "Accept-Ranges": "bytes",
        },
    )


@router.get("/{task_id}/analysis", response_model=TaskAnalysisResponse)
async def get_task_analysis(
    task_id: str,
    target: str = "Vocals",
    include_all_stems: bool = False,
    waveform_points: int = 800,
    spec_freq_bins: int = 128,
    spec_time_bins: int = 256,
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
        raise HTTPException(status_code=404, detail="任务不存在")

    # 拉取 stems
    result = await db.execute(select(StemFile).where(StemFile.task_id == task_id_int))
    stems = list(result.scalars().all())

    # 轻量分析参数（用于前端缩放时按需提高清晰度）
    wp = max(200, min(20000, int(waveform_points or 800)))
    sfreq = max(32, min(512, int(spec_freq_bins or 128)))
    stime = max(64, min(1024, int(spec_time_bins or 256)))

    def safe_analyze(path_str: str):
        p = Path(path_str)
        if not p.exists() or p.stat().st_size == 0:
            return None
        try:
            return analysis_to_payload(
                analyze_audio_file(
                    p,
                    waveform_points=wp,
                    spec_freq_bins=sfreq,
                    spec_time_bins=stime,
                )
            )
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


@router.post("/analysis/gold", response_model=AudioAnalysisPayload)
async def analyze_uploaded_gold(
    file: UploadFile = File(...),
    waveform_points: int = 800,
    spec_freq_bins: int = 128,
    spec_time_bins: int = 256,
):
    """
    对用户上传的 Gold Standard Stem 做轻量分析（波形 + 频谱），
    主要用于前端可视化对比。

    注意：这里与任务本身解耦，仅分析单个上传文件，不写入数据库。
    """
    try:
        raw = await file.read()
        if not raw:
            raise HTTPException(status_code=400, detail="Gold 文件为空")

        suffix = Path(file.filename or "gold.wav").suffix or ".wav"
        with tempfile.TemporaryDirectory(prefix="audiolab_gold_") as td:
            tmp_path = Path(td) / f"gold{suffix}"
            tmp_path.write_bytes(raw)

            analysis = analyze_audio_file(
                tmp_path,
                waveform_points=waveform_points,
                spec_freq_bins=spec_freq_bins,
                spec_time_bins=spec_time_bins,
            )
            return AudioAnalysisPayload(**analysis_to_payload(analysis))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Gold 分析失败: file=%s err=%s", getattr(file, "filename", None), e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Gold 分析失败: {type(e).__name__}: {str(e)}")


@router.post("/{task_id}/objective-metrics", response_model=ObjectiveMetricsResponse)
async def compute_objective_metrics(
    task_id: str,
    target: str = "Vocals",
    reference: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """
    计算客观指标（SDR/SIR/SAR）。

    说明：
    - 需要你上传该 stem 的“金标准参考音轨”(reference)
    - 使用两源假设：mixture = target + interference（干扰参考由 mixture - target 得到）
    """
    # 确保 task_id 是有效的整数（支持大整数）
    try:
        task_id_int = int(task_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="无效的任务ID")

    task = await db.get(SeparationTask, task_id_int)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    # 拉取 stems，找到目标 stem 的算法输出
    from sqlalchemy import select, func

    result = await db.execute(
        select(StemFile).where(
            (StemFile.task_id == task_id_int)
            & (func.lower(StemFile.stem_name) == target.lower())
        )
    )
    stem = result.scalars().first()
    if not stem:
        raise HTTPException(status_code=404, detail=f"未找到目标声部：{target}")

    mixture_path = Path(task.file_path)
    estimate_path = Path(stem.file_path)
    if not mixture_path.exists():
        raise HTTPException(status_code=404, detail="原始混合音频不存在")
    if not estimate_path.exists():
        raise HTTPException(status_code=404, detail="算法输出声部文件不存在")

    # 保存 reference 到临时文件
    tmp_dir = Path(tempfile.gettempdir()) / "audiolab_objective_metrics" / str(task_id_int)
    tmp_dir.mkdir(parents=True, exist_ok=True)
    safe_name = Path(reference.filename or "reference").name
    ref_path = tmp_dir / f"ref_{target}_{safe_name}"
    try:
        ref_bytes = await reference.read()
        if not ref_bytes:
            raise HTTPException(status_code=400, detail="reference 文件为空")
        ref_path.write_bytes(ref_bytes)
    finally:
        await reference.close()

    try:
        m = compute_bss_metrics_two_source(
            mixture_path=mixture_path,
            estimate_path=estimate_path,
            reference_target_path=ref_path,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "计算客观指标失败: task_id=%s target=%s err=%s",
            task_id_int,
            target,
            e,
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail=f"计算客观指标失败: {type(e).__name__}: {str(e)}",
        )

    return ObjectiveMetricsResponse(
        target_stem=target,
        sdr=float(m.sdr),
        sir=float(m.sir),
        sar=float(m.sar),
        comment="已基于你上传的金标准参考 stem 计算 SDR/SIR/SAR（两源假设）。",
    )


@router.get("/{task_id}/residual")
async def get_residual_audio(
    task_id: str,
    target: str = "Vocals",
    db: AsyncSession = Depends(get_db),
):
    """
    残差播放器音频：

    - 计算 r(t) = mixture(t) - estimate(t)
    - 用于听“剩余干扰 + 伪影”：如果还能听到大量人声，说明算法漏分离；
      如果主要是鼓/贝斯等，则说明目标声部分离较干净。
    """
    try:
      task_id_int = int(task_id)
    except (ValueError, TypeError):
      raise HTTPException(status_code=400, detail="无效的任务ID")

    task = await db.get(SeparationTask, task_id_int)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    from sqlalchemy import select, func

    result = await db.execute(
        select(StemFile).where(
            (StemFile.task_id == task_id_int)
            & (func.lower(StemFile.stem_name) == target.lower())
        )
    )
    stem = result.scalars().first()
    if not stem:
        raise HTTPException(status_code=404, detail=f"未找到目标声部：{target}")

    mixture_path = Path(task.file_path)
    estimate_path = Path(stem.file_path)
    if not mixture_path.exists():
        raise HTTPException(status_code=404, detail="原始混合音频不存在")
    if not estimate_path.exists():
        raise HTTPException(status_code=404, detail="算法输出声部文件不存在")

    # 输出到临时 WAV 文件（mono, 44.1kHz）
    tmp_dir = Path(tempfile.gettempdir()) / "audiolab_residual" / str(task_id_int)
    tmp_dir.mkdir(parents=True, exist_ok=True)
    safe_target = "".join(ch for ch in target if ch.isalnum() or ch in "._-") or "stem"
    out_path = tmp_dir / f"residual_{safe_target}.wav"

    try:
        residual = compute_residual_mix_minus_est(
            mixture_path=mixture_path,
            estimate_path=estimate_path,
        )
        # 与 _load_mono_44k 一致，采样率固定为 44.1k
        sf.write(out_path, residual, 44100, subtype="PCM_16")
    except Exception as e:
        logger.error(
            "生成残差音频失败: task_id=%s target=%s err=%s",
            task_id_int,
            target,
            e,
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail=f"生成残差音频失败: {type(e).__name__}: {str(e)}",
        )

    if not out_path.exists() or out_path.stat().st_size == 0:
        raise HTTPException(status_code=500, detail="残差音频文件为空或不存在")

    from fastapi.responses import FileResponse

    return FileResponse(
        path=out_path,
        media_type="audio/wav",
        filename=f"{safe_target}_residual.wav",
        headers={
            "Accept-Ranges": "bytes",  # 便于浏览器拖动/seek
        },
    )
