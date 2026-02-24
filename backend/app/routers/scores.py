from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, distinct
from typing import List, Dict, Optional

from app.database import get_db
from app.models import Score, Algorithm, Role, User, SeparationTask
from app.schemas import (
    ScoreCreate,
    ScoreResponse,
    StatsResponse,
    DetailedStatsResponse,
    AlgorithmComparisonResponse,
    SubjectiveObjectivePoint,
)
from app.routers.auth import get_current_user

router = APIRouter(prefix="/api/scores", tags=["scores"])


@router.post("", response_model=ScoreResponse)
async def create_score(
    score_data: ScoreCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """提交主观评分（仅专家可用）"""
    # 检查用户是否为专家
    if current_user.role != Role.EXPERT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="仅专家用户可提交主观评分"
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
    db: AsyncSession = Depends(get_db),
):
    """获取评分列表"""
    from sqlalchemy import select
    result = await db.execute(
        select(Score).offset(skip).limit(limit).order_by(Score.created_at.desc())
    )
    scores = result.scalars().all()
    return scores


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
                    avg_quality=float(row.avg_quality or 0),
                    avg_interference=float(row.avg_interference or 0),
                    avg_artifacts=float(row.avg_artifacts or 0),
                    total_scores=int(row.total_scores),
                )
            )

    return stats_list


@router.get("/stats/detailed", response_model=List[DetailedStatsResponse])
async def get_detailed_stats(db: AsyncSession = Depends(get_db)):
    """
    获取详细的统计信息，包含专家数量
    
    统计维度：
    - algorithm
    - stem_name（若为空，则聚合为 "ALL"）
    - 包含参与评分的专家数量
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
                    avg_quality=float(row.avg_quality or 0),
                    avg_interference=float(row.avg_interference or 0),
                    avg_artifacts=float(row.avg_artifacts or 0),
                    total_scores=int(row.total_scores),
                    unique_experts=int(row.unique_experts or 0),
                )
            )

    return stats_list


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
                    avg_quality=float(row.avg_quality or 0),
                    avg_interference=float(row.avg_interference or 0),
                    avg_artifacts=float(row.avg_artifacts or 0),
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
                    overall_avg_quality=float(row.avg_quality or 0),
                    overall_avg_interference=float(row.avg_interference or 0),
                    overall_avg_artifacts=float(row.avg_artifacts or 0),
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
                quality=float(row.quality),
                interference=float(row.interference),
                artifacts=float(row.artifacts),
                sdr=float(row.sdr) if row.sdr is not None else None,
                sir=float(row.sir) if row.sir is not None else None,
                sar=float(row.sar) if row.sar is not None else None,
            )
        )

    return points
