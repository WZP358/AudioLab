import logging
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Tuple

import numpy as np
import soundfile as sf

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ObjectiveMetrics:
    sdr: float
    sir: float
    sar: float


def _ffmpeg_to_wav_mono_44k(input_path: Path, out_wav_path: Path) -> None:
    """
    统一用 ffmpeg 将输入音频转为：mono, 44.1kHz, pcm_s16le WAV
    这样后续用 soundfile 读取时更稳定（尤其是 mp3 等格式）。
    """
    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(input_path),
        "-ac",
        "1",
        "-ar",
        "44100",
        "-acodec",
        "pcm_s16le",
        str(out_wav_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0 or not out_wav_path.exists() or out_wav_path.stat().st_size == 0:
        raise RuntimeError(f"ffmpeg 转码失败: {input_path} -> {out_wav_path}: {proc.stderr[:200]}")


def _load_mono_44k(path: Path) -> np.ndarray:
    """
    返回 float32 mono waveform，范围约 [-1, 1]。
    """
    with tempfile.TemporaryDirectory(prefix="audiolab_metrics_") as td:
        wav_path = Path(td) / "a.wav"
        _ffmpeg_to_wav_mono_44k(path, wav_path)
        x, sr = sf.read(str(wav_path), dtype="float32", always_2d=False)
        if sr != 44100:
            # 理论上不应发生（已强制 -ar 44100），这里兜底
            logger.warning("转码后采样率异常: %s sr=%s", path, sr)
        if x.ndim != 1:
            # 兜底：如果仍是多通道，取均值
            x = np.mean(x, axis=-1)
        return x.astype(np.float32, copy=False)


def _trim_to_min_len(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    n = int(min(a.shape[0], b.shape[0], c.shape[0]))
    if n <= 0:
        raise ValueError("音频长度为 0，无法计算客观指标")
    return a[:n], b[:n], c[:n]


def compute_bss_metrics_two_source(
    *,
    mixture_path: Path,
    estimate_path: Path,
    reference_target_path: Path,
    eps: float = 1e-12,
) -> ObjectiveMetrics:
    """
    在“目标源 + 其余源（干扰）”的两源假设下计算 BSS Eval 风格的 SDR/SIR/SAR。

    需要：
    - mixture：混合音 x
    - reference_target：目标源真值 s
    - estimate：算法输出 y（对目标 stem 的估计）

    干扰真值近似为 n = x - s（线性混音假设）。
    """
    mix = _load_mono_44k(mixture_path)
    est = _load_mono_44k(estimate_path)
    ref = _load_mono_44k(reference_target_path)

    mix, est, ref = _trim_to_min_len(mix, est, ref)

    # 简单去直流偏置，减少数值偏差
    mix = mix - float(np.mean(mix))
    est = est - float(np.mean(est))
    ref = ref - float(np.mean(ref))

    # 干扰参考：n = mixture - ref_target
    interf = mix - ref

    # 最小二乘投影：est ≈ a*ref + b*interf
    A = np.stack([ref, interf], axis=1)  # (N,2)
    coef, *_ = np.linalg.lstsq(A, est, rcond=None)
    a = float(coef[0])
    b = float(coef[1])

    s_target = a * ref
    e_interf = b * interf
    e_artif = est - s_target - e_interf

    p_target = float(np.sum(s_target**2) + eps)
    p_interf = float(np.sum(e_interf**2) + eps)
    p_artif = float(np.sum(e_artif**2) + eps)

    sdr = 10.0 * float(np.log10(p_target / (p_interf + p_artif)))
    sir = 10.0 * float(np.log10(p_target / p_interf))
    sar = 10.0 * float(np.log10((p_target + p_interf) / p_artif))

    return ObjectiveMetrics(sdr=sdr, sir=sir, sar=sar)

