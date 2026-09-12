from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, BackgroundTasks, Request, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, update
from typing import List, Optional
import os
import uuid
import logging
import json
import math
from pathlib import Path
from datetime import datetime, timedelta, timezone
import csv
import io
import zipfile

import numpy as np
from pydantic import BaseModel

from app.database import get_db
from app.models import SeparationTask, StemFile, BlindSample, TaskStatus, Algorithm, User, Role, Score, SystemConfig
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
    ObjectiveSignificanceRequest,
    ObjectiveSignificanceResponse,
)
from app.services.separation_service import process_separation
from app.services.queue_manager import TaskQueueManager
from app.services.analysis_service import analyze_audio_file, analysis_to_payload, _read_audio_any
from app.services.objective_metrics import compute_bss_metrics_two_source, compute_residual_mix_minus_est
from app.services.objective_metrics_multisource import compute_bss_metrics_multisource
from app.services.overlay_metrics import compute_soc_from_spectrograms
from app.utils.log_helper import get_client_ip, get_user_agent
import logging
import tempfile
import soundfile as sf
from fastapi.responses import StreamingResponse

logger = logging.getLogger(__name__)


def _parse_task_comment_meta(comment: Optional[str]) -> dict:
    """
    从 comment 中提取 JSON 元数据。
    兼容历史纯文本 comment：解析失败时返回空 dict。
    """
    if not comment:
        return {}
    text = str(comment).strip()
    if not text:
        return {}
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except Exception:
        return {}
    return {}


def _merge_task_comment_meta(comment: Optional[str], **kwargs) -> str:
    """
    将键值对合并到 comment JSON 元数据中并返回新字符串。
    """
    data = _parse_task_comment_meta(comment)
    for k, v in kwargs.items():
        if v is not None:
            data[k] = v
    return json.dumps(data, ensure_ascii=False)


def _parse_task_metadata(task: SeparationTask) -> dict:
    """
    优先读取 metadata_json；若为空则回退解析 comment（兼容历史数据）。
    """
    raw = getattr(task, "metadata_json", None)
    if raw:
        try:
            data = json.loads(str(raw))
            if isinstance(data, dict):
                return data
        except Exception:
            pass
    return _parse_task_comment_meta(getattr(task, "comment", None))


def _merge_task_metadata(task: SeparationTask, **kwargs) -> None:
    """
    合并写入 task.metadata_json，不改动原 comment 文本。
    """
    data = _parse_task_metadata(task)
    for k, v in kwargs.items():
        if v is not None:
            data[k] = v
    task.metadata_json = json.dumps(data, ensure_ascii=False)


def _get_task_si_sdr(task: SeparationTask) -> Optional[float]:
    meta = _parse_task_metadata(task)
    value = meta.get("si_sdr")
    try:
        return float(value) if value is not None else None
    except Exception:
        return None


def _get_task_model_version(task: SeparationTask) -> Optional[str]:
    meta = _parse_task_metadata(task)
    v = meta.get("model_version")
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def _attach_task_runtime_fields(task: SeparationTask) -> SeparationTask:
    """
    给 ORM 对象附加响应期字段（不落库），用于 TaskResponse 序列化输出。
    """
    setattr(task, "si_sdr", _get_task_si_sdr(task))
    setattr(task, "model_version", _get_task_model_version(task))
    return task


