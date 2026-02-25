from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional
import subprocess
import tempfile

import numpy as np
import soundfile as sf


@dataclass(frozen=True)
class AudioAnalysis:
    sample_rate: int
    duration_s: float
    waveform: List[float]  # downsampled mono waveform in [-1, 1]
    spectrogram: List[List[float]]  # 2D: [freq_bins][time_bins], normalized to [0, 1]
    bit_depth: Optional[int] = None  # 位深度，如果无法获取则为 None
    # NOTE: dataclass 要求：无默认值字段必须在默认值字段之前
    waveform_min: Optional[List[float]] = None  # envelope min per bucket (optional)
    waveform_max: Optional[List[float]] = None  # envelope max per bucket (optional)
    frequency_response: Optional[List[float]] = None  # 频率响应曲线：每个频率bin的平均幅度（dB），与spectrogram的频率bin对应


def _get_bit_depth_from_subtype(subtype: str) -> Optional[int]:
    """从 soundfile 的 subtype 字符串中提取位深度"""
    if not subtype:
        return None
    subtype_lower = str(subtype).lower()
    # 常见的 subtype 到 bit depth 的映射
    subtype_map = {
        "pcm_8": 8,
        "pcm_16": 16,
        "pcm_24": 24,
        "pcm_32": 32,
        "pcm_s8": 8,
        "pcm_s16": 16,
        "pcm_s24": 24,
        "pcm_s32": 32,
        "pcm_u8": 8,
        "float": 32,  # float32
        "double": 64,  # float64
        "float32": 32,
        "float64": 64,
        "vorbis": None,  # OGG Vorbis 是压缩格式，没有固定位深度
        "mp3": None,  # MP3 是压缩格式
    }
    for key, bits in subtype_map.items():
        if key in subtype_lower:
            return bits
    # 如果都不匹配，尝试从字符串中提取数字（例如 "PCM_24" -> 24）
    import re
    match = re.search(r'(\d+)', subtype_lower)
    if match:
        try:
            return int(match.group(1))
        except ValueError:
            pass
    return None


def _read_audio_any(path: Path) -> tuple[np.ndarray, int, Optional[int]]:
    """
    尽可能可靠地读取音频为 float32 PCM。

    - 优先直接用 soundfile 读取（wav/flac/ogg 等稳定）
    - 若失败（尤其是 mp3 解码缺失），用 ffmpeg 转成临时 wav 再读
    
    返回: (音频数据, 采样率, 位深度)
    """
    bit_depth = None
    try:
        # 先读取文件信息以获取位深度
        try:
            info = sf.info(str(path))
            bit_depth = _get_bit_depth_from_subtype(info.subtype)
        except Exception:
            # 如果获取信息失败，继续读取音频
            pass
        
        y, sr = sf.read(str(path), dtype="float32", always_2d=True)
        return y, int(sr), bit_depth
    except Exception:
        # 兜底：ffmpeg 解码到临时 wav（pcm_s16le），再用 soundfile 读
        with tempfile.TemporaryDirectory(prefix="audiolab_decode_") as td:
            out_wav = Path(td) / "decoded.wav"
            cmd = [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(path),
                "-acodec",
                "pcm_s16le",
                str(out_wav),
            ]
            proc = subprocess.run(cmd, capture_output=True, text=True)
            if proc.returncode != 0 or not out_wav.exists():
                raise RuntimeError(
                    f"ffmpeg decode failed (code={proc.returncode}): {proc.stderr or proc.stdout}"
                )
            y, sr = sf.read(str(out_wav), dtype="float32", always_2d=True)
            # ffmpeg 解码为 pcm_s16le，所以位深度是 16
            return y, int(sr), 16


