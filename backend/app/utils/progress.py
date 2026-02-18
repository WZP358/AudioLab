"""
进度条工具函数，用于在后端控制台输出进度信息
"""
import sys
from typing import Optional


def print_progress_bar(
    current: int,
    total: int,
    prefix: str = "进度",
    suffix: str = "",
    length: int = 50,
    fill: str = "█",
    empty: str = "░",
):
    """
    打印进度条
    
    Args:
        current: 当前进度值
        total: 总进度值
        prefix: 进度条前缀文本
        suffix: 进度条后缀文本
        length: 进度条长度（字符数）
        fill: 填充字符
        empty: 空白字符
    """
    if total == 0:
        percent = 100
        filled_length = length
    else:
        percent = min(100, int(100 * current / total))
        filled_length = int(length * current / total)
    
    bar = fill * filled_length + empty * (length - filled_length)
    
    # 使用 \r 覆盖当前行，\033[K 清除到行尾
    sys.stdout.write(f"\r{prefix} |{bar}| {percent}% {suffix}\033[K")
    sys.stdout.flush()
    
    # 如果完成，换行
    if current >= total:
        sys.stdout.write("\n")
        sys.stdout.flush()


def print_progress_text(message: str, clear_line: bool = False):
    """
    打印进度文本消息
    
    Args:
        message: 要显示的消息
        clear_line: 是否清除当前行（用于更新同一行的内容）
    """
    if clear_line:
        sys.stdout.write(f"\r{message}\033[K")
    else:
        sys.stdout.write(f"{message}\n")
    sys.stdout.flush()
