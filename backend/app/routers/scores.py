from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, distinct
from typing import List, Dict, Optional
import json
import csv
import io
import math
import random

import numpy as np

from app.database import get_db
from app.models import Score, Algorithm, Role, User, SeparationTask, BlindSample
from app.schemas import (
    ScoreCreate,
    ScoreCreateBatch,
    StemScoreData,
    ScoreUpdate,
    ScoreResponse,
    StatsResponse,
    DetailedStatsResponse,
    AlgorithmComparisonResponse,
    SubjectiveObjectivePoint,
    SocQualityCorrelationResponse,
)
from app.routers.auth import get_current_user

router = APIRouter(prefix="/api/scores", tags=["scores"])

@router.get("/export")
async def export_scores_csv(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """管理员批量导出全部专家主观评分，便于提交专利/实验材料。"""
    if current_user.role != Role.ADMIN:
        raise HTTPException(status_code=403, detail="仅管理员可导出评分")
    result = await db.execute(select(Score).order_by(Score.created_at.asc()))
    blind_result = await db.execute(select(BlindSample))
    blind_by_id = {item.id: item for item in blind_result.scalars().all()}
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["score_id", "user_id", "task_id", "blind_code", "algorithm", "stem_name", "quality", "interference", "artifacts", "overall_acceptability", "segment_start", "segment_end", "issue_tags", "reliability", "created_at"])
    for row in result.scalars().all():
        blind = blind_by_id.get(row.blind_sample_id)
        writer.writerow([row.id, row.user_id, row.task_id, blind.blind_code if blind else "", row.algorithm.value if row.algorithm else "", row.stem_name or "", row.quality, row.interference, row.artifacts, row.overall_acceptability if row.overall_acceptability is not None else "", row.segment_start if row.segment_start is not None else "", row.segment_end if row.segment_end is not None else "", row.issue_tags or "[]", row.reliability if row.reliability is not None else "", row.created_at.isoformat() if row.created_at else ""])
    from fastapi.responses import StreamingResponse
    return StreamingResponse(iter([output.getvalue().encode("utf-8-sig")]), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": "attachment; filename=subjective_scores.csv"})

def _to_0_100(value: Optional[float]) -> float:
    """
    统一评分口径为 0~100。
    兼容历史数据：若值疑似为 0~1（比例），则放大到 0~100。
    """
    if value is None:
        return 0.0
    try:
        v = float(value)
    except Exception:
        return 0.0
    if v <= 1.0:
        v *= 100.0
    if v < 0:
        return 0.0
    if v > 100:
        return 100.0
    return v


def _extract_si_sdr(metadata_json: Optional[str], comment: Optional[str]) -> Optional[float]:
    for raw in (metadata_json, comment):
        if not raw:
            continue
        try:
            data = json.loads(str(raw))
            if isinstance(data, dict) and data.get("si_sdr") is not None:
                return float(data.get("si_sdr"))
        except Exception:
            continue
    return None


def _extract_soc(metadata_json: Optional[str], comment: Optional[str], stem_name: Optional[str]) -> Optional[float]:
    if not stem_name:
        return None
    # stem_name 大小写不敏感处理（数据库通常是 Title Case）
    stem_key = str(stem_name).strip()
    stem_key_lower = stem_key.lower()

    for raw in (metadata_json, comment):
        if not raw:
            continue
        try:
            data = json.loads(str(raw))
            if isinstance(data, dict):
                soc_by_stem = data.get("soc_by_stem")
                if isinstance(soc_by_stem, dict):
                    # 先找精确 key，再做 case-insensitive fallback
                    if stem_key in soc_by_stem and soc_by_stem[stem_key] is not None:
                        return float(soc_by_stem[stem_key])
                    for k, v in soc_by_stem.items():
                        if str(k).lower() == stem_key_lower and v is not None:
                            return float(v)
        except Exception:
            continue
    return None


def _rankdata_average(x: np.ndarray, eps: float = 1e-12) -> np.ndarray:
    """
    将 x 转为"平均秩"（tie 使用平均秩）。
    等价于 scipy.stats.rankdata(method='average') 的简化实现。
    """
    x = np.asarray(x, dtype=np.float64)
    n = x.size
    if n == 0:
        return np.asarray([], dtype=np.float64)

    order = np.argsort(x, kind="mergesort")
    x_sorted = x[order]
    ranks = np.empty(n, dtype=np.float64)

    i = 0
    while i < n:
        j = i
        # 浮点 tie：使用 eps 容忍，避免数值误差导致 tie 判定失败
        while j + 1 < n and abs(x_sorted[j + 1] - x_sorted[i]) <= eps:
            j += 1
        avg_rank = (i + 1 + j + 1) / 2.0  # rank 从 1 开始
        ranks[order[i : j + 1]] = avg_rank
        i = j + 1

    return ranks


def _spearmanr_rho(x: np.ndarray, y: np.ndarray) -> float:
    rx = _rankdata_average(x)
    ry = _rankdata_average(y)
    if rx.size != ry.size or rx.size < 2:
        return 0.0
    # 常数秩 -> 方差为 0，相关系数无定义
    if float(np.std(rx)) <= 1e-12 or float(np.std(ry)) <= 1e-12:
        return 0.0
    rho = float(np.corrcoef(rx, ry)[0, 1])
    if math.isnan(rho) or math.isinf(rho):
        return 0.0
    return rho


def _permutation_p_one_sided_spearman(
    soc: np.ndarray,
    quality: np.ndarray,
    *,
    n_permutations: int,
    direction: str = "negative",
    seed: Optional[int] = 1234,
) -> tuple[float, float]:
    """
    基于置换检验的单侧 p 值（不依赖 SciPy）。

    期望：SOC 越低质量越低 => SOC 与 Quality 呈负相关，因此 direction='negative'。
    """
    if seed is not None:
        random.seed(seed)
        np.random.seed(seed)

    soc = np.asarray(soc, dtype=np.float64)
    quality = np.asarray(quality, dtype=np.float64)
    n = soc.size
    if n < 3:
        rho_obs = _spearmanr_rho(soc, quality)
        return rho_obs, 1.0

    rho_obs = _spearmanr_rho(soc, quality)

    # null: shuffle SOC only
    count_extreme = 0
    # 使用 numpy 置换更快
    for _ in range(int(n_permutations)):
        perm = np.random.permutation(n)
        rho_perm = _spearmanr_rho(soc[perm], quality)
        if direction == "negative":
            # 得到"更负/一样负"才算极端：rho_perm <= rho_obs
            if rho_perm <= rho_obs:
                count_extreme += 1
        else:
            if rho_perm >= rho_obs:
                count_extreme += 1

    # 加 1 的常见平滑，避免 p=0
    p_value = (count_extreme + 1.0) / (float(n_permutations) + 1.0)
    # p 的数值稳定性
    p_value = float(min(max(p_value, 0.0), 1.0))
    return rho_obs, p_value


@router.post("/batch", response_model=List[ScoreResponse])
async def create_score_batch(
    score_data: ScoreCreateBatch,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    批量提交主观评分（一次性提交所有4个源的评分）

    要求：
    - 仅专家可用
    - 必须同时提交 Vocals, Drums, Bass, Other 四个源的评分
    - 每个源的评分维度：quality, interference, artifacts（0-100）

    优点：
    - 确保评分完整性，避免遗漏
    - 减少网络请求次数
    - 保证数据一致性（同一时间戳）
    """
    # 专利实验的专家评分必须经过后端盲化映射；禁止旧接口写入可见算法评分。
    if current_user.role != Role.EXPERT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅专家用户可提交主观评分"
        )
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="直接算法评分接口已停用，请使用 /api/blind-samples/score 提交盲化评分",
    )

    # 验证任务是否存在
    task = await db.get(SeparationTask, score_data.task_id)
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"任务 {score_data.task_id} 不存在"
        )

    # 验证算法是否匹配
    if task.algorithm != score_data.algorithm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"任务算法为 {task.algorithm.value}，但提交的评分算法为 {score_data.algorithm.value}"
        )

    # 检查是否已经提交过评分（避免重复提交）
    existing_scores = await db.execute(
        select(Score).where(
            (Score.user_id == str(current_user.id))
            & (Score.task_id == score_data.task_id)
            & (Score.algorithm == score_data.algorithm)
        )
    )
    existing_list = existing_scores.scalars().all()

    if existing_list:
        existing_stems = {s.stem_name for s in existing_list}
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"您已经为该任务提交过评分（已评分的源: {', '.join(sorted(existing_stems))}）。如需修改，请先删除旧评分。"
        )

    # 批量创建评分记录
    created_scores = []
    for stem_score in score_data.scores:
        score = Score(
            user_id=str(current_user.id),
            task_id=score_data.task_id,
            algorithm=score_data.algorithm,
            stem_name=stem_score.stem_name,
            quality=stem_score.quality,
            interference=stem_score.interference,
            artifacts=stem_score.artifacts,
            overall_acceptability=stem_score.overall_acceptability,
            segment_start=stem_score.segment_start,
            segment_end=stem_score.segment_end,
            issue_tags=json.dumps(stem_score.issue_tags, ensure_ascii=False),
            reliability=stem_score.reliability,
        )
        db.add(score)
        created_scores.append(score)

    await db.commit()

    # 刷新所有记录以获取生成的 ID 和时间戳
    for score in created_scores:
        await db.refresh(score)

    return created_scores


@router.post("", response_model=ScoreResponse)
async def create_score(
    score_data: ScoreCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    提交单个源的主观评分（已弃用，建议使用 /batch 接口）

    保留此接口用于向后兼容，但推荐使用批量提交接口确保评分完整性。
    """
    # 专利实验的专家评分必须经过后端盲化映射；禁止旧接口写入可见算法评分。
    if current_user.role != Role.EXPERT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅专家用户可提交主观评分"
        )
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="直接算法评分接口已停用，请使用 /api/blind-samples/score 提交盲化评分",
    )

    task = await db.get(SeparationTask, score_data.task_id)
    if not task:
        raise HTTPException(status_code=404, detail="评分对应的分离任务不存在")
    if task.algorithm != score_data.algorithm:
        raise HTTPException(status_code=400, detail="评分算法与分离任务实际算法不一致")

    # 简单数值校验：评分应在 0~100 之间，防止前端异常数据写入
    for field in ("quality", "interference", "artifacts"):
        value = getattr(score_data, field, None)
        if value is None or not (0 <= value <= 100):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{field} 评分应在 0~100 之间",
            )

    score = Score(
        user_id=str(current_user.id),
        task_id=score_data.task_id,
        algorithm=score_data.algorithm,
        stem_name=score_data.stem_name,
        quality=score_data.quality,
        interference=score_data.interference,
        artifacts=score_data.artifacts,
        overall_acceptability=score_data.overall_acceptability,
        segment_start=score_data.segment_start,
        segment_end=score_data.segment_end,
        issue_tags=json.dumps(score_data.issue_tags, ensure_ascii=False),
        reliability=score_data.reliability,
    )
    db.add(score)
    await db.commit()
    await db.refresh(score)
    return score


