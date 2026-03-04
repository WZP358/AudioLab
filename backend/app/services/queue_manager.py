"""
任务队列管理器
用于管理音频分离任务的排队和处理，防止并发任务过多导致系统崩溃
"""
import asyncio
import logging
from typing import Optional, Dict
from collections import deque
from app.models import SeparationTask, TaskStatus
from app.database import AsyncSessionLocal
from app.services.separation_service import process_separation

logger = logging.getLogger(__name__)


class TaskQueueManager:
    """任务队列管理器（单例模式）"""
    
    _instance: Optional['TaskQueueManager'] = None
    _lock = asyncio.Lock()
    
    def __init__(self):
        self.queue: deque = deque()  # 任务队列
        self.processing: Optional[int] = None  # 当前正在处理的任务ID
        self.is_processing = False  # 是否正在处理任务
        self._task_lock = asyncio.Lock()  # 队列操作锁
        
    @classmethod
    async def get_instance(cls) -> 'TaskQueueManager':
        """获取单例实例"""
        if cls._instance is None:
            async with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
                    # 启动队列处理器
                    asyncio.create_task(cls._instance._process_queue())
        return cls._instance
    
    async def add_task(self, task_id: int, file_path: str, algorithm):
        """将任务添加到队列"""
        async with self._task_lock:
            # 检查任务是否已在队列中
            if any(t['task_id'] == task_id for t in self.queue):
                logger.warning(f"任务 {task_id} 已在队列中，跳过重复添加")
                return
            
            self.queue.append({
                'task_id': task_id,
                'file_path': file_path,
                'algorithm': algorithm,
            })
            logger.info(f"任务 {task_id} 已加入队列，当前队列长度: {len(self.queue)}")
    
    async def get_queue_position(self, task_id: int) -> Optional[Dict]:
        """
        获取任务在队列中的位置信息
        返回: {
            'position': 位置（从1开始，0表示正在处理）,
            'queue_length': 队列总长度（包括正在处理的任务）,
            'is_processing': 是否正在处理
        }
        """
        async with self._task_lock:
            # 如果正在处理该任务
            if self.processing == task_id:
                return {
                    'position': 0,
                    'queue_length': len(self.queue) + 1,  # 包括正在处理的任务
                    'is_processing': True,
                }
            
            # 查找任务在队列中的位置
            position = None
            for idx, task in enumerate(self.queue):
                if task['task_id'] == task_id:
                    position = idx + 1  # 位置从1开始
                    break
            
            if position is None:
                # 任务不在队列中，可能已完成或失败
                return None
            
            return {
                'position': position,
                'queue_length': len(self.queue) + (1 if self.processing else 0),
                'is_processing': False,
            }
    
    async def remove_task(self, task_id: int):
        """从队列中移除任务（用于取消任务）"""
        async with self._task_lock:
            # 如果正在处理该任务，标记为取消
            if self.processing == task_id:
                logger.info(f"任务 {task_id} 正在处理中，无法从队列移除，但已标记为取消")
                return
            
            # 从队列中移除
            self.queue = deque([t for t in self.queue if t['task_id'] != task_id])
            logger.info(f"任务 {task_id} 已从队列中移除")
    
    async def _process_queue(self):
        """队列处理器：按顺序处理队列中的任务"""
        logger.info("任务队列处理器已启动")
        
        while True:
            try:
                # 等待队列中有任务
                while len(self.queue) == 0 or self.is_processing:
                    await asyncio.sleep(1)
                
                # 从队列中取出任务
                async with self._task_lock:
                    if len(self.queue) == 0 or self.is_processing:
                        continue
                    
                    task = self.queue.popleft()
                    self.processing = task['task_id']
                    self.is_processing = True
                
                logger.info(f"开始处理任务 {task['task_id']}，队列中剩余 {len(self.queue)} 个任务")
                
                # 检查任务状态，如果已被取消则跳过
                async with AsyncSessionLocal() as session:
                    db_task = await session.get(SeparationTask, task['task_id'])
                    if db_task and db_task.status == TaskStatus.FAILED and (
                        (db_task.comment or "").startswith("任务已被用户取消")
                    ):
                        logger.info(f"任务 {task['task_id']} 已被取消，跳过处理")
                        async with self._task_lock:
                            self.processing = None
                            self.is_processing = False
                        continue
                
                # 处理任务
                try:
                    await process_separation(
                        task['task_id'],
                        task['file_path'],
                        task['algorithm']
                    )
                except Exception as e:
                    logger.error(f"处理任务 {task['task_id']} 时发生错误: {e}", exc_info=True)
                finally:
                    # 标记任务处理完成
                    async with self._task_lock:
                        self.processing = None
                        self.is_processing = False
                    
                    logger.info(f"任务 {task['task_id']} 处理完成")
                
                # 短暂延迟，避免连续处理导致系统负载过高
                await asyncio.sleep(0.5)
                
            except Exception as e:
                logger.error(f"队列处理器发生错误: {e}", exc_info=True)
                await asyncio.sleep(5)  # 发生错误时等待更长时间再重试
