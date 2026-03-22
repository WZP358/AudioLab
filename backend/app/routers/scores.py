from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, distinct
from typing import List, Dict, Optional
import json

from app.database import get_db
from app.models import Score, Algorithm, Role, User, SeparationTask
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
)
from app.routers.auth import get_current_user

router = APIRouter(prefix="/api/scores", tags=["scores"])

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
    # 检查用户是否为专家
    if current_user.role != Role.EXPERT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅专家用户可提交主观评分"
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
    # 检查用户是否为专家
    if current_user.role != Role.EXPERT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅专家用户可提交主观评分"
        )

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
    返回“主观评分 + 任务级客观指标”的联合样本点列表。

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
                sdr=float(row.sdr) if row.sdr is not None else None,
                sir=float(row.sir) if row.sir is not None else None,
                sar=float(row.sar) if row.sar is not None else None,
                si_sdr=_extract_si_sdr(row.metadata_json, row.comment),
            )
        )

    return points
