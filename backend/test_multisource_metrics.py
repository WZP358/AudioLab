"""
测试多源分离指标计算

使用方法：
1. 准备测试数据：
   - mixture.wav: 混合音频
   - vocals_ref.wav, drums_ref.wav, bass_ref.wav, other_ref.wav: 金标准
   - vocals_est.wav, drums_est.wav, bass_est.wav, other_est.wav: 算法输出

2. 运行测试：
   python test_multisource_metrics.py
"""
import sys
from pathlib import Path

# 添加项目路径
sys.path.insert(0, str(Path(__file__).parent))

from app.services.objective_metrics_multisource import compute_bss_metrics_multisource


def test_multisource_metrics():
    """测试多源指标计算"""

    # 示例：使用你的数据集路径
    test_dir = Path("test_data")  # 修改为你的测试数据目录

    mixture_path = test_dir / "mixture.wav"

    estimates = {
        "Vocals": test_dir / "vocals_est.wav",
        "Drums": test_dir / "drums_est.wav",
        "Bass": test_dir / "bass_est.wav",
        "Other": test_dir / "other_est.wav",
    }

    references = {
        "Vocals": test_dir / "vocals_ref.wav",
        "Drums": test_dir / "drums_ref.wav",
        "Bass": test_dir / "bass_ref.wav",
        "Other": test_dir / "other_ref.wav",
    }

    # 检查文件是否存在
    if not mixture_path.exists():
        print(f"错误: 混合音频不存在: {mixture_path}")
        print("\n请准备测试数据后再运行此脚本")
        return

    missing = []
    for name, path in {**estimates, **references}.items():
        if not path.exists():
            missing.append(str(path))

    if missing:
        print(f"错误: 以下文件不存在:")
        for p in missing:
            print(f"  - {p}")
        return

    print("开始计算多源分离指标...")
    print(f"混合音频: {mixture_path}")
    print(f"评估源: {list(estimates.keys())}")

    try:
        metrics = compute_bss_metrics_multisource(
            mixture_path=mixture_path,
            estimates=estimates,
            references=references,
        )

        print("\n" + "="*60)
        print("多源分离指标结果")
        print("="*60)

        for source_name, m in metrics.metrics_by_source.items():
            print(f"\n{source_name}:")
            print(f"  SDR: {m['sdr']:.2f} dB  (整体失真)")
            print(f"  SIR: {m['sir']:.2f} dB  (干扰抑制)")
            print(f"  SAR: {m['sar']:.2f} dB  (伪影抑制)")
            print(f"  ISR: {m['isr']:.2f} dB  (空间失真)")

        print(f"\n平均 SDR: {metrics.get_average_sdr():.2f} dB")
        print("="*60)

    except Exception as e:
        print(f"\n计算失败: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    test_multisource_metrics()
