#!/usr/bin/env python
"""AudioLab 模型优化执行脚本（S4 增量训练 / S101 结构化剪枝 / S102 量化）。

由后端 `app/services/optimization_service.py::launch_job` 以子进程方式调用，
统一通过命令行参数接收任务类型与 JSON 配置文件路径，输出写入 stdout（后端捕获为日志）。

本脚本是「真实可执行」的编排入口：
- incremental_training：派生 config（覆盖 epochs/batch_size/lr，注入单源定向损失权重），
  调用仓库 train.py 完成微调；per-stem 权重由 utils/losses.py 的 masked_loss 支持。
- pruning：加载 checkpoint，使用 torch 全局非结构化幅值剪枝，保存剪枝后的权重。
- quantization：加载 checkpoint，对 Linear 层做 INT8 动态量化，保存量化后的权重。

注意：增量训练/剪枝/量化均为 GPU 长耗时研究级操作，其有效性需要真实训练数据与
多轮实验验证；本脚本提供完整、可复现的调用链路与产物落盘。
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

MSS_ROOT = Path(__file__).resolve().parent

# 算法（Algorithm 枚举值）→ MSS 仓库 (model_type, 默认 config, ckpt 环境变量)
ALGO_SPECS = {
    "MDX23C": ("mdx23c", "config_musdb18_mdx23c.yaml", "MSS_MDX23C_CKPT"),
    "Demucs4HT": ("htdemucs", "config_musdb18_htdemucs.yaml", "MSS_DEMUCS4HT_CKPT"),
    "Band Split RoFormer": ("bs_roformer", "config_musdb18_bs_roformer_384.yaml", "MSS_BS_ROFORMER_CKPT"),
    "SCNet": ("scnet", "config_musdb18_scnet.yaml", "MSS_SCNET_CKPT"),
}

# 后端主观评分权重的声源名（大写）→ 各模型 config.training.instruments 的小写声源名
STEM_NAME_MAP = {
    "Vocals": "vocals",
    "Drums": "drums",
    "Bass": "bass",
    "Other": "other",
}


def _load_config_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _resolve_spec(algorithm: str):
    spec = ALGO_SPECS.get(algorithm)
    if spec is None:
        raise ValueError(f"未知或未指定算法：{algorithm!r}。可选：{list(ALGO_SPECS)}")
    return spec


def _resolve_checkpoint(cfg: dict, ckpt_env: str) -> str:
    ckpt = cfg.get("start_check_point")
    if ckpt and Path(ckpt).exists():
        return ckpt
    ckpt = os.getenv(ckpt_env)
    if ckpt and Path(ckpt).exists():
        return ckpt
    raise FileNotFoundError(
        f"未找到增量训练起始权重：请在 job config 提供 start_check_point，或设置环境变量 {ckpt_env}"
    )


def _out_dir(cfg: dict, job_id: str) -> Path:
    out = cfg.get("results_path") or str(MSS_ROOT / "results" / "optimization" / f"job_{job_id}")
    Path(out).mkdir(parents=True, exist_ok=True)
    return Path(out)


def run_incremental_training(cfg: dict, job_id: str, model_type: str, default_config: str, ckpt_env: str) -> int:
    data_path = cfg.get("data_path")
    if not data_path:
        raise ValueError("增量训练需要提供 data_path（训练数据目录列表）。")
    data_path = data_path if isinstance(data_path, list) else [data_path]
    valid_path = cfg.get("valid_path")
    if valid_path:
        valid_path = valid_path if isinstance(valid_path, list) else [valid_path]

    start_ckpt = _resolve_checkpoint(cfg, ckpt_env)
    out = _out_dir(cfg, job_id)

    # 派生 config：覆盖 epochs / batch_size / lr，注入单源定向损失权重
    sys.path.insert(0, str(MSS_ROOT))
    from utils.settings import load_config
    base_cfg_path = cfg.get("config_path") or str(MSS_ROOT / "configs" / default_config)
    config = load_config(model_type, base_cfg_path)

    epochs = cfg.get("epochs")
    batch_size = cfg.get("batch_size")
    lr = cfg.get("learning_rate")
    if epochs:
        config.training.num_epochs = int(epochs)
    if batch_size:
        config.training.batch_size = int(batch_size)
    if lr:
        config.training.lr = float(lr)

    stem_weights = cfg.get("stem_loss_weights")
    if stem_weights:
        instruments = list(getattr(config.training, "instruments", [])) or ["vocals", "drums", "bass", "other"]
        mapped = {STEM_NAME_MAP.get(k, k.lower()): float(v) for k, v in stem_weights.items()}
        config.training.per_stem_loss_weights = {inst: mapped.get(inst, 1.0) for inst in instruments}

    derived_path = out / "train_config.yaml"
    import yaml
    derived_path.write_text(yaml.safe_dump(config.to_dict(), sort_keys=False), encoding="utf-8")

    cmd = [sys.executable, str(MSS_ROOT / "train.py")]
    cmd += ["--model_type", model_type, "--config_path", str(derived_path)]
    cmd += ["--start_check_point", start_ckpt]
    cmd += ["--results_path", str(out)]
    cmd += ["--data_path"] + [str(p) for p in data_path]
    if valid_path:
        cmd += ["--valid_path"] + [str(p) for p in valid_path]
    if cfg.get("num_workers"):
        cmd += ["--num_workers", str(int(cfg["num_workers"]))]
    if cfg.get("device_ids"):
        ids = cfg["device_ids"] if isinstance(cfg["device_ids"], list) else [cfg["device_ids"]]
        cmd += ["--device_ids"] + [str(int(i)) for i in ids]
    print(f"[optimize] 增量训练命令: {' '.join(cmd)}", flush=True)
    return _run_cmd(cmd)


def _load_model_and_weights(cfg: dict, model_type: str, default_config: str, ckpt_env: str):
    import torch
    sys.path.insert(0, str(MSS_ROOT))
    from utils.settings import get_model_from_config
    config_path = cfg.get("config_path") or str(MSS_ROOT / "configs" / default_config)
    model, config = get_model_from_config(model_type, config_path)
    ckpt = _resolve_checkpoint(cfg, ckpt_env)
    checkpoint = torch.load(ckpt, map_location="cpu", weights_only=False)
    state = checkpoint.get("state_dict", checkpoint)
    model.load_state_dict(state)
    return model, config


def run_pruning(cfg: dict, job_id: str, model_type: str, default_config: str, ckpt_env: str) -> int:
    import torch
    import torch.nn.utils.prune as prune
    model, _ = _load_model_and_weights(cfg, model_type, default_config, ckpt_env)

    sparsity = float(cfg.get("sparsity", 0.3))
    targets = []
    for name, module in model.named_modules():
        if isinstance(module, (torch.nn.Linear, torch.nn.Conv1d, torch.nn.Conv2d)):
            targets.append((module, "weight"))

    if not targets:
        raise ValueError("未找到可剪枝的 Linear/Conv 层，无法执行结构化剪枝。")

    prune.global_unstructured(
        targets,
        pruning_method=prune.L1Unstructured,
        amount=sparsity,
    )
    for module, _ in targets:
        prune.remove(module, "weight")

    out = _out_dir(cfg, job_id)
    ckpt_out = out / "pruned.ckpt"
    torch.save({"state_dict": model.state_dict(), "sparsity": sparsity}, ckpt_out)
    print(f"[optimize] 剪枝完成（sparsity={sparsity}），已保存：{ckpt_out}", flush=True)
    return 0


def run_quantization(cfg: dict, job_id: str, model_type: str, default_config: str, ckpt_env: str) -> int:
    import torch
    model, _ = _load_model_and_weights(cfg, model_type, default_config, ckpt_env)
    dtype = getattr(torch, cfg.get("dtype", "qint8"), torch.qint8)
    try:
        model = torch.ao.quantization.quantize_dynamic(model, {torch.nn.Linear}, dtype=dtype)
    except Exception as exc:
        raise RuntimeError(f"动态量化失败（该模型结构可能不支持）：{exc}") from exc

    out = _out_dir(cfg, job_id)
    ckpt_out = out / "quantized.ckpt"
    torch.save({"state_dict": model.state_dict(), "dtype": str(dtype)}, ckpt_out)
    print(f"[optimize] 量化完成（dtype={dtype}），已保存：{ckpt_out}", flush=True)
    return 0


def _run_cmd(cmd) -> int:
    import subprocess
    return subprocess.run(cmd, cwd=str(MSS_ROOT)).returncode


def main() -> int:
    parser = argparse.ArgumentParser(description="AudioLab 模型优化执行器")
    parser.add_argument("--kind", required=True, choices=["incremental_training", "pruning", "quantization"])
    parser.add_argument("--algorithm", required=True)
    parser.add_argument("--config", required=True)
    parser.add_argument("--job-id", required=True)
    args = parser.parse_args()

    cfg = _load_config_json(args.config)
    model_type, default_config, ckpt_env = _resolve_spec(args.algorithm)

    print(f"[optimize] job={args.job_id} kind={args.kind} algorithm={args.algorithm} "
          f"model_type={model_type}", flush=True)
    if args.kind == "incremental_training":
        return run_incremental_training(cfg, args.job_id, model_type, default_config, ckpt_env)
    if args.kind == "pruning":
        return run_pruning(cfg, args.job_id, model_type, default_config, ckpt_env)
    if args.kind == "quantization":
        return run_quantization(cfg, args.job_id, model_type, default_config, ckpt_env)
    raise ValueError(f"未知任务类型：{args.kind}")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001
        import traceback
        traceback.print_exc()
        print(f"[optimize] 失败：{type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
        sys.exit(1)