def _downsample_waveform_envelope(
    y: np.ndarray, points: int = 800
) -> tuple[List[float], List[float], List[float]]:
    """
    生成“更像 DAW”的波形包络数据：
    - waveform_min：每桶最小值
    - waveform_max：每桶最大值
    - waveform：为了向后兼容保留的中线（(min+max)/2）

    说明：
    - 只返回固定点数，保证 payload 体积可控
    - 比“每桶一个点（平均/抽样）”更可靠：瞬态不会被完全抹掉
    """
    if y.size == 0 or points <= 0:
        return [], [], []
    points = int(points)
    if y.size <= points:
        out = np.pad(y, (0, points - y.size), mode="constant").astype(np.float32)
        out = np.clip(out, -1.0, 1.0)
        return out.tolist(), out.tolist(), out.tolist()

    win = int(np.ceil(y.size / points))
    target_size = win * points
    trimmed = (
        np.pad(y, (0, target_size - y.size), mode="constant")
        if target_size > y.size
        else y[:target_size]
    )
    frames = trimmed.reshape(points, win)
    w_max = np.clip(frames.max(axis=1), -1.0, 1.0).astype(np.float32)
    w_min = np.clip(frames.min(axis=1), -1.0, 1.0).astype(np.float32)
    w_mid = np.clip((w_max + w_min) * 0.5, -1.0, 1.0).astype(np.float32)
    return w_mid.tolist(), w_min.tolist(), w_max.tolist()


def _stft_magnitude(y: np.ndarray, *, n_fft: int, hop_length: int) -> np.ndarray:
    # 对很短的音频做 padding，避免直接产出空谱图（前端会全黑）
    if y.size < n_fft:
        pad = n_fft - y.size
        y = np.pad(y, (0, pad), mode="constant")

    window = np.hanning(n_fft).astype(np.float32)
    num_frames = 1 + (y.size - n_fft) // hop_length
    if num_frames <= 0:
        return np.empty((0, 0), dtype=np.float32)

    # frame as [num_frames, n_fft]
    shape = (num_frames, n_fft)
    strides = (y.strides[0] * hop_length, y.strides[0])
    frames = np.lib.stride_tricks.as_strided(y, shape=shape, strides=strides)
    frames = frames * window[None, :]

    spec = np.fft.rfft(frames, n=n_fft, axis=1)
    mag = np.abs(spec).T  # [freq, time]
    return mag.astype(np.float32)


def _downsample_2d(mat: np.ndarray, *, out_f: int, out_t: int) -> np.ndarray:
    if mat.size == 0:
        return np.empty((0, 0), dtype=np.float32)

    f, t = mat.shape
    out_f = max(1, int(out_f))
    out_t = max(1, int(out_t))

    # pool by averaging in bins
    f_edges = np.linspace(0, f, out_f + 1, dtype=np.int32)
    t_edges = np.linspace(0, t, out_t + 1, dtype=np.int32)

    out = np.zeros((out_f, out_t), dtype=np.float32)
    for i in range(out_f):
        f0, f1 = f_edges[i], f_edges[i + 1]
        if f1 <= f0:
            f1 = min(f, f0 + 1)
        for j in range(out_t):
            t0, t1 = t_edges[j], t_edges[j + 1]
            if t1 <= t0:
                t1 = min(t, t0 + 1)
            block = mat[f0:f1, t0:t1]
            out[i, j] = float(block.mean()) if block.size else 0.0
    return out


def _compute_frequency_response(
    mag: np.ndarray, *, sample_rate: int, n_fft: int, freq_bins: int = 256
) -> List[float]:
    """
    计算频率响应曲线：对每个频率bin，计算所有时间帧的平均幅度（dB）。
    
    参数:
        mag: STFT幅度谱 [freq, time]，线性幅度
        sample_rate: 采样率
        n_fft: FFT窗口大小
        freq_bins: 输出的频率bin数量（用于降采样）
    
    返回:
        频率响应曲线（dB值），长度为freq_bins
    """
    if mag.size == 0:
        return []
    
    # 计算每个频率bin在所有时间帧上的平均幅度
    avg_mag = np.mean(mag, axis=1)  # [freq]
    
    # 转换为dB
    avg_mag_db = 20.0 * np.log10(np.maximum(avg_mag, 1e-8))
    
    # 如果需要降采样到指定频率bin数
    if freq_bins > 0 and avg_mag_db.size > freq_bins:
        # 使用线性插值降采样
        original_indices = np.linspace(0, avg_mag_db.size - 1, avg_mag_db.size)
        target_indices = np.linspace(0, avg_mag_db.size - 1, freq_bins)
        avg_mag_db = np.interp(target_indices, original_indices, avg_mag_db)
    elif avg_mag_db.size < freq_bins:
        # 如果原始bin数少于目标，使用插值上采样
        original_indices = np.linspace(0, avg_mag_db.size - 1, avg_mag_db.size)
        target_indices = np.linspace(0, avg_mag_db.size - 1, freq_bins)
        avg_mag_db = np.interp(target_indices, original_indices, avg_mag_db)
    
    return avg_mag_db.astype(np.float32).tolist()


