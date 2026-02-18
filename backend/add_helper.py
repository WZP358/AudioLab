# -*- coding: utf-8 -*-
"""添加辅助函数"""
with open('app/services/separation_engine.py', 'r', encoding='utf-8') as f:
    content = f.read()

helper = '''

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

if '_run_subprocess_windows' not in content:
    content = content.replace(
        '            asyncio.set_event_loop(asyncio.new_event_loop())\n\n\n@dataclass(frozen=True)',
        '            asyncio.set_event_loop(asyncio.new_event_loop())' + helper + '\n\n@dataclass(frozen=True)'
    )
    with open('app/services/separation_engine.py', 'w', encoding='utf-8') as f:
        f.write(content)
    print('Added helper function')
else:
    print('Helper function already exists')
