"""
临时修复脚本：修复 Windows 上的 asyncio 子进程问题
运行此脚本会自动修复 separation_engine.py
"""
import re
from pathlib import Path

file_path = Path(__file__).parent / "app" / "services" / "separation_engine.py"
content = file_path.read_text(encoding="utf-8")

# 在 logger 定义后添加辅助函数
if "_run_subprocess_windows" not in content:
    helper_func = '''
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
            progress_match = re.search(r'(\d+)%', line)
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
    
    # 在 logger 定义后插入
    content = content.replace(
        "logger = logging.getLogger(__name__)\n",
        f"logger = logging.getLogger(__name__)\n{helper_func}\n"
    )

# 替换 create_subprocess_exec 调用
old_pattern = r'(\s+print_progress_text\(f"\{task_prefix\} 启动分离进程\.\.\."\)\s+proc = await asyncio\.create_subprocess_exec\(\s+\*cmd,\s+stdout=asyncio\.subprocess\.PIPE,\s+stderr=asyncio\.subprocess\.STDOUT,.*?returncode = await proc\.wait\(\)\s+stdout_text = \'\\n\'\.join\(stdout_lines\)\s+stderr_text = \'\\n\'\.join\(stderr_lines\))'

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
                    stderr=asyncio.subprocess.STDOUT,
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
                        buffer = lines[-1]
                        
                        for line in lines[:-1]:
                            line = line.strip()
                            if not line:
                                continue
                            
                            if is_stdout:
                                stdout_lines.append(line)
                            else:
                                stderr_lines.append(line)
                            
                            progress_match = re.search(r'(\\d+)%', line)
                            if progress_match:
                                progress = int(progress_match.group(1))
                                if progress != last_progress:
                                    print_progress_bar(progress, 100, prefix=f"{task_prefix} 分离进度", suffix=line[:50])
                                    last_progress = progress
                            elif any(keyword in line.lower() for keyword in ['epoch', 'batch', 'step', 'processing']):
                                print_progress_text(f"{task_prefix} {line[:80]}", clear_line=True)
                
                await read_stream(proc.stdout, is_stdout=True)
                returncode = await proc.wait()
                stdout_text = '\\n'.join(stdout_lines)
                stderr_text = '\\n'.join(stderr_lines)'''

# 使用更简单的替换
if "if platform.system() == \"Windows\":" not in content:
    # 找到并替换
    lines = content.split('\n')
    new_lines = []
    i = 0
    while i < len(lines):
        if 'proc = await asyncio.create_subprocess_exec(' in lines[i] and 'print_progress_text(f"{task_prefix} 启动分离进程...")' in '\n'.join(lines[max(0, i-5):i]):
            # 找到需要替换的块
            start_idx = i - 1  # print_progress_text 那一行
            # 找到 returncode = await proc.wait() 之后
            end_idx = i
            while end_idx < len(lines) and 'returncode = await proc.wait()' not in lines[end_idx]:
                end_idx += 1
            end_idx += 2  # 包括 stdout_text 和 stderr_text 行
            
            # 替换
            indent = len(lines[start_idx]) - len(lines[start_idx].lstrip())
            new_lines.append(lines[start_idx])  # 保留 print_progress_text
            new_lines.append('')
            new_lines.append(' ' * indent + '# Windows 上使用同步 subprocess 在线程中运行，其他平台使用异步')
            new_lines.append(' ' * indent + 'if platform.system() == "Windows":')
            new_lines.append(' ' * (indent + 4) + '# 在线程中运行同步 subprocess')
            new_lines.append(' ' * (indent + 4) + 'returncode, stdout_lines, stderr_lines = await asyncio.to_thread(')
            new_lines.append(' ' * (indent + 8) + '_run_subprocess_windows, cmd, task_prefix')
            new_lines.append(' ' * (indent + 4) + ')')
            new_lines.append(' ' * (indent + 4) + 'stdout_text = \'\\n\'.join(stdout_lines)')
            new_lines.append(' ' * (indent + 4) + 'stderr_text = \'\\n\'.join(stderr_lines)')
            new_lines.append(' ' * indent + 'else:')
            new_lines.append(' ' * (indent + 4) + '# Linux/Mac 使用异步 subprocess')
            # 保留原有的异步代码，但需要调整缩进
            for j in range(start_idx + 1, end_idx):
                if lines[j].strip():
                    new_lines.append(' ' * (indent + 4) + lines[j].lstrip())
                else:
                    new_lines.append('')
            i = end_idx
        else:
            new_lines.append(lines[i])
            i += 1
    
    content = '\n'.join(new_lines)

file_path.write_text(content, encoding="utf-8")
print("修复完成！")
