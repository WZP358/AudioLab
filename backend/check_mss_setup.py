#!/usr/bin/env python3
"""
检查 MSS 仓库设置的脚本
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# 加载 .env 文件
backend_dir = Path(__file__).resolve().parent
env_path = backend_dir / ".env"
if env_path.exists():
    load_dotenv(dotenv_path=env_path)

mss_root = os.getenv("MSS_ROOT_DIR")
if not mss_root:
    # 尝试自动推断
    here = Path(__file__).resolve()
    project_root = here.parents[1]  # backend 的父目录（AudioLab）
    mss_root = str(project_root / "Music-Source-Separation-Training-main")

mss_path = Path(mss_root)
print(f"MSS 仓库路径: {mss_path}")
print(f"路径是否存在: {mss_path.exists()}")

if mss_path.exists():
    # 检查目录内容
    try:
        contents = list(mss_path.iterdir())
        print(f"目录包含 {len(contents)} 个项目")
        if contents:
            print("前10个项目:")
            for item in contents[:10]:
                print(f"  - {item.name} ({'目录' if item.is_dir() else '文件'})")
    except Exception as e:
        print(f"无法读取目录内容: {e}")
    
    # 检查 inference.py
    inference_py = mss_path / "inference.py"
    print(f"\ninference.py 是否存在: {inference_py.exists()}")
    
    if not inference_py.exists():
        # 尝试在其他位置查找
        print("\n在其他位置查找 inference.py...")
        possible_locations = [
            mss_path / "inference.py",
            mss_path / "scripts" / "inference.py",
            mss_path / "src" / "inference.py",
            mss_path / "music_source_separation" / "inference.py",
        ]
        for loc in possible_locations:
            if loc.exists():
                print(f"  ✓ 找到: {loc}")
        
        # 递归查找
        try:
            found = list(mss_path.rglob("inference.py"))
            if found:
                print(f"\n递归查找找到 {len(found)} 个 inference.py:")
                for f in found[:5]:
                    print(f"  - {f}")
        except:
            pass
        
        print("\n=== 解决方案 ===")
        print("1. 下载/克隆完整的 Music-Source-Separation-Training 仓库:")
        print(f"   git clone https://github.com/ZFTurbo/Music-Source-Separation-Training.git {mss_path}")
        print("\n2. 或者如果仓库在其他位置，更新 .env 文件中的 MSS_ROOT_DIR")
        print("\n3. 确保仓库根目录包含 inference.py 文件")
else:
    print("\n=== 解决方案 ===")
    print(f"目录不存在，请创建并下载仓库:")
    print(f"   mkdir {mss_path.parent}")
    print(f"   git clone https://github.com/ZFTurbo/Music-Source-Separation-Training.git {mss_path}")
