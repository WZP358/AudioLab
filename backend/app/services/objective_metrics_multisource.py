"""
多源分离客观指标计算模块

基于 BSS Eval v3 标准（Vincent et al., 2006），实现完整的源分离评估指标。
参考文献：
Vincent, E., Gribonval, R., & Févotte, C. (2006).
"Performance measurement in blind audio source separation."
IEEE Transactions on Audio, Speech, and Language Processing, 14(4), 1462-1469.

公式说明：
估计信号分解为：ŝ = s + e_spat + e_interf + e_artif
其中：
- s: 目标源的真实成分
- e_spat: 空间失真（单声道下为0）
- e_interf: 其他源的干扰
- e_artif: 算法引入的伪影
"""
import logging
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Dict

import numpy as np
import soundfile as sf

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class MultiSourceMetrics:
    """多源分离指标结果"""
    metrics_by_source: Dict[str, Dict[str, float]]  # {source_name: {sdr, sir, sar, isr}}

    def get_average_sdr(self) -> float:
        """计算所有源的平均 SDR"""
        sdrs = [m["sdr"] for m in self.metrics_by_source.values()]
        return float(np.mean(sdrs)) if sdrs else 0.0

    def get_average_sir(self) -> float:
        """计算所有源的平均 SIR"""
        sirs = [m["sir"] for m in self.metrics_by_source.values()]
        return float(np.mean(sirs)) if sirs else 0.0

    def get_average_sar(self) -> float:
        """计算所有源的平均 SAR"""
        sars = [m["sar"] for m in self.metrics_by_source.values()]
        return float(np.mean(sars)) if sars else 0.0

    def get_average_si_sdr(self) -> float:
        """计算所有源的平均 SI-SDR"""
        vals = [m["si_sdr"] for m in self.metrics_by_source.values() if "si_sdr" in m]
        return float(np.mean(vals)) if vals else 0.0


