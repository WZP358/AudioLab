"""Measure inference time for all 4 models on a real song."""
import subprocess, time, json, os, shutil

MSS_ROOT = r"D:\code\AudioLab\Music-Source-Separation-Training-main"
INPUT_FOLDER = r"D:\code\AudioLab\test_sep\inference_timing"
OUTPUT_BASE = r"D:\code\AudioLab\test_sep\inference_results"

# Copy the song
os.makedirs(INPUT_FOLDER, exist_ok=True)
src = r"D:\code\experiment\index_correlation\data\musdb18hq\valid\Bill Chudziak - Children Of No-one\mixture.wav"
dst = os.path.join(INPUT_FOLDER, "test_song.wav")
if not os.path.exists(dst):
    shutil.copy2(src, dst)

MODELS = [
    {
        "name": "SCNet",
        "model_type": "scnet",
        "config": os.path.join(MSS_ROOT, "configs", "config_musdb18_scnet.yaml"),
        "ckpt": r"D:/code/models/mss/scnet_checkpoint_musdb18.ckpt",
    },
    {
        "name": "Demucs4HT",
        "model_type": "htdemucs",
        "config": os.path.join(MSS_ROOT, "configs", "config_musdb18_htdemucs.yaml"),
        "ckpt": r"D:/code/models/mss/955717e8-8726e21a.th",
    },
    {
        "name": "MDX23C",
        "model_type": "mdx23c",
        "config": os.path.join(MSS_ROOT, "configs", "config_musdb18_mdx23c.yaml"),
        "ckpt": r"D:/code/models/mss/model_mdx23c_ep_168_sdr_7.0207.ckpt",
    },
    {
        "name": "BS-RoFormer",
        "model_type": "bs_roformer",
        "config": os.path.join(MSS_ROOT, "configs", "config_musdb18_bs_roformer_384.yaml"),
        "ckpt": r"D:/code/models/mss/model_bs_roformer_ep_17_sdr_9.6568.ckpt",
    },
]

# Check audio duration
result = subprocess.run(
    ["ffprobe", "-i", dst, "-show_entries", "format=duration", "-v", "quiet", "-of", "csv=p=0"],
    capture_output=True, text=True
)
duration = float(result.stdout.strip())
print(f"Test song duration: {duration:.1f}s ({duration/60:.1f} min)")

all_results = []

for m in MODELS:
    out_dir = os.path.join(OUTPUT_BASE, m["name"])
    if os.path.exists(out_dir):
        shutil.rmtree(out_dir)
    os.makedirs(out_dir, exist_ok=True)

    cmd = [
        "python", os.path.join(MSS_ROOT, "inference.py"),
        "--model_type", m["model_type"],
        "--config_path", m["config"],
        "--start_check_point", m["ckpt"],
        "--input_folder", INPUT_FOLDER,
        "--store_dir", out_dir,
        "--device_ids", "0",
    ]

    print(f"\n{'='*60}")
    print(f"Running: {m['name']} ({m['model_type']})")
    t0 = time.time()

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    elapsed = time.time() - t0

    print(f"Elapsed: {elapsed:.1f}s ({elapsed/60:.1f}min)")
    print(f"Return code: {result.returncode}")

    # Print last lines
    lines = result.stdout.strip().split('\n')
    for line in lines[-5:]:
        print(f"  {line}")

    r = {
        "name": m["name"],
        "model_type": m["model_type"],
        "song_duration_s": duration,
        "inference_time_s": round(elapsed, 1),
        "real_time_factor": round(duration / elapsed, 2) if elapsed > 0 else 0,
        "success": result.returncode == 0,
    }
    all_results.append(r)

print(f"\n{'='*60}")
print("ALL INFERENCE RESULTS:")
for r in all_results:
    print(f"  {r['name']}: {r['inference_time_s']}s (RTF: {r['real_time_factor']}x, success={r['success']})")

with open(os.path.join(OUTPUT_BASE, "inference_timing.json"), 'w') as f:
    json.dump(all_results, f, indent=2, ensure_ascii=False)
print(f"\nSaved to {OUTPUT_BASE}/inference_timing.json")