@router.get("", response_model=List[ScoreResponse])
async def get_scores(
    skip: int = 0,
    limit: int = 100,
    user_id: Optional[str] = None,
    task_id: Optional[int] = None,
    algorithm: Optional[Algorithm] = None,
    stem_name: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取评分列表（仅管理员，可按专家/任务等筛选）"""
    if current_user.role != Role.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅管理员可查看所有评分记录",
        )

    from sqlalchemy import select

    q = select(Score)
    if user_id is not None:
        q = q.where(Score.user_id == str(user_id))
    if task_id is not None:
        q = q.where(Score.task_id == task_id)
    if algorithm is not None:
        q = q.where(Score.algorithm == algorithm)
    if stem_name:
        q = q.where(Score.stem_name == stem_name)

    result = await db.execute(
        q.offset(skip).limit(limit).order_by(Score.created_at.desc())
    )
    return result.scalars().all()


@router.get("/me", response_model=List[ScoreResponse])
async def get_my_scores(
    skip: int = 0,
    limit: int = 100,
    task_id: Optional[int] = None,
    algorithm: Optional[Algorithm] = None,
    stem_name: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取当前用户（专家）的评分记录列表"""
    if current_user.role not in (Role.EXPERT, Role.ADMIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权限查看评分记录")

    q = select(Score).where(Score.user_id == str(current_user.id))
    if task_id is not None:
        q = q.where(Score.task_id == task_id)
    if algorithm is not None:
        q = q.where(Score.algorithm == algorithm)
    if stem_name:
        q = q.where(Score.stem_name == stem_name)

    result = await db.execute(q.offset(skip).limit(limit).order_by(Score.created_at.desc()))
    return result.scalars().all()


@router.delete("/{score_id}")
async def delete_score(
    score_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """删除单条评分记录（专家仅可删除自己的记录；管理员可删除任意记录）"""
    result = await db.execute(select(Score).where(Score.id == score_id))
    score = result.scalars().first()
    if not score:
        raise HTTPException(status_code=404, detail="评分记录不存在")

    # 权限控制
    if current_user.role == Role.ADMIN:
        pass
    elif current_user.role == Role.EXPERT:
        if str(current_user.id) != str(score.user_id):
            raise HTTPException(status_code=403, detail="仅可删除自己的评分记录")
    else:
        raise HTTPException(status_code=403, detail="无权限删除评分记录")

    await db.delete(score)
    await db.commit()
    return {"message": "评分记录已删除", "score_id": str(score_id)}


@router.put("/{score_id}", response_model=ScoreResponse)
async def update_score(
    score_id: int,
    score_data: ScoreUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """更新评分记录（专家仅可修改自己的记录；管理员可修改任意记录）"""
    from sqlalchemy import select

    result = await db.execute(select(Score).where(Score.id == score_id))
    score = result.scalars().first()
    if not score:
        raise HTTPException(status_code=404, detail="评分记录不存在")

    # 权限控制
    if current_user.role == Role.ADMIN:
        pass
    elif current_user.role == Role.EXPERT:
        if str(current_user.id) != str(score.user_id):
            raise HTTPException(status_code=403, detail="仅可修改自己的评分记录")
    else:
        raise HTTPException(status_code=403, detail="无权限修改评分记录")

    data = score_data.dict(exclude_unset=True)
    for field, value in data.items():
        if field == "issue_tags" and isinstance(value, list):
            value = json.dumps(value, ensure_ascii=False)
        setattr(score, field, value)

    await db.commit()
    await db.refresh(score)
    return score


@router.get("/stats", response_model=List[StatsResponse])
async def get_stats(db: AsyncSession = Depends(get_db)):
    """
    获取算法 + stem 维度的统计信息

    统计维度：
    - algorithm
    - stem_name（若为空，则聚合为 "ALL"）
    """
    from sqlalchemy import select

    result = await db.execute(
        select(
            Score.algorithm.label("algorithm"),
            Score.stem_name.label("stem_name"),
            func.avg(Score.quality).label("avg_quality"),
            func.avg(Score.interference).label("avg_interference"),
            func.avg(Score.artifacts).label("avg_artifacts"),
            func.count(Score.id).label("total_scores"),
        ).group_by(Score.algorithm, Score.stem_name)
    )

    stats_list: list[StatsResponse] = []
    for row in result:
        if row.total_scores and row.total_scores > 0:
            stats_list.append(
                StatsResponse(
                    algorithm=row.algorithm,
                    stem_name=row.stem_name or "ALL",
                    avg_quality=_to_0_100(row.avg_quality),
                    avg_interference=_to_0_100(row.avg_interference),
                    avg_artifacts=_to_0_100(row.avg_artifacts),
                    total_scores=int(row.total_scores),
                )
            )

    return stats_list


@router.get("/stats/detailed", response_model=List[DetailedStatsResponse])
async def get_detailed_stats(db: AsyncSession = Depends(get_db)):
    """
    获取详细的统计信息，包含每个 (algorithm, stem_name) 组合下的专家数量。

    注意：这里的 unique_experts 是「在该算法 + 该 stem 组合下参与评分的专家数」，
    并不是全站唯一专家总数。
    """
    stem_name_expr = func.coalesce(Score.stem_name, "ALL")
    result = await db.execute(
        select(
            Score.algorithm.label("algorithm"),
            stem_name_expr.label("stem_name"),
            func.avg(Score.quality).label("avg_quality"),
            func.avg(Score.interference).label("avg_interference"),
            func.avg(Score.artifacts).label("avg_artifacts"),
            func.count(Score.id).label("total_scores"),
            func.count(distinct(Score.user_id)).label("unique_experts"),
        ).group_by(Score.algorithm, stem_name_expr)
    )

    stats_list: list[DetailedStatsResponse] = []
    for row in result:
        if row.total_scores and row.total_scores > 0:
            stats_list.append(
                DetailedStatsResponse(
                    algorithm=row.algorithm,
                    stem_name=row.stem_name or "ALL",
                    avg_quality=_to_0_100(row.avg_quality),
                    avg_interference=_to_0_100(row.avg_interference),
                    avg_artifacts=_to_0_100(row.avg_artifacts),
                    total_scores=int(row.total_scores),
                    unique_experts=int(row.unique_experts or 0),
                )
            )

    return stats_list


@router.get("/stats/global-experts", response_model=int)
async def get_global_expert_count(db: AsyncSession = Depends(get_db)) -> int:
    """
    获取全站唯一专家账号数量。

    统计口径：User 表中 role == Role.EXPERT 的用户总数，
    与「系统里实际存在多少个专家账号」保持一致，
    不依赖是否已经提交过评分。
    """
    result = await db.execute(
        select(func.count()).select_from(User).where(User.role == Role.EXPERT)
    )
    count_value = result.scalar() or 0
    return int(count_value)


@router.get("/stats/algorithm-comparison", response_model=List[AlgorithmComparisonResponse])
async def get_algorithm_comparison(db: AsyncSession = Depends(get_db)):
    """
    获取算法对比统计，包含各算法在不同stem上的表现
    
    返回每个算法的总体统计和按stem的详细统计
    """
    # 先获取所有算法的总体统计
    overall_result = await db.execute(
        select(
            Score.algorithm.label("algorithm"),
            func.avg(Score.quality).label("avg_quality"),
            func.avg(Score.interference).label("avg_interference"),
            func.avg(Score.artifacts).label("avg_artifacts"),
            func.count(Score.id).label("total_scores"),
        ).group_by(Score.algorithm)
    )

    # 获取按算法和stem的详细统计
    stem_name_expr = func.coalesce(Score.stem_name, "ALL")
    stem_result = await db.execute(
        select(
            Score.algorithm.label("algorithm"),
            stem_name_expr.label("stem_name"),
            func.avg(Score.quality).label("avg_quality"),
            func.avg(Score.interference).label("avg_interference"),
            func.avg(Score.artifacts).label("avg_artifacts"),
            func.count(Score.id).label("total_scores"),
        ).group_by(Score.algorithm, stem_name_expr)
    )

    # 构建stem统计字典
    stem_stats_dict: Dict[str, List[StatsResponse]] = {}
    for row in stem_result:
        if row.total_scores and row.total_scores > 0:
            algo_key = str(row.algorithm)
            if algo_key not in stem_stats_dict:
                stem_stats_dict[algo_key] = []
            stem_stats_dict[algo_key].append(
                StatsResponse(
                    algorithm=row.algorithm,
                    stem_name=row.stem_name or "ALL",
                    avg_quality=_to_0_100(row.avg_quality),
                    avg_interference=_to_0_100(row.avg_interference),
                    avg_artifacts=_to_0_100(row.avg_artifacts),
                    total_scores=int(row.total_scores),
                )
            )

    # 构建返回结果
    comparison_list: List[AlgorithmComparisonResponse] = []
    for row in overall_result:
        if row.total_scores and row.total_scores > 0:
            algo_key = str(row.algorithm)
            comparison_list.append(
                AlgorithmComparisonResponse(
                    algorithm=row.algorithm,
                    overall_avg_quality=_to_0_100(row.avg_quality),
                    overall_avg_interference=_to_0_100(row.avg_interference),
                    overall_avg_artifacts=_to_0_100(row.avg_artifacts),
                    total_scores=int(row.total_scores),
                    stem_breakdown=stem_stats_dict.get(algo_key, []),
                )
            )

    return comparison_list


@router.get(
    "/stats/subjective-objective-points",
    response_model=List[SubjectiveObjectivePoint],
)
async def get_subjective_objective_points(
    algorithm: Optional[Algorithm] = None,
    stem_name: Optional[str] = None,
    limit: int = 500,
    db: AsyncSession = Depends(get_db),
):
    """
    返回"主观评分 + 任务级客观指标"的联合样本点列表。

    用途：
    - 前端绘制「Quality vs SDR」等相关性散点图与回归线；
    - 支持按 algorithm / stem_name 过滤。

    说明：
    - 仅返回存在任务级 sdr 的样本（即对应 SeparationTask.sdr 非空）。
    """
    limit = max(50, min(5000, int(limit or 500)))

    stmt = (
        select(
            Score.task_id,
            Score.algorithm,
            Score.stem_name,
            Score.quality,
            Score.interference,
            Score.artifacts,
            SeparationTask.sdr,
            SeparationTask.sir,
            SeparationTask.sar,
            SeparationTask.metadata_json,
            SeparationTask.comment,
        )
        .join(
            SeparationTask,
            (SeparationTask.id == Score.task_id)
            & (SeparationTask.algorithm == Score.algorithm),
        )
        .where(SeparationTask.sdr.isnot(None))
    )

    if algorithm is not None:
        stmt = stmt.where(Score.algorithm == algorithm)
    if stem_name:
        stmt = stmt.where(Score.stem_name == stem_name)

    stmt = stmt.order_by(Score.created_at.desc()).limit(limit)

    result = await db.execute(stmt)
    rows = result.all()

    points: List[SubjectiveObjectivePoint] = []
    for row in rows:
        points.append(
            SubjectiveObjectivePoint(
                task_id=row.task_id,
                algorithm=row.algorithm,
                stem_name=row.stem_name,
                quality=_to_0_100(row.quality),
                interference=_to_0_100(row.interference),
                artifacts=_to_0_100(row.artifacts),
                soc=_extract_soc(row.metadata_json, row.comment, row.stem_name),
                sdr=float(row.sdr) if row.sdr is not None else None,
                sir=float(row.sir) if row.sir is not None else None,
                sar=float(row.sar) if row.sar is not None else None,
                si_sdr=_extract_si_sdr(row.metadata_json, row.comment),
            )
        )

    return points


@router.get(
    "/stats/soc-quality-correlation",
    response_model=SocQualityCorrelationResponse,
)
async def get_soc_quality_correlation(
    algorithm: Optional[Algorithm] = None,
    stem_name: Optional[str] = None,
    n_permutations: int = 2000,
    seed: Optional[int] = 1234,
    db: AsyncSession = Depends(get_db),
):
    """
    自动生成论文用的数据证据：
    计算 SOC 与主观 Quality 的 Spearman 相关关系，并对"负相关"做单侧置换检验。

    说明：
    - 该接口依赖前置流程：客观指标计算时必须写入 SeparationTask.metadata_json.soc_by_stem。
    - 仅使用存在 soc 且存在质量评分（quality）且 task.sdr 非空的样本点。
    """
    n_permutations = max(200, min(20000, int(n_permutations or 2000)))

    # 复用原联合样本点查询逻辑：只取 SeparationTask.sdr 非空，避免未完成客观指标的样本
    stmt = (
        select(
            Score.task_id,
            Score.algorithm,
            Score.stem_name,
            Score.quality,
            Score.interference,
            Score.artifacts,
            SeparationTask.metadata_json,
            SeparationTask.comment,
        )
        .join(
            SeparationTask,
            (SeparationTask.id == Score.task_id)
            & (SeparationTask.algorithm == Score.algorithm),
        )
        .where(SeparationTask.sdr.isnot(None))
    )
    if algorithm is not None:
        stmt = stmt.where(Score.algorithm == algorithm)
    if stem_name:
        stmt = stmt.where(Score.stem_name == stem_name)

    # 取合理上限，避免一次性加载过多导致超时；你也可以按需调大 limit
    stmt = stmt.order_by(Score.created_at.desc()).limit(50000)

    result = await db.execute(stmt)
    rows = result.all()

    soc_list: List[float] = []
    q_list: List[float] = []

    for row in rows:
        soc = _extract_soc(row.metadata_json, row.comment, row.stem_name)
        if soc is None:
            continue
        q = _to_0_100(float(row.quality))
        soc_list.append(float(soc))
        q_list.append(float(q))

    n_samples = len(soc_list)
    if n_samples < 3:
        # 样本不足时给出默认值，避免前端/论文脚本崩溃
        return SocQualityCorrelationResponse(
            algorithm=algorithm,
            stem_name=stem_name,
            n_samples=n_samples,
            spearman_rho=0.0,
            p_value_one_sided=1.0,
            direction="negative",
        )

    soc_arr = np.asarray(soc_list, dtype=np.float64)
    q_arr = np.asarray(q_list, dtype=np.float64)

    rho, p_one_sided = _permutation_p_one_sided_spearman(
        soc_arr,
        q_arr,
        n_permutations=n_permutations,
        direction="negative",
        seed=seed,
    )

    return SocQualityCorrelationResponse(
        algorithm=algorithm,
        stem_name=stem_name,
        n_samples=n_samples,
        spearman_rho=rho,
        p_value_one_sided=p_one_sided,
        direction="negative",
    )
