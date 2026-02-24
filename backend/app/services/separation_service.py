from pathlib import Path
import logging
from app.models import SeparationTask, StemFile, TaskStatus, Algorithm
from app.database import AsyncSessionLocal
from app.services.separation_engine import build_separation_engine_from_env, clear_task_cancelled
from app.utils.progress import print_progress_text, print_progress_bar

logger = logging.getLogger(__name__)

async def process_separation(task_id: int, file_path: str, algorithm: Algorithm):
    """处理音频分离任务（可通过环境变量切换 mock/http/local 引擎）"""
    async with AsyncSessionLocal() as session:
        try:
            # 更新任务状态为处理中（若未被用户取消）
            task = await session.get(SeparationTask, task_id)
            if not task:
                return

            # 若任务已经被标记为“用户取消”，则不再进入真正的分离流程
            if task.status == TaskStatus.FAILED and (task.comment or "").startswith("任务已被用户取消"):
                print_progress_text(f"[任务 {task_id}] 已被用户取消，跳过分离处理。")
                return

            print_progress_text(f"[任务 {task_id}] 开始处理音频分离，算法: {algorithm.value}")
            print_progress_text(f"[任务 {task_id}] 输入文件: {Path(file_path).name}")

            task.status = TaskStatus.PROCESSING
            await session.commit()
            
            print_progress_text(f"[任务 {task_id}] 初始化分离引擎...")
            engine = build_separation_engine_from_env()
            engine_type = type(engine).__name__
            print_progress_text(f"[任务 {task_id}] 引擎类型: {engine_type}")

            # 结果目录（与 tasks.py 保持一致）
            results_dir = Path("/app/results") / str(task_id)
            
            print_progress_text(f"[任务 {task_id}] 开始执行分离...")
            result = await engine.separate(
                input_path=Path(file_path), algorithm=algorithm, results_dir=results_dir, task_id=task_id
            )

            # 再次刷新任务，避免覆盖可能在分离过程中被设置的“用户取消”状态
            await session.refresh(task)
            if task.status == TaskStatus.FAILED and (task.comment or "").startswith("任务已被用户取消"):
                print_progress_text(f"[任务 {task_id}] 在分离过程中被用户取消，跳过结果写入。")
                return

            # 写入 stem 文件记录
            print_progress_text(f"[任务 {task_id}] 保存分离结果...")
            stem_count = len(result.stems)
            for idx, (stem_name, stem_path) in enumerate(result.stems.items(), 1):
                stem_file = StemFile(
                    task_id=task_id,
                    stem_name=stem_name,
                    file_path=str(stem_path),
                )
                session.add(stem_file)
                print_progress_text(f"[任务 {task_id}] 已保存 stem {idx}/{stem_count}: {stem_name}")

            # 更新任务状态和指标（若引擎未提供则保持为空）
            task.status = TaskStatus.COMPLETED
            task.sdr = result.sdr
            task.sir = result.sir
            task.sar = result.sar
            task.comment = result.comment

            await session.commit()
            print_progress_text(f"[任务 {task_id}] ✓ 分离完成！生成了 {stem_count} 个 stem 文件")

            # 正常结束后清理取消标记
            clear_task_cancelled(task_id)
        except Exception as e:
            # 区分“用户主动取消”与真实错误，避免把取消当成异常噪音
            msg = f"{type(e).__name__}: {str(e)}"
            is_user_cancel = "CANCELLED_BY_USER" in str(e) or (
                await session.get(SeparationTask, task_id)
            ) is not None

            if is_user_cancel:
                # 已经由 /cancel 接口把状态改成 FAILED + "任务已被用户取消"
                logger.info("任务 %s 已被用户取消（MSS 进程提前退出）。", task_id)
                print_progress_text(f"[任务 {task_id}] 已根据用户请求取消分离。")
            else:
                # 记录详细错误信息
                error_msg = f"任务 {task_id} 处理失败: {msg}"
                logger.error(error_msg, exc_info=True)
                print_progress_text(f"[任务 {task_id}] ✗ 分离失败: {msg}")

                # 更新任务状态为失败（若未被标记为“用户取消”）
                task = await session.get(SeparationTask, task_id)
                if task:
                    await session.refresh(task)
                    if not (task.status == TaskStatus.FAILED and (task.comment or "").startswith("任务已被用户取消")):
                        task.status = TaskStatus.FAILED
                        # 将错误信息保存到 comment 字段，方便前端显示
                        task.comment = f"分离失败: {msg}"
                        await session.commit()
            # 无论如何，最终清理取消标记
            clear_task_cancelled(task_id)
            # 注意：该函数通常在 Starlette BackgroundTask 中执行。
            # 这里不再 re-raise，避免异常向上冒泡导致 ASGI 记录 "Unhandled exception" 噪音日志；
            # 同时任务状态与错误信息已持久化到数据库，前端可正常轮询到 FAILED + comment。
            return
