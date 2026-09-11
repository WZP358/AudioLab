"""Pure training loop timing - no validation."""
import os, sys, time, json, argparse

os.environ["WANDB_MODE"] = "offline"
os.environ["WANDB_SILENT"] = "true"

MSS_ROOT = r"D:\code\AudioLab\Music-Source-Separation-Training-main"
sys.path.insert(0, MSS_ROOT)

import yaml
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader
from ml_collections import ConfigDict
from tqdm import tqdm

from utils.settings import get_model_from_config, get_scheduler
from utils.model_utils import save_last_weights, initialize_model_and_device
from utils.dataset import prepare_data
from utils.losses import choice_loss


class DummyArgs:
    data_path = None
    valid_path = None
    dataset_type = 1
    num_workers = 0
    pin_memory = False
    persistent_workers = False
    prefetch_factor = None
    seed = 42
    device_ids = [0]
    results_path = None
    loss = "l1_loss"
    masked_loss_coef = 1.0
    mse_loss_coef = 1.0
    l1_loss_coef = 1.0
    log_wmse_loss_coef = 1.0
    multistft_loss_coef = 1.0
    spec_masked_loss_coef = 1.0
    spec_rmse_loss_coef = 1.0
    l1_snr_loss_coef = 1.0
    l1_snr_db_loss_coef = 1.0
    stft_l1_snr_db_loss_coef = 1.0
    multi_l1_snr_db_loss_coef = 1.0
    use_standard_loss = False


def measure_training(model_type, config_path, data_path, valid_path, results_path, device_id=0, output_json=None):
    with open(config_path, 'r') as f:
        config = ConfigDict(yaml.safe_load(f))

    device = torch.device(f"cuda:{device_id}")
    print(f"\n{'='*60}")
    print(f"Model: {model_type}")
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    print(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")

    model = get_model_from_config(model_type, config_path)
    model = model[0] if isinstance(model, (tuple, list)) else model
    device, model = initialize_model_and_device(model, [device_id])
    model.train()

    total_params = sum(p.numel() for p in model.parameters())
    print(f"Trainable params: {total_params:,} ({total_params/1e6:.2f}M)")

    args = DummyArgs()
    args.data_path = [data_path]
    args.valid_path = [valid_path]
    args.results_path = results_path

    batch_size = config.training.batch_size
    train_loader = prepare_data(config, args, batch_size)

    loss_funcs = choice_loss(config, args)
    optimizer = torch.optim.Adam(model.parameters(), lr=config.training.lr)
    scheduler = get_scheduler(config, optimizer, 0)
    use_amp = config.training.use_amp
    scaler = torch.cuda.amp.GradScaler(enabled=use_amp)

    num_steps = config.training.num_steps
    print(f"Batch size: {batch_size}, Steps: {num_steps}")

    # Warmup
    warmup = 5
    step_times = []
    gpu_mem = []

    total_start = time.time()

    for step, batch in enumerate(train_loader):
        if step >= num_steps:
            break

        step_start = time.time()

        stems, mix = batch[0], batch[1]
        stems = stems.to(device, non_blocking=True)
        mix = mix.to(device, non_blocking=True)

        with torch.cuda.amp.autocast(enabled=use_amp):
            y_ = model(mix)
            loss = loss_funcs(y_, stems, mix)

        scaler.scale(loss).backward()
        scaler.step(optimizer)
        scaler.update()
        optimizer.zero_grad()

        torch.cuda.synchronize()
        step_time = time.time() - step_start

        if step >= warmup:
            step_times.append(step_time)
            gpu_mem.append(torch.cuda.max_memory_allocated() / 1024**3)

        if (step + 1) % 10 == 0:
            avg = np.mean(step_times[-5:]) if len(step_times) >= 5 else np.mean(step_times)
            mem = gpu_mem[-1] if gpu_mem else 0
            print(f"  Step {step+1:3d}/{num_steps}: {step_time:.3f}s/step, avg={avg:.3f}s, loss={loss.item():.6f}, peak_mem={mem:.2f}GB")

    total_time = time.time() - total_start

    if len(step_times) < 2:
        print("ERROR: Not enough steps completed!")
        return None

    avg_step = np.mean(step_times)
    std_step = np.std(step_times)
    peak_mem = max(gpu_mem) if gpu_mem else 0

    result = {
        "model_type": model_type,
        "measured_batch_size": batch_size,
        "num_params": total_params,
        "num_steps_measured": len(step_times),
        "total_time_s": round(total_time, 1),
        "avg_step_time_s": round(float(avg_step), 4),
        "std_step_time_s": round(float(std_step), 4),
        "min_step_time_s": round(float(np.min(step_times)), 4),
        "max_step_time_s": round(float(np.max(step_times)), 4),
        "peak_gpu_memory_gb": round(float(peak_mem), 2),
    }

    print(f"\nResults: avg_step={avg_step:.4f}s, peak_mem={peak_mem:.2f}GB, total={total_time:.1f}s")

    if output_json:
        with open(output_json, 'w') as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        print(f"Saved to {output_json}")

    del model, optimizer, scaler
    torch.cuda.empty_cache()
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model_type", required=True)
    parser.add_argument("--config_path", required=True)
    parser.add_argument("--data_path", required=True)
    parser.add_argument("--valid_path", required=True)
    parser.add_argument("--results_path", default="/tmp/timing_results")
    parser.add_argument("--output_json", required=True)
    args = parser.parse_args()

    measure_training(
        args.model_type, args.config_path,
        args.data_path, args.valid_path,
        args.results_path, output_json=args.output_json
    )
