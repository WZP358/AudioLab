"""
工具函数模块 - 雪花ID生成
"""
import os
import time
import threading

from dotenv import load_dotenv

load_dotenv()


class SnowflakeGenerator:
    """
    雪花算法ID生成器

    64位ID结构：
    - 1位符号位（始终为0）
    - 41位时间戳（毫秒级）
    - 10位机器ID（5位数据中心ID + 5位机器ID）
    - 12位序列号
    """

    def __init__(self, datacenter_id=0, machine_id=0):
        """
        初始化雪花算法生成器

        Args:
            datacenter_id: 数据中心ID (0-31)
            machine_id: 机器ID (0-31)
        """
        # 时间戳、数据中心ID、机器ID、序列号的位数
        self.sequence_bits = 12
        self.machine_bits = 5
        self.datacenter_bits = 5

        # 最大值
        self.max_machine_id = (1 << self.machine_bits) - 1
        self.max_datacenter_id = (1 << self.datacenter_bits) - 1
        self.max_sequence = (1 << self.sequence_bits) - 1

        # 位移
        self.machine_id_shift = self.sequence_bits
        self.datacenter_id_shift = self.sequence_bits + self.machine_bits
        self.timestamp_shift = self.sequence_bits + self.machine_bits + self.datacenter_bits

        # 起始时间戳（2024-01-01 00:00:00）
        self.epoch = 1704067200000

        # 验证参数
        if machine_id > self.max_machine_id or machine_id < 0:
            raise ValueError(f"machine_id must be between 0 and {self.max_machine_id}")
        if datacenter_id > self.max_datacenter_id or datacenter_id < 0:
            raise ValueError(f"datacenter_id must be between 0 and {self.max_datacenter_id}")

        self.datacenter_id = datacenter_id
        self.machine_id = machine_id
        self.sequence = 0
        self.last_timestamp = -1
        self.lock = threading.Lock()

    def _current_timestamp(self):
        """获取当前时间戳（毫秒）"""
        return int(time.time() * 1000)

    def _wait_next_millis(self, last_timestamp):
        """等待下一毫秒"""
        timestamp = self._current_timestamp()
        while timestamp <= last_timestamp:
            timestamp = self._current_timestamp()
        return timestamp

    def generate_id(self):
        """
        生成下一个ID

        Returns:
            int: 64位整数ID
        """
        with self.lock:
            timestamp = self._current_timestamp()

            # 如果当前时间小于上一次ID生成的时间戳，说明系统时钟回退过
            if timestamp < self.last_timestamp:
                raise RuntimeError(
                    f"Clock moved backwards. Refusing to generate id for "
                    f"{self.last_timestamp - timestamp} milliseconds"
                )

            # 如果是同一时间戳生成的，则进行毫秒内序列
            if timestamp == self.last_timestamp:
                self.sequence = (self.sequence + 1) & self.max_sequence
                # 毫秒内序列溢出
                if self.sequence == 0:
                    # 阻塞到下一个毫秒，获得新的时间戳
                    timestamp = self._wait_next_millis(self.last_timestamp)
            else:
                # 时间戳改变，毫秒内序列重置
                self.sequence = 0

            # 上次生成ID的时间戳
            self.last_timestamp = timestamp

            # 移位并通过或运算拼到一起组成64位的ID
            return (
                ((timestamp - self.epoch) << self.timestamp_shift)
                | (self.datacenter_id << self.datacenter_id_shift)
                | (self.machine_id << self.machine_id_shift)
                | self.sequence
            )


_datacenter_id = int(os.getenv("SNOWFLAKE_DATACENTER_ID", "0"))
_machine_id = int(os.getenv("SNOWFLAKE_MACHINE_ID", "0"))

snowflake = SnowflakeGenerator(datacenter_id=_datacenter_id, machine_id=_machine_id)


def generate_id():
    """
    生成下一个雪花算法ID

    Returns:
        int: 64位整数ID
    """
    return snowflake.generate_id()
