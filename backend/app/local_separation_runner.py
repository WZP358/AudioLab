"""
本地音频分离脚本入口，用于配合 LocalSeparationEngine 使用你的“本地模型”。

用法（容器 / 本地一致）：

    python backend/app/local_separation_runner.py <input_path> <results_dir> <algorithm_name>

AudioLab 后端会通过 LocalSeparationEngine 调用该脚本，并传入：
    - input_path    ：待分离的音频文件绝对路径
    - results_dir   ：你需要把各个 stem 写入的目录
    - algorithm_name：前端选择的算法名称（来自 app.models.Algorithm 枚举）

你需要在 results_dir 下至少写出下面这些文件（大小 > 0 即可）：
    - Vocals.wav
    - Drums.wav
    - Bass.wav
    - Other.wav

也可以增加更多 stem（例如 Piano.wav、Guitar.wav），前端会自动识别并出现在 Stem Source 下拉框中。
"""

import sys
from pathlib import Path
from typing import Optional

import soundfile as sf  # 已在后端 Dockerfile 中安装（librosa 等依赖一起）
import numpy as np


def run_your_model(
    input_path: Path,
    algorithm_name: str,
) -> dict:
    """
    TODO: 在这里对接你自己的本地分离模型。

    你可以根据自己的情况，把下面的伪代码替换成真实逻辑：

    1. 命令行模型（示例）：
        - 比如你原来是这样用的：
            python my_model_cli.py --input in.wav --out_vocals v.wav --out_drums d.wav ...
        - 那你可以在这里用 subprocess 调用：

            import subprocess
            tmp_dir = input_path.parent / "tmp_stems"
            tmp_dir.mkdir(exist_ok=True)
            cmd = [
                "python",
                "D:/path/to/my_model_cli.py",
                "--input",
                str(input_path),
                "--out_vocals",
                str(tmp_dir / "Vocals.wav"),
                "--out_drums",
                str(tmp_dir / "Drums.wav"),
                "--out_bass",
                str(tmp_dir / "Bass.wav"),
                "--out_other",
                str(tmp_dir / "Other.wav"),
            ]
            subprocess.check_call(cmd)
            # 然后再用 sf.read(...) 读回来成 numpy 数组

    2. Python API 模型（示例）：
        - 比如：
            from my_model import MySeparator
            model = MySeparator("xxx.ckpt")
            stems = model.separate(str(input_path))  # 返回 dict: { "vocals": np.ndarray, ... }

    本函数需要返回一个 dict：
        {
            "Vocals": np.ndarray,  # shape: (n_samples,) 或 (n_samples, n_channels)
            "Drums": np.ndarray,
            "Bass": np.ndarray,
            "Other": np.ndarray,
            # 你还可以加更多 stem
        }
    采样率请与你模型内部保持一致（例如 44100）。
    """
    raise NotImplementedError(
        "请在 local_separation_runner.py 的 run_your_model 中填入你本地模型的推理逻辑。"
    )


def _ensure_mono(audio: np.ndarray) -> np.ndarray:
    """把 (N, C) 转成单声道，避免不必要的 channel 形状问题。"""
    if audio.ndim == 1:
        return audio
    if audio.ndim == 2:
        # 简单平均各声道
        return audio.mean(axis=1)
    raise ValueError(f"不支持的音频形状: {audio.shape}")


def save_stem_wav(
    audio: np.ndarray,
    sample_rate: int,
    out_path: Path,
    subtype: str = "PCM_16",
) -> None:
    """
    把 numpy 数组写成 WAV 文件。

    - audio: np.ndarray, dtype=float32/float64，范围建议在 [-1, 1]
    - sample_rate: 采样率（例如 44100）
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    audio = _ensure_mono(audio)

    # 简单裁剪到 [-1, 1]，再写盘
    audio = np.asarray(audio, dtype=np.float32)
    audio = np.clip(audio, -1.0, 1.0)

    sf.write(out_path, audio, sample_rate, subtype=subtype)


def main(argv: Optional[list] = None) -> int:
    if argv is None:
        argv = sys.argv[1:]

    if len(argv) != 3:
        print(
            "Usage: python local_separation_runner.py <input_path> <results_dir> <algorithm_name>",
            file=sys.stderr,
        )
        return 1

    input_path_str, results_dir_str, algorithm_name = argv

    input_path = Path(input_path_str)
    results_dir = Path(results_dir_str)

    if not input_path.exists():
        print(f"[LocalSeparationRunner] 输入文件不存在: {input_path}", file=sys.stderr)
        return 2

    try:
        # 这里你可以根据 algorithm_name 切换不同模型/配置
        stems = run_your_model(input_path=input_path, algorithm_name=algorithm_name)
    except NotImplementedError as e:
        # 明确提示需要用户自己补充逻辑
        print(str(e), file=sys.stderr)
        return 3
    except Exception as e:
        print(f"[LocalSeparationRunner] 运行本地模型时出错: {type(e).__name__}: {e}", file=sys.stderr)
        return 4

    if not isinstance(stems, dict) or not stems:
        print("[LocalSeparationRunner] 模型未返回任何 stem，stems 为空。", file=sys.stderr)
        return 5

    # 尝试从任意一个 stem 猜采样率（如果你模型返回时就带 sr，可以改写这里）
    # 这里先用最通用的方式：从原始输入文件读 sr
    try:
        _, sr = sf.read(str(input_path), always_2d=False)
        # 注意：sf.read 返回 (data, sample_rate)，但为了兼容旧版 soundfile，
        # 这里采用拆包方式，如果出错可以再调整。
    except Exception:
        # 回退到常见采样率
        sr = 44100

    # 写出所有 stem
    for name, audio in stems.items():
        if not isinstance(name, str):
            print(f"[LocalSeparationRunner] 忽略非字符串 stem 名称: {name}", file=sys.stderr)
            continue

        try:
            audio_arr = np.asarray(audio)
        except Exception as e:
            print(
                f"[LocalSeparationRunner] 将 stem {name} 转成 numpy 数组失败: {type(e).__name__}: {e}",
                file=sys.stderr,
            )
            continue

        if audio_arr.size == 0:
            print(f"[LocalSeparationRunner] stem {name} 为空，已跳过。", file=sys.stderr)
            continue

        out_path = results_dir / f"{name}.wav"
        try:
            save_stem_wav(audio_arr, sr, out_path)
            print(f"[LocalSeparationRunner] 已写出 stem: {out_path}")
        except Exception as e:
            print(
                f"[LocalSeparationRunner] 写入 stem {name} 失败: {type(e).__name__}: {e}",
                file=sys.stderr,
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