def _norm_cdf(z: float) -> float:
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def _wilcoxon_signed_rank(diffs: list[float]) -> tuple[float, float, float, float]:
    """
    Wilcoxon signed-rank（双侧）近似实现：
    返回 (w_stat, z_score, p_value, rank_biserial_effect_size)
    """
    non_zero = [d for d in diffs if abs(d) > 1e-12]
    n = len(non_zero)
    if n == 0:
        return 0.0, 0.0, 1.0, 0.0

    abs_vals = np.array([abs(d) for d in non_zero], dtype=np.float64)
    signs = np.array([1.0 if d > 0 else -1.0 for d in non_zero], dtype=np.float64)
    order = np.argsort(abs_vals)
    ranks = np.zeros(n, dtype=np.float64)

    # 平均秩处理 ties
    i = 0
    while i < n:
        j = i
        while j + 1 < n and abs(abs_vals[order[j + 1]] - abs_vals[order[i]]) < 1e-12:
            j += 1
        avg_rank = (i + 1 + j + 1) / 2.0
        ranks[order[i : j + 1]] = avg_rank
        i = j + 1

    w_plus = float(np.sum(ranks[signs > 0]))
    w_minus = float(np.sum(ranks[signs < 0]))
    w_stat = min(w_plus, w_minus)

    # 正态近似（含 tie 修正）
    mean_w = n * (n + 1) / 4.0
    _, counts = np.unique(abs_vals, return_counts=True)
    tie_correction = float(np.sum(counts**3 - counts))
    var_w = (n * (n + 1) * (2 * n + 1) - tie_correction) / 24.0
    if var_w <= 1e-12:
        z = 0.0
        p = 1.0
    else:
        z = (w_stat - mean_w) / math.sqrt(var_w)
        p = 2.0 * (1.0 - _norm_cdf(abs(z)))
        p = min(max(p, 0.0), 1.0)

    denom = w_plus + w_minus
    effect_rbc = (w_plus - w_minus) / denom if denom > 1e-12 else 0.0
    return float(w_stat), float(z), float(p), float(effect_rbc)


def _get_metric_value_from_task(task: SeparationTask, metric: str) -> Optional[float]:
    m = (metric or "").strip().lower()
    if m == "sdr":
        v = task.sdr
    elif m == "sir":
        v = task.sir
    elif m == "sar":
        v = task.sar
    elif m == "si_sdr":
        v = _get_task_si_sdr(task)
    else:
        return None
    try:
        return float(v) if v is not None else None
    except Exception:
        return None


class MixRequest(BaseModel):
    """
    多 stem 混合请求：
    - stem_names: 参与运算的 stem 名称（与 StemFile.stem_name 大小写不敏感匹配）
    - mode: "keep" 表示只保留这些 stem 混合；"remove" 表示从整体中消除这些 stem（等价于保留其它 stem）
    """
    stem_names: List[str]
    mode: str = "remove"  # "keep" | "remove"


