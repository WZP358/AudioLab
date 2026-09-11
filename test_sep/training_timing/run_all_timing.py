"""Run training timing for all 4 models with minimal steps."""
import subprocess
import time
import json
import os

os.environ["WANDB_MODE"] = "offline"
os.environ["WANDB_SILENT"] = "true"

DATA_PATH = r"D:\code\experiment\index_correlation\data\musdb18hq\train"
VALID_PATH = r"D:\code\experiment\index_correlation\data\musdb18hq\valid"
TRAIN_SCRIPT = r"D:\code\AudioLab\Music-Source-Separation-Training-main\train.py"
OUTPUT_DIR = r"D:\code\AudioLab\test_sep\training_timing"

MODELS = [
    {
        "name": "SCNet",
        "model_type": "scnet",
        "config": os.path.join(OUTPUT_DIR, "config_scnet_quick.yaml"),
        "results": os.path.join(OUTPUT_DIR, "scnet_quick"),
        "original_bs": 10,
        "measured_bs": 4,
        "original_num_steps": 1000,
        "config_epochs": 1000,
    },
    {
        "name": "Demucs4HT",
        "model_type": "htdemucs",
        "config": os.path.join(OUTPUT_DIR, "config_htdemucs_quick.yaml"),
        "results": os.path.join(OUTPUT_DIR, "htdemucs_quick"),
        "original_bs": 8,
        "measured_bs": 1,
        "original_num_steps": 1000,
        "config_epochs": 1000,
    },
    {
        "name": "MDX23C",
        "model_type": "mdx23c",
        "config": os.path.join(OUTPUT_DIR, "config_mdx23c_quick.yaml"),
        "results": os.path.join(OUTPUT_DIR, "mdx23c_quick"),
        "original_bs": 6,
        "measured_bs": 1,
        "original_num_steps": 1000,
        "config_epochs": 1000,
    },
    {
        "name": "BS-RoFormer",
        "model_type": "bs_roformer",
        "config": os.path.join(OUTPUT_DIR, "config_bs_roformer_quick.yaml"),
        "results": os.path.join(OUTPUT_DIR, "bs_roformer_quick"),
        "original_bs": 1,
        "measured_bs": 1,
        "original_num_steps": 1000,
        "config_epochs": 1000,
    },
]

all_results = []

for m in MODELS:
    print(f"\n{'='*60}")
    print(f"Measuring: {m['name']}")
    print(f"Model type: {m['model_type']}, batch_size: {m['measured_bs']}")
    print(f"{'='*60}")

    cmd = [
        "python", TRAIN_SCRIPT,
        "--model_type", m["model_type"],
        "--config_path", m["config"],
        "--data_path", DATA_PATH,
        "--valid_path", VALID_PATH,
        "--results_path", m["results"],
        "--device_ids", "0",
        "--num_workers", "0",
        "--wandb_offline",
    ]

    t0 = time.time()
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=1800, cwd=r"D:\code\AudioLab\Music-Source-Separation-Training-main")
        elapsed = time.time() - t0
        success = result.returncode == 0
    except subprocess.TimeoutExpired:
        elapsed = time.time() - t0
        success = False
        result = None

    print(f"Return code: {result.returncode if result else 'TIMEOUT'}")
    print(f"Elapsed: {elapsed:.1f}s ({elapsed/60:.1f}min)")

    # Print last 5 lines of output
    if result:
        lines = result.stdout.strip().split('\n')
        for line in lines[-8:]:
            print(f"  {line}")
        if result.stderr and 'Traceback' in result.stderr:
            print(f"STDERR: {result.stderr[-500:]}")

    # Extract loss values to verify training happened
    num_steps_completed = 0
    if result:
        for line in result.stdout.split('\n'):
            if 'loss=' in line and 'avg_loss=' in line:
                parts = line.split()
                for p in parts:
                    if p.endswith('it/s'):
                        try:
                            step_str = p.split('|')[0].split('/')[0].strip().replace('%', '').replace('�', '')
                            if step_str.isdigit() or (step_str and step_str[0].isdigit()):
                                num_steps_completed = max(num_steps_completed, int(step_str.split('/')[0].split('|')[-1]))
                        except:
                            pass

    r = {
        "name": m["name"],
        "model_type": m["model_type"],
        "measured_batch_size": m["measured_bs"],
        "original_batch_size": m["original_bs"],
        "elapsed_seconds": round(elapsed, 1),
        "success": success,
        "num_steps_completed": num_steps_completed,
    }
    all_results.append(r)
    print(f"Recorded: {json.dumps(r, ensure_ascii=False)}")

print(f"\n{'='*60}")
print("ALL RESULTS:")
for r in all_results:
    print(f"  {r['name']}: {r['elapsed_seconds']}s, success={r['success']}, steps={r['num_steps_completed']}")

with open(os.path.join(OUTPUT_DIR, "all_timing.json"), 'w') as f:
    json.dump(all_results, f, indent=2, ensure_ascii=False)

print(f"\nResults saved to {OUTPUT_DIR}/all_timing.json")
