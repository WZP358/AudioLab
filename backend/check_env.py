#!/usr/bin/env python3
"""
检查环境变量配置的脚本
用于诊断 MSS 引擎配置问题
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# 加载 .env 文件
backend_dir = Path(__file__).resolve().parent
env_path = backend_dir / ".env"

print(f"检查 .env 文件位置: {env_path}")
print(f".env 文件是否存在: {env_path.exists()}")

if env_path.exists():
    print(f"\n加载 .env 文件: {env_path}")
    load_dotenv(dotenv_path=env_path, override=False)
else:
    print(f"\n警告: .env 文件不存在于 {env_path}")
    print("尝试从当前目录加载...")
    load_dotenv(override=False)

print("\n=== 环境变量检查 ===")
print(f"SEPARATION_ENGINE: {os.getenv('SEPARATION_ENGINE', '(未设置)')}")
print(f"MSS_ROOT_DIR: {os.getenv('MSS_ROOT_DIR', '(未设置)')}")
print(f"MSS_MDX23C_CKPT: {os.getenv('MSS_MDX23C_CKPT', '(未设置)')}")

# 检查 MSS_ROOT_DIR 路径
mss_root = os.getenv("MSS_ROOT_DIR")
if mss_root:
    mss_path = Path(mss_root)
    print(f"\n=== MSS 仓库路径检查 ===")
    print(f"路径: {mss_path}")
    print(f"路径是否存在: {mss_path.exists()}")
    if mss_path.exists():
        inference_py = mss_path / "inference.py"
        print(f"inference.py 是否存在: {inference_py.exists()}")
    else:
        print(f"\n错误: MSS 仓库路径不存在！")
        print(f"请检查路径是否正确，或创建该目录。")
else:
    print(f"\n=== 自动推断路径 ===")
    # 尝试自动推断
    here = Path(__file__).resolve()
    project_root = here.parents[1]  # backend 的父目录（AudioLab）
    inferred_path = project_root / "Music-Source-Separation-Training-main"
    print(f"推断的路径: {inferred_path}")
    print(f"推断的路径是否存在: {inferred_path.exists()}")

print("\n=== 建议 ===")
print("1. 确保 .env 文件在 backend 目录下")
print("2. 在 .env 文件中设置 MSS_ROOT_DIR=你的MSS仓库路径")
print("3. 路径使用正斜杠或双反斜杠，例如: D:/code/Music-Source-Separation-Training-main")
print("   或: D:\\\\code\\\\Music-Source-Separation-Training-main")
