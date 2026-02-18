# -*- coding: utf-8 -*-
"""修复重复的代码块"""
with open('app/services/separation_engine.py', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# 找到所有包含 "启动分离进程" 的行
start_indices = [i for i, line in enumerate(lines) if '启动分离进程' in line]
print(f"Found {len(start_indices)} occurrences of '启动分离进程'")

# 检查每个位置
for idx in start_indices:
    # 检查这个位置之后是否有 Windows 检测代码
    next_10_lines = ''.join(lines[idx:idx+10])
    has_windows_check = 'if platform.system()' in next_10_lines
    
    # 检查这个位置之后是否有旧的 create_subprocess_exec（不在 else 分支中）
    has_old_code = 'proc = await asyncio.create_subprocess_exec(' in next_10_lines and not has_windows_check
    
    if has_old_code:
        print(f"Line {idx+1}: Found old code without Windows check, needs replacement")
        # 找到需要替换的代码块结束位置
        end_idx = idx
        while end_idx < len(lines) and 'stderr_text =' not in lines[end_idx]:
            end_idx += 1
        if end_idx < len(lines):
            end_idx += 1
        
        print(f"  Will replace lines {idx+1} to {end_idx}")
        
        # 替换代码
        replacement = [
            '            print_progress_text(f"{task_prefix} 启动分离进程...")\n',
            '\n',
            '            # Windows 上使用同步 subprocess 在线程中运行，其他平台使用异步\n',
            '            if platform.system() == "Windows":\n',
            '                # 在线程中运行同步 subprocess\n',
            '                returncode, stdout_lines, stderr_lines = await asyncio.to_thread(\n',
            '                    _run_subprocess_windows, cmd, task_prefix\n',
            '                )\n',
            '                stdout_text = \'\\n\'.join(stdout_lines)\n',
            '                stderr_text = \'\\n\'.join(stderr_lines)\n',
            '            else:\n',
            '                # Linux/Mac 使用异步 subprocess\n',
            '                proc = await asyncio.create_subprocess_exec(\n',
            '                    *cmd,\n',
            '                    stdout=asyncio.subprocess.PIPE,\n',
            '                    stderr=asyncio.subprocess.STDOUT,  # 合并 stderr 到 stdout\n',
            '                )\n',
            '                \n',
            '                # 实时读取输出并显示进度\n',
            '                stdout_lines = []\n',
            '                stderr_lines = []\n',
            '                last_progress = 0\n',
            '                \n',
            '                async def read_stream(stream, is_stdout=True):\n',
            '                    """实时读取流并解析进度"""\n',
            '                    nonlocal last_progress\n',
            '                    buffer = ""\n',
            '                    while True:\n',
            '                        chunk = await stream.read(1024)\n',
            '                        if not chunk:\n',
            '                            break\n',
            '                        buffer += chunk.decode(errors="ignore")\n',
            '                        lines = buffer.split(\'\\n\')\n',
            '                        buffer = lines[-1]  # 保留不完整的行\n',
            '                        \n',
            '                        for line in lines[:-1]:\n',
            '                            line = line.strip()\n',
            '                            if not line:\n',
            '                                continue\n',
            '                            \n',
            '                            if is_stdout:\n',
            '                                stdout_lines.append(line)\n',
            '                            else:\n',
            '                                stderr_lines.append(line)\n',
            '                            \n',
            '                            # 尝试解析进度信息\n',
            '                            progress_match = re.search(r\'(\\d+)%\', line)\n',
            '                            if progress_match:\n',
            '                                progress = int(progress_match.group(1))\n',
            '                                if progress != last_progress:\n',
            '                                    print_progress_bar(progress, 100, prefix=f"{task_prefix} 分离进度", suffix=line[:50])\n',
            '                                    last_progress = progress\n',
            '                            elif any(keyword in line.lower() for keyword in [\'epoch\', \'batch\', \'step\', \'processing\']):\n',
            '                                print_progress_text(f"{task_prefix} {line[:80]}", clear_line=True)\n',
            '                \n',
            '                # 读取 stdout（stderr 已合并）\n',
            '                await read_stream(proc.stdout, is_stdout=True)\n',
            '                \n',
            '                # 等待进程完成\n',
            '                returncode = await proc.wait()\n',
            '                \n',
            '                stdout_text = \'\\n\'.join(stdout_lines)\n',
            '                stderr_text = \'\\n\'.join(stderr_lines)\n',
        ]
        
        # 替换
        new_lines = lines[:idx] + replacement + lines[end_idx:]
        lines = new_lines
        print(f"  Replaced {end_idx - idx} lines with {len(replacement)} lines")
        break

with open('app/services/separation_engine.py', 'w', encoding='utf-8') as f:
    f.writelines(lines)
print("Fix completed!")