def _load_audio_mono_44k(path: Path) -> np.ndarray:
    """
    加载音频为 mono 44.1kHz float32

    使用 ffmpeg 统一转换格式，确保兼容性
    """
    with tempfile.TemporaryDirectory(prefix="audiolab_multisource_") as td:
        wav_path = Path(td) / "temp.wav"
        cmd = [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(path),
            "-ac", "1", "-ar", "44100", "-acodec", "pcm_s16le",
            str(wav_path)
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg 转码失败: {path} -> {proc.stderr[:200]}")

        x, sr = sf.read(str(wav_path), dtype="float32", always_2d=False)
        if sr != 44100:
            logger.warning("转码后采样率异常: %s sr=%s", path, sr)
        if x.ndim != 1:
            x = np.mean(x, axis=-1)
        return x.astype(np.float32)


def _projection_operator(signal: np.ndarray, reference: np.ndarray, eps: float = 1e-12) -> np.ndarray:
    """
    投影算子 Π{ref}(signal)：将 signal 投影到 reference 张成的子空间

    对于单个参考向量：P_ref(signal) = <signal, ref> / ||ref||^2 * ref

    参数:
        signal: 待投影信号 (N,)
        reference: 参考信号 (N,) 或 (N, K)
        eps: 数值稳定性常数

    返回:
        投影后的信号 (N,)
    """
    if reference.ndim == 1:
        # 单个参考向量
        alpha = float(np.dot(signal, reference)) / (float(np.dot(reference, reference)) + eps)
        return alpha * reference
    else:
        # 多个参考向量 (N, K)：使用最小二乘
        try:
            coef, *_ = np.linalg.lstsq(reference, signal, rcond=None)
            return reference @ coef
        except np.linalg.LinAlgError:
            logger.warning("最小二乘求解失败，返回零向量")
            return np.zeros_like(signal)


def compute_bss_metrics_multisource(
    *,
    mixture_path: Path,
    estimates: Dict[str, Path],  # {source_name: estimate_path}
    references: Dict[str, Path],  # {source_name: reference_path}
    eps: float = 1e-12,
) -> MultiSourceMetrics:
    """
    计算多源分离的 BSS Eval 指标（完整版 Vincent et al. 2006）

    公式：
    对于每个目标源 j：
    1. ŝ_j = s_j + e_spat + e_interf + e_artif
    2. s_j = P_{s_j}(ŝ_j)  # 投影到目标源子空间
    3. e_spat = P_{s_j}(ŝ_j) - s_j  # 空间失真（单声道下为0）
    4. e_interf = P_S(ŝ_j) - s_j - e_spat  # 其他源干扰
    5. e_artif = ŝ_j - s_j - e_spat - e_interf  # 伪影

    其中：
    - P_{s_j}: 投影到单个目标源 s_j 的子空间
    - P_S: 投影到所有源 {s_1, ..., s_n} 张成的子空间

    指标计算：
    - SDR = 10 log10(||s||^2 / ||e_spat + e_interf + e_artif||^2)
    - SIR = 10 log10(||s + e_spat||^2 / ||e_interf||^2)
    - SAR = 10 log10(||s + e_spat + e_interf||^2 / ||e_artif||^2)
    - ISR = 10 log10(||s||^2 / ||e_spat||^2)  # 单声道下 e_spat=0，ISR=inf

    参数:
        mixture_path: 混合音频路径（用于验证，实际计算中不直接使用）
        estimates: 算法输出的各源估计 {source_name: path}
        references: 各源的金标准参考 {source_name: path}
        eps: 数值稳定性常数

    返回:
        MultiSourceMetrics: 包含每个源的 SDR/SIR/SAR/ISR
    """
    # 验证输入
    if set(estimates.keys()) != set(references.keys()):
        raise ValueError("estimates 和 references 的源名称必须一致")

    source_names = list(estimates.keys())
    if len(source_names) < 2:
        raise ValueError("多源分离至少需要2个源")

    # 加载混合音频（用于验证）
    mix = _load_audio_mono_44k(mixture_path)

    # 加载所有估计和参考
    est_dict = {name: _load_audio_mono_44k(estimates[name]) for name in source_names}
    ref_dict = {name: _load_audio_mono_44k(references[name]) for name in source_names}

    # 对齐长度
    min_len = min(
        mix.shape[0],
        min(e.shape[0] for e in est_dict.values()),
        min(r.shape[0] for r in ref_dict.values())
    )

    if min_len <= 0:
        raise ValueError("音频长度为 0，无法计算客观指标")

    mix = mix[:min_len]
    for name in source_names:
        est_dict[name] = est_dict[name][:min_len]
        ref_dict[name] = ref_dict[name][:min_len]

    # 去直流偏置
    mix = mix - float(np.mean(mix))
    for name in source_names:
        est_dict[name] = est_dict[name] - float(np.mean(est_dict[name]))
        ref_dict[name] = ref_dict[name] - float(np.mean(ref_dict[name]))

    # 构建所有参考源的矩阵 (N, num_sources)
    ref_matrix = np.stack([ref_dict[name] for name in source_names], axis=1)

    results = {}

    for target_name in source_names:
        est = est_dict[target_name]  # ŝ_j
        ref_target = ref_dict[target_name]  # s_j

        # 步骤1: 投影到目标源子空间 P_{s_j}(ŝ_j)
        s_target = _projection_operator(est, ref_target, eps)

        # 步骤2: 计算空间失真 e_spat = P_{s_j}(ŝ_j) - s_j
        # 注意：对于单声道，P_{s_j}(ŝ_j) 应该等于 <ŝ_j, s_j> / ||s_j||^2 * s_j
        # 而 s_j 本身就是参考，所以 e_spat = s_target - ref_target
        e_spat = s_target - ref_target

        # 步骤3: 投影到所有源子空间 P_S(ŝ_j)
        s_all = _projection_operator(est, ref_matrix, eps)

        # 步骤4: 计算干扰 e_interf = P_S(ŝ_j) - s_j - e_spat
        e_interf = s_all - ref_target - e_spat

        # 步骤5: 计算伪影 e_artif = ŝ_j - s_j - e_spat - e_interf
        e_artif = est - ref_target - e_spat - e_interf

        # 计算功率（能量）
        p_s = float(np.sum(ref_target**2)) + eps
        p_spat = float(np.sum(e_spat**2)) + eps
        p_interf = float(np.sum(e_interf**2)) + eps
        p_artif = float(np.sum(e_artif**2)) + eps

        # 计算指标（按照公式 3, 4, 5）
        # SDR = 10 log10(||s||^2 / ||e_spat + e_interf + e_artif||^2)
        e_total = e_spat + e_interf + e_artif
        p_total_error = float(np.sum(e_total**2)) + eps
        sdr = 10.0 * float(np.log10(p_s / p_total_error))

        # SIR = 10 log10(||s + e_spat||^2 / ||e_interf||^2)
        s_plus_spat = ref_target + e_spat
        p_s_plus_spat = float(np.sum(s_plus_spat**2)) + eps
        sir = 10.0 * float(np.log10(p_s_plus_spat / p_interf))

        # SAR = 10 log10(||s + e_spat + e_interf||^2 / ||e_artif||^2)
        s_plus_spat_interf = ref_target + e_spat + e_interf
        p_s_plus_spat_interf = float(np.sum(s_plus_spat_interf**2)) + eps
        sar = 10.0 * float(np.log10(p_s_plus_spat_interf / p_artif))

        # ISR = 10 log10(||s||^2 / ||e_spat||^2)
        # 单声道场景下 e_spat 通常很小，ISR 会很高
        isr = 10.0 * float(np.log10(p_s / p_spat))

        # SI-SDR（尺度不变）
        alpha = float(np.dot(est, ref_target)) / (float(np.dot(ref_target, ref_target)) + eps)
        target_scaled = alpha * ref_target
        noise = est - target_scaled
        p_target_scaled = float(np.sum(target_scaled**2)) + eps
        p_noise = float(np.sum(noise**2)) + eps
        si_sdr = 10.0 * float(np.log10(p_target_scaled / p_noise))

        results[target_name] = {
            "sdr": sdr,
            "sir": sir,
            "sar": sar,
            "isr": isr,
            "si_sdr": si_sdr,
        }

        logger.debug(
            "源 %s: SDR=%.2f, SIR=%.2f, SAR=%.2f, ISR=%.2f",
            target_name, sdr, sir, sar, isr
        )

    return MultiSourceMetrics(metrics_by_source=results)
