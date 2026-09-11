"""Measure 1-epoch training time for a given model config."""
import argparse
import time
import json
import sys
import os

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model_type", type=str, required=True)
    parser.add_argument("--config_path", type=str, required=True)
    parser.add_argument("--data_path", type=str, required=True)
    parser.add_argument("--valid_path", type=str, required=True)
    parser.add_argument("--results_path", type=str, required=True)
    parser.add_argument("--device_ids", type=int, default=0)
    parser.add_argument("--num_workers", type=int, default=0)
    parser.add_argument("--output_json", type=str, required=True)
    args = parser.parse_args()

    os.environ["WANDB_MODE"] = "offline"
    os.environ["WANDB_SILENT"] = "true"

    # Import after env setup
    sys.path.insert(0, r"D:\code\AudioLab\Music-Source-Separation-Training-main")
    from utils.settings import get_model_from_config, get_scheduler
    from utils.model_utils import save_last_weights, initialize_model_and_device
    from utils.dataset import prepare_data
    from utils.losses import choice_loss
    from ml_collections import ConfigDict
    import yaml
    import torch
    import numpy as np
    from tqdm import tqdm
    import torch.distributed as dist

    with open(args.config_path, 'r') as f:
        config = ConfigDict(yaml.safe_load(f))

    device = torch.device(f"cuda:{args.device_ids}")
    print(f"Using device: {device}")
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    print(f"VRAM: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")

    model = get_model_from_config(config)
    use_amp = config.training.use_amp

    model, device_ids_to_use = initialize_model_and_device(config, model, args)
    model = model.to(device)
    model.train()

    total_params = sum(p.numel() for p in model.parameters())
    print(f"Model parameters: {total_params:,}")

    batch_size = config.training.batch_size
    train_loader = prepare_data(config, args, batch_size)

    loss_funcs = choice_loss(config, args)
    optimizer = torch.optim.Adam(model.parameters(), lr=config.training.lr)
    scheduler = get_scheduler(config, optimizer, 0)
    scaler = torch.cuda.amp.GradScaler(enabled=use_amp)

    num_steps = config.training.num_steps
    print(f"Running {num_steps} steps with batch_size={batch_size}...")

    # Warmup steps
    warmup_steps = 5

    step_times = []
    total_start = time.time()

    for step, (stems, mix) in enumerate(train_loader):
        if step >= num_steps:
            break

        step_start = time.time()

        stems = stems.to(device)
        mix = mix.to(device)

        with torch.cuda.amp.autocast(enabled=use_amp):
            y_ = model(mix)
            loss = loss_funcs(y_, stems, mix)

        scaler.scale(loss).backward()
        scaler.step(optimizer)
        scaler.update()
        optimizer.zero_grad()

        torch.cuda.synchronize()
        step_time = time.time() - step_start

        if step >= warmup_steps:
            step_times.append(step_time)

        if (step + 1) % 20 == 0:
            avg = np.mean(step_times[-15:]) if len(step_times) >= 15 else np.mean(step_times)
            print(f"  Step {step+1}/{num_steps}: {step_time:.3f}s, avg_step={avg:.3f}s, loss={loss.item():.5f}")

    total_time = time.time() - total_start
    avg_step_time = np.mean(step_times)
    std_step_time = np.std(step_times)
    min_step_time = np.min(step_times)
    max_step_time = np.max(step_times)

    print(f"\n========== Results ==========")
    print(f"Model: {args.model_type}")
    print(f"Batch size: {batch_size}")
    print(f"Steps run: {num_steps}")
    print(f"Total time: {total_time:.1f}s ({total_time/60:.1f}min)")
    print(f"Avg step time (excl warmup): {avg_step_time:.3f}s")
    print(f"Step time std: {std_step_time:.3f}s")
    print(f"Step time range: {min_step_time:.3f}s - {max_step_time:.3f}s")
    print(f"Parameters: {total_params:,}")

    # Estimate full epoch and full training
    config_num_epochs = config.training.num_epochs
    config_num_steps = 200  # we used this

    estimated_full_epoch_time = avg_step_time * config_num_steps
    estimated_full_training = estimated_full_epoch_time * config_num_epochs

    result = {
        "model_type": args.model_type,
        "batch_size": batch_size,
        "num_params": total_params,
        "num_steps_measured": num_steps,
        "total_time_s": round(total_time, 1),
        "avg_step_time_s": round(avg_step_time, 4),
        "std_step_time_s": round(std_step_time, 4),
        "min_step_time_s": round(min_step_time, 4),
        "max_step_time_s": round(max_step_time, 4),
        "config_num_epochs": config_num_epochs,
        "estimated_1epoch_200steps_s": round(estimated_full_epoch_time, 1),
    }

    with open(args.output_json, 'w') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"\nResults saved to {args.output_json}")

    # Cleanup
    del model, optimizer, scaler
    torch.cuda.empty_cache()


if __name__ == "__main__":
    main()
