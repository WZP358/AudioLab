from __future__ import annotations

from typing import Sequence

import numpy as np


def _l1_normalize(x: np.ndarray, eps: float = 1e-12) -> np.ndarray:
    """L1 归一化，避免能量/强度尺度差异影响重叠一致性。"""
    x = np.asarray(x, dtype=np.float64)
    s = float(np.sum(x))
    if s <= eps:
        return np.zeros_like(x, dtype=np.float64)
    return x / s


def compute_overlap_consistency(
    a: Sequence[Sequence[float]] | np.ndarray,
    b: Sequence[Sequence[float]] | np.ndarray,
    *,
    eps: float = 1e-12,
) -> float:
    """
    基于"交集/并集"的 overlap consistency（IoU-like）。

    该函数用于你论文中的 SOC/WOC 思路（对频谱/波形分别调用）。
    """
    A = np.asarray(a, dtype=np.float64)
    B = np.asarray(b, dtype=np.float64)

    if A.ndim != 2 or B.ndim != 2:
        raise ValueError("compute_overlap_consistency expects 2D arrays for spectrogram-like inputs.")

    # 如出现尺寸不一致，裁剪到公共区域（与可视化 downsample 方案保持一致性）
    f = min(A.shape[0], B.shape[0])
    t = min(A.shape[1], B.shape[1])
    if f <= 0 or t <= 0:
        return 0.0

    A = A[:f, :t]
    B = B[:f, :t]

    A_tilde = _l1_normalize(A, eps=eps)
    B_tilde = _l1_normalize(B, eps=eps)

    inter = float(np.minimum(A_tilde, B_tilde).sum())
    union = float(np.maximum(A_tilde, B_tilde).sum())
    if union <= eps:
        return 0.0
    return inter / union


def compute_soc_from_spectrograms(
    spec_ref: Sequence[Sequence[float]] | np.ndarray,
    spec_est: Sequence[Sequence[float]] | np.ndarray,
) -> float:
    """SOC：频谱幅度（已 downsample/pool）重叠一致性。"""
    return compute_overlap_consistency(spec_ref, spec_est)

