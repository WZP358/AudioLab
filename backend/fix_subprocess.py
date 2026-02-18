#!/usr/bin/env python3
"""修复 Windows 上的 asyncio 子进程问题"""
import re
from pathlib import Path

file_path = Path(__file__).parent / "app" / "services" / "separation_engine.py"
content = file_path.read_text(encoding="utf-8")

# 1. 添加辅助函数
helper_func = '''

# Windows 上运行子进程的辅助函数（同步）
def _run_subprocess_windows(cmd, task_prefix):
    """Windows 上运行子进程的辅助函数（同步）"""
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        universal_newlines=True
    )
    
    stdout_lines = []
    last_progress = 0
    
    # 实时读取输出
    for line in proc.stdout:
        line = line.rstrip()
        if line:
            stdout_lines.append(line)
            
            # 尝试解析进度信息
            progress_match = re.search(r'(\\d+)%', line)
            if progress_match:
                progress = int(progress_match.group(1))
                if progress != last_progress:
                    print_progress_bar(progress, 100, prefix=f"{task_prefix} 分离进度", suffix=line[:50])
                    last_progress = progress
            elif any(keyword in line.lower() for keyword in ['epoch', 'batch', 'step', 'processing']):
                print_progress_text(f"{task_prefix} {line[:80]}", clear_line=True)
    
    returncode = proc.wait()
    return returncode, stdout_lines, []

'''

# 在 asyncio.set_event_loop 之后添加辅助函数
if "_run_subprocess_windows" not in content:
    content = content.replace(
        "            asyncio.set_event_loop(asyncio.new_event_loop())\n\n\n@dataclass(frozen=True)",
        "            asyncio.set_event_loop(asyncio.new_event_loop())" + helper_func + "\n\n@dataclass(frozen=True)"
    )
    print("已添加辅助函数")

# 2. 替换子进程创建代码
old_pattern = r'(\s+print_progress_text\(f"\{task_prefix\} 启动分离进程\.\.\."\)\s+proc = await asyncio\.create_subprocess_exec\(\s+\*cmd,\s+stdout=asyncio\.subprocess\.PIPE,\s+stderr=asyncio\.subprocess\.STDOUT.*?stdout_text = \'\\n\'\.join\(stdout_lines\)\s+stderr_text = \'\\n\'\.join\(stderr_lines\))'

new_code = '''            print_progress_text(f"{task_prefix} 启动分离进程...")

            # Windows 上使用同步 subprocess 在线程中运行，其他平台使用异步
            if platform.system() == "Windows":
                # 在线程中运行同步 subprocess
                returncode, stdout_lines, stderr_lines = await asyncio.to_thread(
                    _run_subprocess_windows, cmd, task_prefix
                )
                stdout_text = '\\n'.join(stdout_lines)
                stderr_text = '\\n'.join(stderr_lines)
            else:
                # Linux/Mac 使用异步 subprocess
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,  # 合并 stderr 到 stdout
                )
                
                # 实时读取输出并显示进度
                stdout_lines = []
                stderr_lines = []
                last_progress = 0
                
                async def read_stream(stream, is_stdout=True):
                    """实时读取流并解析进度"""
                    nonlocal last_progress
                    buffer = ""
                    while True:
                        chunk = await stream.read(1024)
                        if not chunk:
                            break
                        buffer += chunk.decode(errors="ignore")
                        lines = buffer.split('\\n')
                        buffer = lines[-1]  # 保留不完整的行
                        
                        for line in lines[:-1]:
                            line = line.strip()
                            if not line:
                                continue
                            
                            if is_stdout:
                                stdout_lines.append(line)
                            else:
                                stderr_lines.append(line)
                            
                            # 尝试解析进度信息
                            # 常见的进度格式：百分比、进度条、epoch/batch 等
                            progress_match = re.search(r'(\\d+)%', line)
                            if progress_match:
                                progress = int(progress_match.group(1))
                                if progress != last_progress:
                                    print_progress_bar(progress, 100, prefix=f"{task_prefix} 分离进度", suffix=line[:50])
                                    last_progress = progress
                            elif any(keyword in line.lower() for keyword in ['epoch', 'batch', 'step', 'processing']):
                                # 显示关键信息
                                print_progress_text(f"{task_prefix} {line[:80]}", clear_line=True)
                
                # 读取 stdout（stderr 已合并）
                await read_stream(proc.stdout, is_stdout=True)
                
                # 等待进程完成
                returncode = await proc.wait()
                
                stdout_text = '\\n'.join(stdout_lines)
                stderr_text = '\\n'.join(stderr_lines)'''

