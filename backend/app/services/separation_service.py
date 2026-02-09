from pathlib import Path
import logging
from app.models import SeparationTask, StemFile, TaskStatus, Algorithm
from app.database import AsyncSessionLocal
from app.services.separation_engine import build_separation_engine_from_env

logger = logging.getLogger(__name__)

async def process_separation(task_id: int, file_path: str, algorithm: Algorithm):
    """处理音频分离任务（可通过环境变量切换 mock/http/local 引擎）"""
    async with AsyncSessionLocal() as session:
        try:
            # 更新任务状态为处理中
            task = await session.get(SeparationTask, task_id)
            if not task:
                return
            
            task.status = TaskStatus.PROCESSING
            await session.commit()
            
            engine = build_separation_engine_from_env()

            # 结果目录（与 tasks.py 保持一致）
            results_dir = Path("/app/results") / str(task_id)

            result = await engine.separate(
                input_path=Path(file_path), algorithm=algorithm, results_dir=results_dir
            )

            # 写入 stem 文件记录
            for stem_name, stem_path in result.stems.items():
                stem_file = StemFile(
                    task_id=task_id,
                    stem_name=stem_name,
                    file_path=str(stem_path),
                )
                session.add(stem_file)

            # 更新任务状态和指标（若引擎未提供则保持为空）
            task.status = TaskStatus.COMPLETED
            task.sdr = result.sdr
            task.sir = result.sir
            task.sar = result.sar
            task.comment = result.comment
            
            await session.commit()
            
        except Exception as e:
            # 记录详细错误信息
            logger.error(
                f"任务 {task_id} 处理失败: {type(e).__name__}: {str(e)}",
                exc_info=True
            )
            # 更新任务状态为失败
            task = await session.get(SeparationTask, task_id)
            if task:
                task.status = TaskStatus.FAILED
                # 将错误信息保存到 comment 字段，方便前端显示
                task.comment = f"分离失败: {type(e).__name__}: {str(e)}"
                await session.commit()
            raise e
