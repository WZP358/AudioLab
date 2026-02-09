from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, distinct
from typing import List, Dict

from app.database import get_db
from app.models import Score, Algorithm, Role, User
from app.schemas import ScoreCreate, ScoreResponse, StatsResponse, DetailedStatsResponse, AlgorithmComparisonResponse
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