# 使用简单的字符串替换
if "if platform.system() == \"Windows\":" not in content:
    # 找到需要替换的开始和结束位置
    start_marker = "print_progress_text(f\"{task_prefix} 启动分离进程...\")"
    end_marker = "stderr_text = '\\n'.join(stderr_lines)"
    
    lines = content.split('\n')
    new_lines = []
    i = 0
    replacing = False
    indent_level = 0
    
    while i < len(lines):
        line = lines[i]
        
        if start_marker in line and not replacing:
            # 开始替换
            replacing = True
            indent_level = len(line) - len(line.lstrip())
            new_lines.append(line)  # 保留 print_progress_text 行
            new_lines.append('')
            # 添加新的代码
            new_lines.append(' ' * indent_level + '# Windows 上使用同步 subprocess 在线程中运行，其他平台使用异步')
            new_lines.append(' ' * indent_level + 'if platform.system() == "Windows":')
            new_lines.append(' ' * (indent_level + 4) + '# 在线程中运行同步 subprocess')
            new_lines.append(' ' * (indent_level + 4) + 'returncode, stdout_lines, stderr_lines = await asyncio.to_thread(')
            new_lines.append(' ' * (indent_level + 8) + '_run_subprocess_windows, cmd, task_prefix')
            new_lines.append(' ' * (indent_level + 4) + ')')
            new_lines.append(' ' * (indent_level + 4) + 'stdout_text = \'\\n\'.join(stdout_lines)')
            new_lines.append(' ' * (indent_level + 4) + 'stderr_text = \'\\n\'.join(stderr_lines)')
            new_lines.append(' ' * indent_level + 'else:')
            new_lines.append(' ' * (indent_level + 4) + '# Linux/Mac 使用异步 subprocess')
            new_lines.append(' ' * (indent_level + 4) + 'proc = await asyncio.create_subprocess_exec(')
            new_lines.append(' ' * (indent_level + 8) + '*cmd,')
            new_lines.append(' ' * (indent_level + 8) + 'stdout=asyncio.subprocess.PIPE,')
            new_lines.append(' ' * (indent_level + 8) + 'stderr=asyncio.subprocess.STDOUT,  # 合并 stderr 到 stdout')
            new_lines.append(' ' * (indent_level + 4) + ')')
            new_lines.append('')
            new_lines.append(' ' * (indent_level + 4) + '# 实时读取输出并显示进度')
            new_lines.append(' ' * (indent_level + 4) + 'stdout_lines = []')
            new_lines.append(' ' * (indent_level + 4) + 'stderr_lines = []')
            new_lines.append(' ' * (indent_level + 4) + 'last_progress = 0')
            new_lines.append('')
            new_lines.append(' ' * (indent_level + 4) + 'async def read_stream(stream, is_stdout=True):')
            new_lines.append(' ' * (indent_level + 8) + '"""实时读取流并解析进度"""')
            new_lines.append(' ' * (indent_level + 8) + 'nonlocal last_progress')
            new_lines.append(' ' * (indent_level + 8) + 'buffer = ""')
            new_lines.append(' ' * (indent_level + 8) + 'while True:')
            new_lines.append(' ' * (indent_level + 12) + 'chunk = await stream.read(1024)')
            new_lines.append(' ' * (indent_level + 12) + 'if not chunk:')
            new_lines.append(' ' * (indent_level + 16) + 'break')
            new_lines.append(' ' * (indent_level + 12) + 'buffer += chunk.decode(errors="ignore")')
            new_lines.append(' ' * (indent_level + 12) + 'lines = buffer.split(\'\\n\')')
            new_lines.append(' ' * (indent_level + 12) + 'buffer = lines[-1]  # 保留不完整的行')
            new_lines.append('')
            new_lines.append(' ' * (indent_level + 12) + 'for line in lines[:-1]:')
            new_lines.append(' ' * (indent_level + 16) + 'line = line.strip()')
            new_lines.append(' ' * (indent_level + 16) + 'if not line:')
            new_lines.append(' ' * (indent_level + 20) + 'continue')
            new_lines.append('')
            new_lines.append(' ' * (indent_level + 16) + 'if is_stdout:')
            new_lines.append(' ' * (indent_level + 20) + 'stdout_lines.append(line)')
            new_lines.append(' ' * (indent_level + 16) + 'else:')
            new_lines.append(' ' * (indent_level + 20) + 'stderr_lines.append(line)')
            new_lines.append('')
            new_lines.append(' ' * (indent_level + 16) + '# 尝试解析进度信息')
            new_lines.append(' ' * (indent_level + 16) + 'progress_match = re.search(r\'(\\d+)%\', line)')
            new_lines.append(' ' * (indent_level + 16) + 'if progress_match:')
            new_lines.append(' ' * (indent_level + 20) + 'progress = int(progress_match.group(1))')
            new_lines.append(' ' * (indent_level + 20) + 'if progress != last_progress:')
            new_lines.append(' ' * (indent_level + 24) + 'print_progress_bar(progress, 100, prefix=f"{task_prefix} 分离进度", suffix=line[:50])')
            new_lines.append(' ' * (indent_level + 24) + 'last_progress = progress')
            new_lines.append(' ' * (indent_level + 16) + 'elif any(keyword in line.lower() for keyword in [\'epoch\', \'batch\', \'step\', \'processing\']):')
            new_lines.append(' ' * (indent_level + 20) + '# 显示关键信息')
            new_lines.append(' ' * (indent_level + 20) + 'print_progress_text(f"{task_prefix} {line[:80]}", clear_line=True)')
            new_lines.append('')
            new_lines.append(' ' * (indent_level + 4) + '# 读取 stdout（stderr 已合并）')
            new_lines.append(' ' * (indent_level + 4) + 'await read_stream(proc.stdout, is_stdout=True)')
            new_lines.append('')
            new_lines.append(' ' * (indent_level + 4) + '# 等待进程完成')
            new_lines.append(' ' * (indent_level + 4) + 'returncode = await proc.wait()')
            new_lines.append('')
            new_lines.append(' ' * (indent_level + 4) + 'stdout_text = \'\\n\'.join(stdout_lines)')
            new_lines.append(' ' * (indent_level + 4) + 'stderr_text = \'\\n\'.join(stderr_lines)')
            
            # 跳过旧代码直到 end_marker
            while i < len(lines) and end_marker not in lines[i]:
                i += 1
            # 跳过 end_marker 这一行
            i += 1
            replacing = False
            continue
        elif not replacing:
            new_lines.append(line)
        
        i += 1
    
    content = '\n'.join(new_lines)
    print("已替换子进程创建代码")

file_path.write_text(content, encoding="utf-8")
print("修复完成！")
