from pathlib import Path
import logging
import os
from typing import Optional

from app.models import SeparationTask, StemFile, TaskStatus, Algorithm
from app.database import AsyncSessionLocal
from app.services.separation_engine import build_separation_engine_from_env, clear_task_cancelled
from app.services.batch_orchestrator import maybe_finalize_batch
from app.utils.progress import print_progress_text, print_progress_bar
from app.utils.config_helper import get_config_value

logger = logging.getLogger(__name__)


async def process_separation(task_id: int, file_path: str, algorithm: Algorithm, gpu_id: Optional[int] = None):
    """处理音频分离任务（支持通过系统配置切换 CPU / GPU 运行模式）"""
    async with AsyncSessionLocal() as session:
        try:
            # 更新任务状态为处理中（若未被用户取消）
            task = await session.get(SeparationTask, task_id)
            if not task:
                return

            # 若任务已经被标记为"用户取消"，则不再进入真正的分离流程
            if task.status == TaskStatus.CANCELLED:
                print_progress_text(f"[任务 {task_id}] 已被用户取消，跳过分离处理。")
                return

            print_progress_text(f"[任务 {task_id}] 开始处理音频分离，算法: {algorithm.value}")
            print_progress_text(f"[任务 {task_id}] 输入文件: {Path(file_path).name}")

            task.status = TaskStatus.PROCESSING
            await session.commit()

            # 根据系统配置决定运行模式（CPU / GPU）
            try:
                compute_mode = await get_config_value(
                    session,
                    key="separation_compute_mode",
                    default="gpu",
                    env_key="SEPARATION_COMPUTE_MODE",
                    config_type=str,
                )
                mode = (str(compute_mode) or "gpu").strip().lower()
            except Exception:
                mode = "gpu"

            if mode not in ("cpu", "gpu"):
                mode = "gpu"

            # 通过 CUDA_VISIBLE_DEVICES 控制子进程是否能看到 GPU
            # 注意：MSS 仓库本身不识别 MSS_FORCE_CPU，我们仅用它做日志标记
            old_cuda_visible = os.environ.get("CUDA_VISIBLE_DEVICES")
            try:
                if mode == "cpu":
                    os.environ["MSS_FORCE_CPU"] = "true"
                    os.environ["CUDA_VISIBLE_DEVICES"] = ""
                    print_progress_text(
                        f"[任务 {task_id}] 运行模式: CPU（CUDA_VISIBLE_DEVICES 置空，MSS_FORCE_CPU=true）"
                    )
                else:
                    os.environ["MSS_FORCE_CPU"] = "false"
                    # 在 GPU 模式下暂不强制修改 CUDA_VISIBLE_DEVICES，保持外部环境配置；
                    # 真正的恢复逻辑在 finally 中处理（把值还原为本任务前的状态）。
                    print_progress_text(
                        f"[任务 {task_id}] 运行模式: GPU（MSS_FORCE_CPU=false）"
                    )

                print_progress_text(f"[任务 {task_id}] 初始化分离引擎...")
                engine = build_separation_engine_from_env()
                engine_type = type(engine).__name__
                print_progress_text(f"[任务 {task_id}] 引擎类型: {engine_type}")

                # 结果目录（与 tasks.py 保持一致）。旧版本写死 /app，
                # 在 Windows 或非 Docker 部署会直接触发 PermissionError。
                configured_results = Path(os.getenv("RESULTS_DIR", str(Path(__file__).resolve().parents[1] / "results")))
                if not configured_results.is_absolute():
                    configured_results = Path(__file__).resolve().parents[1] / configured_results
                results_dir = configured_results / str(task_id)
                
                print_progress_text(f"[任务 {task_id}] 开始执行分离...")
                result = await engine.separate(
                    input_path=Path(file_path), algorithm=algorithm, results_dir=results_dir, task_id=task_id, gpu_id=gpu_id
                )
            finally:
                # 恢复 CUDA_VISIBLE_DEVICES，避免影响后续任务/其他代码
                if old_cuda_visible is None:
                    os.environ.pop("CUDA_VISIBLE_DEVICES", None)
                else:
                    os.environ["CUDA_VISIBLE_DEVICES"] = old_cuda_visible

            # 再次刷新任务，避免覆盖可能在分离过程中被设置的"用户取消"状态
            await session.refresh(task)
            if task.status == TaskStatus.CANCELLED:
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

            # 若属于「批量分离」，尝试在全部子任务完成后自动编排盲化样本/客观指标/实验批次
            await maybe_finalize_batch(task_id)
        except Exception as e:
            # 区分"用户主动取消"与真实错误，避免把取消当成异常噪音
            msg = f"{type(e).__name__}: {str(e)}"
            task_for_check = await session.get(SeparationTask, task_id)
            is_user_cancel = "CANCELLED_BY_USER" in str(e) or (
                task_for_check is not None
                and task_for_check.status == TaskStatus.CANCELLED
            )

            if is_user_cancel:
                # 已经由 /cancel 接口把状态改成 FAILED + "任务已被用户取消"
                logger.info("任务 %s 已被用户取消(MSS 进程提前退出)。", task_id)
                print_progress_text(f"[任务 {task_id}] 已根据用户请求取消分离。")
            else:
                # 记录详细错误信息
                error_msg = f"任务 {task_id} 处理失败: {msg}"
                logger.error(error_msg, exc_info=True)
                print_progress_text(f"[任务 {task_id}] ✗ 分离失败: {msg}")

                # 更新任务状态为失败（若未被标记为"用户取消"）
                task = await session.get(SeparationTask, task_id)
                if task:
                    await session.refresh(task)
                    if task.status != TaskStatus.CANCELLED:
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
