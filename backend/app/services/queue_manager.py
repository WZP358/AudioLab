"""
任务队列管理器
用于管理音频分离任务的排队和处理。支持多卡并发：默认启动 N 个 worker（N=显卡数），
每个 worker 固定绑定一张 GPU，通过 process_separation 的 gpu_id 把 CUDA_VISIBLE_DEVICES
传给分离子进程，从而同时吃满多张 GPU。
"""
import asyncio
import logging
import os
from typing import Optional, Dict
from collections import deque
from app.models import SeparationTask, TaskStatus
from app.database import AsyncSessionLocal
from app.services.separation_service import process_separation

logger = logging.getLogger(__name__)


class TaskQueueManager:
    """任务队列管理器（单例模式，进程内多 worker 并发）"""

    _instance: Optional['TaskQueueManager'] = None
    _lock = asyncio.Lock()

    def __init__(self):
        self.queue: deque = deque()
        self.processing_ids: set = set()
        self._task_lock = asyncio.Lock()
        self.num_gpus = self._env_int("GPU_COUNT", 2)
        self.num_workers = self._env_int("SEPARATION_WORKERS", self.num_gpus)

    @staticmethod
    def _env_int(name: str, default: int) -> int:
        try:
            return max(1, int(os.getenv(name, str(default))))
        except (TypeError, ValueError):
            return default

    @classmethod
    async def get_instance(cls) -> 'TaskQueueManager':
        if cls._instance is None:
            async with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
                    asyncio.create_task(cls._instance._restore_pending_tasks())
                    for i in range(cls._instance.num_workers):
                        asyncio.create_task(cls._instance._worker_loop(i))
                    logger.info(
                        "任务队列已启动 %d 个 worker，共 %d 张 GPU",
                        cls._instance.num_workers,
                        cls._instance.num_gpus,
                    )
        return cls._instance

    async def _restore_pending_tasks(self):
        """Rebuild the in-memory queue after an application restart."""
        try:
            async with AsyncSessionLocal() as session:
                from sqlalchemy import select
                result = await session.execute(select(SeparationTask).where(SeparationTask.status == TaskStatus.PENDING))
                for task in result.scalars().all():
                    if task.file_path and os.path.exists(task.file_path):
                        await self.add_task(task.id, task.file_path, task.algorithm)
        except Exception:
            logger.exception("恢复待处理任务队列失败")

    async def add_task(self, task_id: int, file_path: str, algorithm):
        async with self._task_lock:
            if any(t['task_id'] == task_id for t in self.queue) or task_id in self.processing_ids:
                logger.warning(f"任务 {task_id} 已在队列/处理中，跳过重复添加")
                return
            self.queue.append({
                'task_id': task_id,
                'file_path': file_path,
                'algorithm': algorithm,
            })
            logger.info(f"任务 {task_id} 已加入队列，当前队列长度: {len(self.queue)}")

    async def get_queue_position(self, task_id: int) -> Optional[Dict]:
        async with self._task_lock:
            if task_id in self.processing_ids:
                return {
                    'position': 0,
                    'queue_length': len(self.queue) + len(self.processing_ids),
                    'is_processing': True,
                }
            for idx, task in enumerate(self.queue):
                if task['task_id'] == task_id:
                    return {
                        'position': idx + 1,
                        'queue_length': len(self.queue) + len(self.processing_ids),
                        'is_processing': False,
                    }
            return None

    async def remove_task(self, task_id: int):
        async with self._task_lock:
            if task_id in self.processing_ids:
                logger.info(f"任务 {task_id} 正在处理中，无法从队列移除，但已标记为取消")
                return
            self.queue = deque([t for t in self.queue if t['task_id'] != task_id])
            logger.info(f"任务 {task_id} 已从队列中移除")

    async def _worker_loop(self, worker_index: int):
        gpu_id = worker_index % self.num_gpus
        logger.info(f"分离 worker {worker_index} 已启动，绑定 GPU {gpu_id}")
        while True:
            task = None
            try:
                async with self._task_lock:
                    if self.queue:
                        task = self.queue.popleft()
                        self.processing_ids.add(task['task_id'])
                if task is None:
                    await asyncio.sleep(1)
                    continue

                logger.info(f"worker {worker_index} (GPU {gpu_id}) 开始处理任务 {task['task_id']}")

                async with AsyncSessionLocal() as session:
                    db_task = await session.get(SeparationTask, task['task_id'])
                    if db_task and db_task.status == TaskStatus.CANCELLED:
                        logger.info(f"任务 {task['task_id']} 已被取消，跳过处理")
                        async with self._task_lock:
                            self.processing_ids.discard(task['task_id'])
                        continue

                try:
                    await process_separation(
                        task['task_id'],
                        task['file_path'],
                        task['algorithm'],
                        gpu_id=gpu_id,
                    )
                except Exception as e:
                    logger.error(f"处理任务 {task['task_id']} 时发生错误: {e}", exc_info=True)
                finally:
                    async with self._task_lock:
                        self.processing_ids.discard(task['task_id'])
                    logger.info(f"任务 {task['task_id']} 处理完成")

                await asyncio.sleep(0.5)
            except Exception as e:
                logger.error(f"worker {worker_index} 发生错误: {e}", exc_info=True)
                if task is not None:
                    async with self._task_lock:
                        self.processing_ids.discard(task['task_id'])
                await asyncio.sleep(5)