def _assert_task_access(task: SeparationTask, current_user: User) -> None:
    """All task artifacts are private to the owner unless viewed by admin."""
    if current_user.role != Role.ADMIN and str(task.user_id) != str(current_user.id):
        raise HTTPException(status_code=403, detail="无权访问该任务")


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
    current_user: User = Depends(get_current_user),
):
    """
    根据用户选择的 stems 生成混合音频（可作为"自定义残差"或"自定义伴奏"使用）：
    - mode == "keep": 只用这些 stem 相加做混音
    - mode == "remove": 从所有 stem 中排除这些，再把剩余 stem 相加（等价于"消除这些声源"）
    """
    try:
        task_id_int = int(task_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="无效的任务ID")

    task = await db.get(SeparationTask, task_id_int)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    _assert_task_access(task, current_user)

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
        model_version = None
        try:
            cfg_key = f"algorithm_version.{algorithm.value}"
            cfg_q = select(SystemConfig).where(SystemConfig.key == cfg_key)
            cfg_r = await db.execute(cfg_q)
            cfg = cfg_r.scalars().first()
            if cfg and cfg.value:
                model_version = str(cfg.value).strip() or None
        except Exception:
            model_version = None

        task = SeparationTask(
            user_id=user_id,
            original_filename=file.filename,
            file_path=str(file_path),
            algorithm=algorithm,
            status=TaskStatus.PENDING,
            metadata_json=json.dumps({"model_version": model_version}, ensure_ascii=False) if model_version else None,
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
        return _attach_task_runtime_fields(task)
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
    将历史上以 user_id='anonymous' 创建的任务"找回"到当前账号名下（仅限本地/单用户场景）。

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
async def get_queue_position(task_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
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
    task = await db.get(SeparationTask, task_id_int)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    _assert_task_access(task, current_user)
    
    queue_manager = await TaskQueueManager.get_instance()
    position_info = await queue_manager.get_queue_position(task_id_int)
    
    if position_info is None:
        raise HTTPException(status_code=404, detail="任务不在队列中（可能已完成或失败）")
    
    return position_info


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(task_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
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
    _assert_task_access(task, current_user)
    
    logger.info(f"任务查询成功: task_id={task.id}, status={task.status}")
    return _attach_task_runtime_fields(task)


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
    
    - 用于"分离历史"页面展示"我的历史记录"；
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
        items=[TaskResponse.model_validate(_attach_task_runtime_fields(t)) for t in tasks],
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
        items=[TaskResponse.model_validate(_attach_task_runtime_fields(t)) for t in tasks],
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
async def cancel_task(task_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """
    取消一个正在排队或处理中的分离任务。

    说明：
    - 该接口为"软取消"：如果后端分离引擎已经在运行，可能无法立刻中断计算；
      但会将任务状态标记为 FAILED，并在 comment 中写入"任务已被用户取消"，
      前端可以据此识别为"用户主动取消"，而不是普通失败。
    """
    try:
        task_id_int = int(task_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="无效的任务ID")

    task = await db.get(SeparationTask, task_id_int)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    _assert_task_access(task, current_user)

    # 已经结束/失败的任务不允许重复取消，直接返回当前状态
    if task.status in (TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED):
        return task

    task.status = TaskStatus.CANCELLED
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
async def get_stems(task_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """获取分离后的音频文件列表"""
    # 确保 task_id 是有效的整数（支持大整数）
    try:
        task_id_int = int(task_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="无效的任务ID")
    
    task = await db.get(SeparationTask, task_id_int)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    _assert_task_access(task, current_user)
    
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
    - 为前端的"客观指标雷达图""算法排行榜"等提供数据支撑；
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

    # 额外聚合 SI-SDR（当前存储在 comment JSON 元数据里）
    si_map: dict[Algorithm, list[float]] = {}
    si_rows = await db.execute(
        select(SeparationTask.algorithm, SeparationTask.metadata_json, SeparationTask.comment)
        .where((SeparationTask.metadata_json.isnot(None)) | (SeparationTask.comment.isnot(None)))
    )
    for algo, metadata_json, comment in si_rows.all():
        meta = {}
        if metadata_json:
            try:
                meta = json.loads(str(metadata_json))
                if not isinstance(meta, dict):
                    meta = {}
            except Exception:
                meta = {}
        if not meta and comment:
            meta = _parse_task_comment_meta(comment)
        val = meta.get("si_sdr")
        try:
            f = float(val)
        except Exception:
            continue
        si_map.setdefault(algo, []).append(f)
    stats: List[ObjectiveAlgorithmStats] = []
    for row in rows:
        stats.append(
            ObjectiveAlgorithmStats(
                algorithm=row.algorithm,
                count_tasks=int(row.count_tasks or 0),
                avg_sdr=float(row.avg_sdr) if row.avg_sdr is not None else None,
                avg_sir=float(row.avg_sir) if row.avg_sir is not None else None,
                avg_sar=float(row.avg_sar) if row.avg_sar is not None else None,
                avg_si_sdr=float(np.mean(si_map[row.algorithm])) if row.algorithm in si_map and si_map[row.algorithm] else None,
            )
        )

    return stats


@router.get("/stats/objective-distribution", response_model=List[ObjectiveAlgorithmDistribution])
async def get_objective_distribution(db: AsyncSession = Depends(get_db)):
    """
    返回每个算法对应的 SDR 样本分布（仅包含 sdr 非空的任务）。

    前端可以基于该分布绘制箱线图/蜂群散点等"分布型"可视化，
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


@router.get("/stats/objective/export")
async def export_objective_stats_csv(db: AsyncSession = Depends(get_db)):
    """
    导出按算法聚合的客观指标统计（CSV）。
    字段：algorithm,count_tasks,avg_sdr,avg_sir,avg_sar,avg_si_sdr
    """
    stats = await get_objective_stats(db)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["algorithm", "count_tasks", "avg_sdr", "avg_sir", "avg_sar", "avg_si_sdr"])
    for row in stats:
        writer.writerow(
            [
                row.algorithm.value if hasattr(row.algorithm, "value") else str(row.algorithm),
                row.count_tasks,
                row.avg_sdr,
                row.avg_sir,
                row.avg_sar,
                row.avg_si_sdr,
            ]
        )

    output.seek(0)
    filename = f"objective_stats_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/stats/objective/export-detail")
async def export_objective_detail_csv(db: AsyncSession = Depends(get_db)):
    """导出每个分离任务的客观指标明细，避免只提供算法聚合均值。"""
    result = await db.execute(select(SeparationTask).where(SeparationTask.sdr.isnot(None)).order_by(SeparationTask.created_at.asc()))
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["task_id", "original_filename", "algorithm", "metric_scope", "stem_name", "segment_start", "segment_end", "sdr", "sir", "sar", "isr", "si_sdr", "metadata_json", "created_at"])
    for task in result.scalars().all():
        meta = _parse_task_metadata(task)
        source_metrics = meta.get("metrics_by_source") if isinstance(meta.get("metrics_by_source"), dict) else {}
        if source_metrics:
            for stem_name, metrics in source_metrics.items():
                metrics = metrics if isinstance(metrics, dict) else {}
                writer.writerow([task.id, task.original_filename or "", task.algorithm.value if task.algorithm else "", "source", stem_name, "", "", metrics.get("sdr"), metrics.get("sir"), metrics.get("sar"), metrics.get("isr"), metrics.get("si_sdr"), task.metadata_json or "", task.created_at.isoformat() if task.created_at else ""])
        else:
            writer.writerow([task.id, task.original_filename or "", task.algorithm.value if task.algorithm else "", "task_average", "ALL", "", "", task.sdr, task.sir, task.sar, "", meta.get("si_sdr"), task.metadata_json or "", task.created_at.isoformat() if task.created_at else ""])
    blind_result = await db.execute(select(BlindSample).where(BlindSample.objective_metrics_json.isnot(None)).order_by(BlindSample.created_at.asc()))
    for sample in blind_result.scalars().all():
        try:
            metrics = json.loads(sample.objective_metrics_json or "{}")
        except Exception:
            metrics = {}
        writer.writerow([sample.task_id, "", sample.algorithm.value if sample.algorithm else "", "clip", sample.stem_name, sample.start_seconds, sample.end_seconds, metrics.get("sdr"), metrics.get("sir"), metrics.get("sar"), metrics.get("isr"), metrics.get("si_sdr"), sample.objective_metrics_json or "", sample.created_at.isoformat() if sample.created_at else ""])
    output.seek(0)
    return StreamingResponse(iter([output.getvalue().encode("utf-8-sig")]), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f"attachment; filename=objective_detail_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"})


@router.post("/stats/significance", response_model=ObjectiveSignificanceResponse)
async def get_objective_significance(
    body: ObjectiveSignificanceRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    两算法客观指标的配对显著性检验（Wilcoxon signed-rank, 双侧）。

    配对口径：
    - 按 original_filename 对齐同一首歌曲；
    - 同一算法同一歌曲若有多条记录，先求均值再参与配对。
    """
    if body.algorithm_a == body.algorithm_b:
        raise HTTPException(status_code=400, detail="algorithm_a 与 algorithm_b 不能相同")

    result = await db.execute(
        select(
            SeparationTask.original_filename,
            SeparationTask.algorithm,
            SeparationTask.sdr,
            SeparationTask.sir,
            SeparationTask.sar,
            SeparationTask.metadata_json,
            SeparationTask.comment,
        ).where(SeparationTask.algorithm.in_([body.algorithm_a, body.algorithm_b]))
    )
    rows = result.all()

    # filename -> {algo: [values]}
    bucket: dict[str, dict[Algorithm, list[float]]] = {}
    for filename, algo, sdr, sir, sar, metadata_json, comment in rows:
        if not filename:
            continue
        fake_task = SeparationTask(
            original_filename=filename,
            algorithm=algo,
            sdr=sdr,
            sir=sir,
            sar=sar,
            metadata_json=metadata_json,
            comment=comment,
        )
        value = _get_metric_value_from_task(fake_task, body.metric)
        if value is None or not math.isfinite(value):
            continue
        d = bucket.setdefault(str(filename), {})
        d.setdefault(algo, []).append(float(value))

    a_values = {}
    b_values = {}
    for fn, per_algo in bucket.items():
        if body.algorithm_a in per_algo:
            a_values[fn] = float(np.mean(per_algo[body.algorithm_a]))
        if body.algorithm_b in per_algo:
            b_values[fn] = float(np.mean(per_algo[body.algorithm_b]))

    common = sorted(set(a_values.keys()) & set(b_values.keys()))
    if len(common) < 5:
        raise HTTPException(
            status_code=400,
            detail=f"可配对样本不足（当前 {len(common)} 对，至少需要 5 对）",
        )

    diffs = [a_values[k] - b_values[k] for k in common]
    w_stat, z_score, p_value, effect_rbc = _wilcoxon_signed_rank(diffs)

    return ObjectiveSignificanceResponse(
        algorithm_a=body.algorithm_a,
        algorithm_b=body.algorithm_b,
        metric=body.metric,
        n_pairs=len(common),
        w_stat=w_stat,
        z_score=z_score,
        p_value=p_value,
        effect_size_rbc=effect_rbc,
        significant=bool(p_value < 0.05),
    )


@router.get("/stats/significance/export")
async def export_objective_significance_csv(
    algorithm_a: Algorithm,
    algorithm_b: Algorithm,
    metric: str = "si_sdr",
    db: AsyncSession = Depends(get_db),
):
    """
    导出两算法显著性检验结果（CSV）。
    """
    body = ObjectiveSignificanceRequest(
        algorithm_a=algorithm_a,
        algorithm_b=algorithm_b,
        metric=metric,
    )
    result = await get_objective_significance(body=body, db=db)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "algorithm_a",
            "algorithm_b",
            "metric",
            "n_pairs",
            "w_stat",
            "z_score",
            "p_value",
            "effect_size_rbc",
            "significant",
        ]
    )
    writer.writerow(
        [
            result.algorithm_a.value if hasattr(result.algorithm_a, "value") else str(result.algorithm_a),
            result.algorithm_b.value if hasattr(result.algorithm_b, "value") else str(result.algorithm_b),
            result.metric,
            result.n_pairs,
            result.w_stat,
            result.z_score,
            result.p_value,
            result.effect_size_rbc,
            result.significant,
        ]
    )

    output.seek(0)
    filename = (
        f"significance_{(algorithm_a.value if hasattr(algorithm_a, 'value') else algorithm_a)}"
        f"_vs_{(algorithm_b.value if hasattr(algorithm_b, 'value') else algorithm_b)}"
        f"_{metric}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"
    )
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/stats/export-package")
async def export_paper_package(
    algorithm_a: Algorithm = Algorithm.SCNET,
    algorithm_b: Algorithm = Algorithm.MDX23C,
    metric: str = "si_sdr",
    db: AsyncSession = Depends(get_db),
):
    """
    论文导出包（ZIP）：
    - objective_stats.csv（按算法客观指标汇总）
    - significance.csv（指定算法对比的 Wilcoxon 结果）
    - model_versions.csv（管理员配置的算法版本快照）
    """
    # 1) objective_stats.csv
    objective_stats = await get_objective_stats(db)
    objective_buf = io.StringIO()
    objective_writer = csv.writer(objective_buf)
    objective_writer.writerow(["algorithm", "count_tasks", "avg_sdr", "avg_sir", "avg_sar", "avg_si_sdr"])
    for row in objective_stats:
        objective_writer.writerow(
            [
                row.algorithm.value if hasattr(row.algorithm, "value") else str(row.algorithm),
                row.count_tasks,
                row.avg_sdr,
                row.avg_sir,
                row.avg_sar,
                row.avg_si_sdr,
            ]
        )

    # 2) significance.csv
    sig_body = ObjectiveSignificanceRequest(
        algorithm_a=algorithm_a,
        algorithm_b=algorithm_b,
        metric=metric,
    )
    sig_result = await get_objective_significance(body=sig_body, db=db)
    sig_buf = io.StringIO()
    sig_writer = csv.writer(sig_buf)
    sig_writer.writerow(
        [
            "algorithm_a",
            "algorithm_b",
            "metric",
            "n_pairs",
            "w_stat",
            "z_score",
            "p_value",
            "effect_size_rbc",
            "significant",
        ]
    )
    sig_writer.writerow(
        [
            sig_result.algorithm_a.value if hasattr(sig_result.algorithm_a, "value") else str(sig_result.algorithm_a),
            sig_result.algorithm_b.value if hasattr(sig_result.algorithm_b, "value") else str(sig_result.algorithm_b),
            sig_result.metric,
            sig_result.n_pairs,
            sig_result.w_stat,
            sig_result.z_score,
            sig_result.p_value,
            sig_result.effect_size_rbc,
            sig_result.significant,
        ]
    )

    # 3) model_versions.csv（系统配置快照）
    cfg_result = await db.execute(
        select(SystemConfig.key, SystemConfig.value, SystemConfig.updated_at)
        .where(SystemConfig.key.like("algorithm_version.%"))
        .order_by(SystemConfig.key.asc())
    )
    cfg_rows = cfg_result.all()
    version_buf = io.StringIO()
    version_writer = csv.writer(version_buf)
    version_writer.writerow(["algorithm", "model_version", "updated_at"])
    for key, value, updated_at in cfg_rows:
        algo = str(key).replace("algorithm_version.", "", 1)
        version_writer.writerow(
            [
                algo,
                value if value is not None else "",
                updated_at.isoformat() if updated_at else "",
            ]
        )

    # ZIP in-memory
    zip_bytes = io.BytesIO()
    with zipfile.ZipFile(zip_bytes, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("objective_stats.csv", objective_buf.getvalue())
        zf.writestr("significance.csv", sig_buf.getvalue())
        zf.writestr("model_versions.csv", version_buf.getvalue())

    zip_bytes.seek(0)
    filename = f"paper_export_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.zip"
    return StreamingResponse(
        iter([zip_bytes.getvalue()]),
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/{task_id}/stems/{stem_id}/download")
async def download_stem(
    req: Request,
    task_id: str,
    stem_id: str,
    current_user: User = Depends(get_current_user),
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
    task = await db.get(SeparationTask, task_id_int)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    _assert_task_access(task, current_user)
    
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
    current_user: User = Depends(get_current_user),
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
    _assert_task_access(task, current_user)

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
    current_user: User = Depends(get_current_user),
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
    _assert_task_access(task, current_user)

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
    - 需要你上传该 stem 的"金标准参考音轨"(reference)
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

    # References are part of the experiment record. Keep them under the task's
    # persistent results directory so clip metrics still work after restart.
    reference_dir = RESULTS_DIR / str(task_id_int) / "references"
    reference_dir.mkdir(parents=True, exist_ok=True)
    safe_name = Path(reference.filename or "reference").name
    ref_path = reference_dir / f"ref_{target}_{uuid.uuid4().hex}_{safe_name}"
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
        # 直接透传上游 HTTP 异常（例如参数错误等）
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

    # 将计算得到的客观指标写回 SeparationTask，便于后续统计接口使用
    try:
        task.sdr = float(m.sdr)
        task.sir = float(m.sir)
        task.sar = float(m.sar)

        # 计算 SOC（频谱幅度重叠一致性），用于后续主客观相关性分析
        # 说明：SOC 基于与前端可视化一致的 spectrogram（幅度谱 + pool + 归一化到 [0,1]）
        soc_by_stem = (_parse_task_metadata(task).get("soc_by_stem") or {}).copy()
        if not isinstance(soc_by_stem, dict):
            soc_by_stem = {}

        analysis_ref = analyze_audio_file(
            ref_path,
            spec_freq_bins=128,
            spec_time_bins=256,
            max_seconds=0.0,  # 不裁剪：只影响"可视化窗口"，这里关闭裁剪以尽量匹配客观评估的裁剪逻辑
        )
        analysis_est = analyze_audio_file(
            estimate_path,
            spec_freq_bins=128,
            spec_time_bins=256,
            max_seconds=0.0,
        )
        soc = compute_soc_from_spectrograms(analysis_ref.spectrogram, analysis_est.spectrogram)
        soc_by_stem[target] = float(soc)

        _merge_task_metadata(
            task,
            si_sdr=float(m.si_sdr) if m.si_sdr is not None else None,
            soc_by_stem=soc_by_stem,
            reference_paths={**(_parse_task_metadata(task).get("reference_paths") or {}), target: str(ref_path)},
        )
        await db.commit()
        await db.refresh(task)
    except Exception as e:
        # 写库失败不影响前端拿到计算结果，但在日志中记录
        logger.error(
            "写入客观指标到 SeparationTask 失败: task_id=%s target=%s err=%s",
            task_id_int,
            target,
            e,
            exc_info=True,
        )

    return ObjectiveMetricsResponse(
        target_stem=target,
        sdr=float(m.sdr),
        sir=float(m.sir),
        sar=float(m.sar),
        si_sdr=float(m.si_sdr) if m.si_sdr is not None else None,
        comment="已基于你上传的金标准参考 stem 计算 SDR/SIR/SAR/SI-SDR（两源假设），并已写入任务记录。",
    )


@router.post("/{task_id}/objective-metrics-batch")
async def compute_objective_metrics_batch(
    task_id: str,
    vocals_ref: UploadFile = File(None),
    drums_ref: UploadFile = File(None),
    bass_ref: UploadFile = File(None),
    other_ref: UploadFile = File(None),
    db: AsyncSession = Depends(get_db),
):
    """
    批量计算多源分离的客观指标（完整 BSS Eval）

    说明：
    - 上传所有源的金标准参考（至少2个）
    - 使用完整的多源分离指标公式，考虑源间干扰
    - 返回每个源的 SDR/SIR/SAR/ISR 以及平均值

    适用场景：
    - 有完整数据集（如 MUSDB18）
    - 需要同时评估所有源的分离质量
    """
    try:
        task_id_int = int(task_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="无效的任务ID")

    task = await db.get(SeparationTask, task_id_int)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")

    # 收集上传的参考文件
    ref_files = {
        "Vocals": vocals_ref,
        "Drums": drums_ref,
        "Bass": bass_ref,
        "Other": other_ref,
    }
    ref_files = {k: v for k, v in ref_files.items() if v is not None}

    if len(ref_files) < 2:
        raise HTTPException(
            status_code=400,
            detail="至少需要上传2个源的金标准参考（多源分离需要多个参考源）"
        )

    # 获取任务的所有 stems
    from sqlalchemy import select
    result = await db.execute(
        select(StemFile).where(StemFile.task_id == task_id_int)
    )
    stems = result.scalars().all()
    stem_dict = {s.stem_name: s for s in stems}

    # 验证所有上传的参考都有对应的估计
    missing_stems = [name for name in ref_files.keys() if name not in stem_dict]
    if missing_stems:
        raise HTTPException(
            status_code=400,
            detail=f"任务中缺少以下 stems 的分离结果: {', '.join(missing_stems)}"
        )

    # Keep references with the task. The clip evaluator reuses these paths and
    # must not depend on the operating system's temporary directory.
    reference_dir = RESULTS_DIR / str(task_id_int) / "references"
    reference_dir.mkdir(parents=True, exist_ok=True)

    references = {}
    estimates = {}

    try:
        for stem_name, ref_file in ref_files.items():
            # 保存参考文件
            ref_bytes = await ref_file.read()
            if not ref_bytes:
                raise HTTPException(status_code=400, detail=f"{stem_name} 参考文件为空")

            safe_name = Path(ref_file.filename or f"{stem_name}_ref").name
            ref_path = reference_dir / f"ref_{stem_name}_{uuid.uuid4().hex}_{safe_name}"
            ref_path.write_bytes(ref_bytes)
            references[stem_name] = ref_path

            # 获取估计文件路径
            estimates[stem_name] = Path(stem_dict[stem_name].file_path)

        # 计算多源指标
        mixture_path = Path(task.file_path)
        if not mixture_path.exists():
            raise HTTPException(status_code=404, detail="原始混合音频不存在")

        metrics = compute_bss_metrics_multisource(
            mixture_path=mixture_path,
            estimates=estimates,
            references=references,
        )

        # 更新任务记录（使用平均 SDR）
        avg_sdr = metrics.get_average_sdr()
        task.sdr = float(avg_sdr)
        # SIR/SAR 也可以计算平均值
        avg_sir = float(np.mean([m["sir"] for m in metrics.metrics_by_source.values()]))
        avg_sar = float(np.mean([m["sar"] for m in metrics.metrics_by_source.values()]))
        avg_si_sdr = float(np.mean([m["si_sdr"] for m in metrics.metrics_by_source.values() if "si_sdr" in m]))
        task.sir = float(avg_sir)
        task.sar = float(avg_sar)
        # 额外计算 SOC（按 stem 级别），用于"SOC 与主观评分的相关性/单调性检验"
        meta = _parse_task_metadata(task)
        soc_by_stem = meta.get("soc_by_stem") or {}
        if not isinstance(soc_by_stem, dict):
            soc_by_stem = {}

        for stem_name, ref_path in references.items():
            est_path = estimates.get(stem_name)
            if est_path is None:
                continue
            analysis_ref = analyze_audio_file(
                ref_path,
                spec_freq_bins=128,
                spec_time_bins=256,
                max_seconds=0.0,
            )
            analysis_est = analyze_audio_file(
                est_path,
                spec_freq_bins=128,
                spec_time_bins=256,
                max_seconds=0.0,
            )
            soc_by_stem[stem_name] = float(compute_soc_from_spectrograms(analysis_ref.spectrogram, analysis_est.spectrogram))

        _merge_task_metadata(task, si_sdr=avg_si_sdr, soc_by_stem=soc_by_stem, metrics_by_source=metrics.metrics_by_source, reference_paths={**(_parse_task_metadata(task).get("reference_paths") or {}), **{name: str(path) for name, path in references.items()}})
        await db.commit()

        return {
            "task_id": task_id_int,
            "metrics_by_source": metrics.metrics_by_source,
            "average": {
                "sdr": avg_sdr,
                "sir": avg_sir,
                "sar": avg_sar,
                "si_sdr": avg_si_sdr,
            },
            "comment": f"已计算 {len(ref_files)} 个源的多源分离指标（完整 BSS Eval）",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "批量计算客观指标失败: task_id=%s err=%s",
            task_id_int,
            e,
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail=f"计算失败: {type(e).__name__}: {str(e)}",
        )


@router.get("/{task_id}/residual")
async def get_residual_audio(
    task_id: str,
    target: str = "Vocals",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    残差播放器音频：

    - 计算 r(t) = mixture(t) - estimate(t)
    - 用于听"剩余干扰 + 伪影"：如果还能听到大量人声，说明算法漏分离；
      如果主要是鼓/贝斯等，则说明目标声部分离较干净。
    """
    try:
      task_id_int = int(task_id)
    except (ValueError, TypeError):
      raise HTTPException(status_code=400, detail="无效的任务ID")

    task = await db.get(SeparationTask, task_id_int)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    _assert_task_access(task, current_user)

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
