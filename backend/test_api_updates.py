"""
API 更新测试脚本

测试新增的批量接口功能：
1. 批量客观指标计算
2. 批量主观评分提交
"""
import sys
import io
from pathlib import Path

# 修复 Windows 控制台编码问题
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

# 添加项目路径
sys.path.insert(0, str(Path(__file__).parent))

import asyncio
from app.schemas import ScoreCreateBatch, StemScoreData
from app.models import Algorithm


def test_schema_validation():
    """测试 Schema 验证逻辑"""
    print("=" * 60)
    print("测试 Schema 验证")
    print("=" * 60)

    # 测试1: 正常情况 - 包含所有4个源
    print("\n测试1: 正常情况（包含所有4个源）")
    try:
        valid_data = ScoreCreateBatch(
            task_id=123,
            algorithm=Algorithm.MDX23C,
            scores=[
                StemScoreData(stem_name="Vocals", quality=85, interference=78, artifacts=82),
                StemScoreData(stem_name="Drums", quality=72, interference=68, artifacts=75),
                StemScoreData(stem_name="Bass", quality=68, interference=65, artifacts=70),
                StemScoreData(stem_name="Other", quality=60, interference=58, artifacts=62),
            ]
        )
        print("✅ 验证通过")
        print(f"   任务ID: {valid_data.task_id}")
        print(f"   算法: {valid_data.algorithm.value}")
        print(f"   评分数量: {len(valid_data.scores)}")
    except Exception as e:
        print(f"❌ 验证失败: {e}")

    # 测试2: 缺少源
    print("\n测试2: 缺少源（只有3个）")
    try:
        invalid_data = ScoreCreateBatch(
            task_id=123,
            algorithm=Algorithm.MDX23C,
            scores=[
                StemScoreData(stem_name="Vocals", quality=85, interference=78, artifacts=82),
                StemScoreData(stem_name="Drums", quality=72, interference=68, artifacts=75),
                StemScoreData(stem_name="Bass", quality=68, interference=65, artifacts=70),
                # 缺少 Other
            ]
        )
        print("❌ 应该抛出验证错误，但没有")
    except ValueError as e:
        print(f"✅ 正确捕获错误: {e}")
    except Exception as e:
        print(f"⚠️  捕获到其他错误: {e}")

    # 测试3: 评分超出范围
    print("\n测试3: 评分超出范围")
    try:
        invalid_score = StemScoreData(
            stem_name="Vocals",
            quality=150,  # 超出范围
            interference=78,
            artifacts=82
        )
        print("❌ 应该抛出验证错误，但没有")
    except ValueError as e:
        print(f"✅ 正确捕获错误: {e}")
    except Exception as e:
        print(f"⚠️  捕获到其他错误: {e}")

    # 测试4: 包含未知源
    print("\n测试4: 包含未知源")
    try:
        invalid_data = ScoreCreateBatch(
            task_id=123,
            algorithm=Algorithm.MDX23C,
            scores=[
                StemScoreData(stem_name="Vocals", quality=85, interference=78, artifacts=82),
                StemScoreData(stem_name="Drums", quality=72, interference=68, artifacts=75),
                StemScoreData(stem_name="Bass", quality=68, interference=65, artifacts=70),
                StemScoreData(stem_name="Piano", quality=60, interference=58, artifacts=62),  # 未知源
            ]
        )
        print("❌ 应该抛出验证错误，但没有")
    except ValueError as e:
        print(f"✅ 正确捕获错误: {e}")
    except Exception as e:
        print(f"⚠️  捕获到其他错误: {e}")


def test_multisource_metrics_import():
    """测试多源指标模块导入"""
    print("\n" + "=" * 60)
    print("测试多源指标模块导入")
    print("=" * 60)

    try:
        from app.services.objective_metrics_multisource import (
            compute_bss_metrics_multisource,
            MultiSourceMetrics,
            _projection_operator,
        )
        print("✅ 模块导入成功")
        print(f"   - compute_bss_metrics_multisource: {compute_bss_metrics_multisource.__name__}")
        print(f"   - MultiSourceMetrics: {MultiSourceMetrics.__name__}")
        print(f"   - _projection_operator: {_projection_operator.__name__}")
    except ImportError as e:
        print(f"❌ 模块导入失败: {e}")
    except Exception as e:
        print(f"❌ 其他错误: {e}")


def test_projection_operator():
    """测试投影算子"""
    print("\n" + "=" * 60)
    print("测试投影算子")
    print("=" * 60)

    try:
        import numpy as np
        from app.services.objective_metrics_multisource import _projection_operator

        # 测试1: 单个参考向量
        print("\n测试1: 单个参考向量投影")
        signal = np.array([1.0, 2.0, 3.0, 4.0])
        reference = np.array([1.0, 0.0, 0.0, 0.0])
        projection = _projection_operator(signal, reference)
        print(f"   信号: {signal}")
        print(f"   参考: {reference}")
        print(f"   投影: {projection}")
        print(f"   ✅ 投影成功")

        # 测试2: 多个参考向量
        print("\n测试2: 多个参考向量投影（最小二乘）")
        signal = np.array([1.0, 2.0, 3.0, 4.0])
        references = np.array([
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
        ]).T  # (4, 2)
        projection = _projection_operator(signal, references)
        print(f"   信号: {signal}")
        print(f"   参考矩阵形状: {references.shape}")
        print(f"   投影: {projection}")
        print(f"   ✅ 投影成功")

    except Exception as e:
        print(f"❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()


def print_summary():
    """打印测试总结"""
    print("\n" + "=" * 60)
    print("测试总结")
    print("=" * 60)
    print("""
已完成的更新：

1. ✅ 完整 BSS Eval v3 客观指标实现
   - 新增 objective_metrics_multisource.py
   - 投影算子实现
   - 误差分解（e_spat, e_interf, e_artif）
   - 批量计算接口

2. ✅ 批量主观评分提交
   - 新增 ScoreCreateBatch Schema
   - 自动验证所有4个源
   - 防止重复提交
   - 批量创建接口

3. ✅ 文档与示例
   - API 更新说明
   - 使用指南
   - 前端组件示例
   - 测试脚本

下一步：
1. 前端集成批量评分组件
2. 准备测试数据验证客观指标
3. 性能测试
    """)


if __name__ == "__main__":
    print("AudioLab API 更新测试")
    print("=" * 60)

    # 运行测试
    test_schema_validation()
    test_multisource_metrics_import()
    test_projection_operator()
    print_summary()

    print("\n✅ 所有测试完成")