def analyze_audio_file(
    path: Path,
    *,
    waveform_points: int = 800,
    n_fft: int = 2048,
    hop_length: int = 512,
    spec_freq_bins: int = 128,
    spec_time_bins: int = 256,
    max_seconds: float = 60.0,
) -> AudioAnalysis:
    """
    读取音频并生成用于前端可视化的"轻量分析结果"：
    - mono waveform：固定点数
    - magnitude spectrogram：固定频/时分辨率，归一化到 [0, 1]

    只保证对 wav/flac/ogg 等 libsndfile 支持的格式可用；
    mp3 通过 ffmpeg 兜底解码，确保可用（容器内需安装 ffmpeg）。
    """
    y, sr, bit_depth = _read_audio_any(path)
    if y.size == 0:
        return AudioAnalysis(
            sample_rate=0,
            duration_s=0.0,
            waveform=[],
            spectrogram=[],
            bit_depth=bit_depth,
            frequency_response=[],
        )

    # to mono
    mono = y.mean(axis=1)

    # 动态调整 n_fft / hop，避免短音频导致“全黑/全空”
    if mono.size > 0:
        # n_fft 取不超过音频长度的 2 的幂（至少 256）
        max_fft = int(2 ** np.floor(np.log2(max(256, mono.size))))
        n_fft = int(min(n_fft, max_fft))
        hop_length = int(min(hop_length, max(64, n_fft // 4)))

    if max_seconds and sr > 0:
        max_samples = int(max_seconds * sr)
        mono = mono[:max_samples]

    duration_s = float(mono.size / sr) if sr > 0 else 0.0

    waveform, waveform_min, waveform_max = _downsample_waveform_envelope(
        mono, points=waveform_points
    )

    mag = _stft_magnitude(mono, n_fft=n_fft, hop_length=hop_length)  # [freq, time]
    if mag.size == 0:
        return AudioAnalysis(
            sample_rate=int(sr),
            duration_s=duration_s,
            waveform=waveform,
            waveform_min=waveform_min,
            waveform_max=waveform_max,
            spectrogram=[],
            bit_depth=bit_depth,
            frequency_response=[],
        )

    # log compression
    mag_db = 20.0 * np.log10(np.maximum(mag, 1e-8))
    # normalize per-file to [0, 1] for UI color mapping
    lo = float(np.percentile(mag_db, 5))
    hi = float(np.percentile(mag_db, 95))
    denom = (hi - lo) if hi > lo else 1.0
    norm = np.clip((mag_db - lo) / denom, 0.0, 1.0)

    pooled = _downsample_2d(norm, out_f=spec_freq_bins, out_t=spec_time_bins)
    spectrogram: List[List[float]] = pooled.astype(np.float32).tolist()

    # 计算频率响应曲线（使用原始mag，在归一化之前）
    frequency_response = _compute_frequency_response(
        mag, sample_rate=int(sr), n_fft=n_fft, freq_bins=spec_freq_bins
    )

    return AudioAnalysis(
        sample_rate=int(sr),
        duration_s=duration_s,
        waveform=waveform,
        waveform_min=waveform_min,
        waveform_max=waveform_max,
        spectrogram=spectrogram,
        bit_depth=bit_depth,
        frequency_response=frequency_response,
    )


def analysis_to_payload(a: AudioAnalysis) -> Dict[str, Any]:
    return {
        "sample_rate": a.sample_rate,
        "duration_s": a.duration_s,
        "waveform": a.waveform,
        "waveform_min": a.waveform_min,
        "waveform_max": a.waveform_max,
        "spectrogram": a.spectrogram,
        "bit_depth": a.bit_depth,
        "frequency_response": a.frequency_response,
    }

