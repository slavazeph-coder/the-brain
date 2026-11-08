#!/usr/bin/env python3
"""Run 115 — MapAnything dense-inference smoke on 4090 (fixed from run 71).

Run 71 failed because huggingface_hub's PyTorchModelHubMixin.forerpretrained
passes unknown kwargs (low_cpu_mem_usage, torch_dtype) straight into
MapAnything.__init__ and the adapter class does not accept them. This probe:

1. Constructs MapAnything directly from its on-disk config (no HF download).
2. Loads the Apache-licensed checkpoint weights manually.
3. Runs a single bounded inference on the repo's og-image.png at 1024px.
4. Writes an exact receipt JSON + torch tensors.

Kept under 20 GiB experiment limit; GPU budget is a single forward pass.
"""
import json
import sys
import time
import platform
import traceback

import torch
from PIL import Image

sys.path.insert(0, "/workspace/slava/map-anything")
sys.path.insert(0, "/workspace/slava/world-builder/sources/dinov2")

WEIGHTS_DIR = "/workspace/slava/models/map-anything-apache/00f9c245bbcb60522d1ed7f9e9d88462c6e3f38a"
IMAGE = "/workspace/slava/the-brain/brainsnn-r3f-app/public/og-image.png"
OUT_DIR = "/workspace/slava/the-brain/robotics/experiments"

RECEIPT = {
    "run": 115,
    "host": "4090-vast",
    "hostname": None,
    "gpu": None,
    "python": sys.version.split()[0],
    "torch": torch.__version__,
    "cuda_available": torch.cuda.is_available(),
    "device": "cuda:0" if torch.cuda.is_available() else "cpu",
    "source": {
        "mapanything": "/workspace/slava/map-anything",
        "mapanything_rev": "4b371c4e",
        "dinov2_rev": "7764ea0f",
        "weights": WEIGHTS_DIR,
    },
    "image": IMAGE,
    "steps": {},
    "outputs": {},
    "status": "failed",
    "error": None,
}

try:
    RECEIPT["hostname"] = platform.node()
    RECEIPT["gpu"] = torch.cuda.get_device_name(0)

    # Load config + build model WITHOUT going through HF from_pretrained
    print("building model from config...", flush=True)
    t0 = time.monotonic()
    from mapanything.models import MapAnything

    cfg_path = None
    for name in ("model_config.json", "config.json"):
        p = f"{WEIGHTS_DIR}/{name}"
        try:
            import os
            if os.path.exists(p):
                cfg_path = p
                break
        except Exception:
            pass
    assert cfg_path is not None, f"no config found in {WEIGHTS_DIR}"
    with open(cfg_path) as f:
        cfg = json.load(f)
    cfg["name"] = cfg.get("name", "MapAnything")
    m = MapAnything(
        name=cfg["name"],
        encoder_config=cfg["encoder_config"],
        info_sharing_config=cfg["info_sharing_config"],
        pred_head_config=cfg["pred_head_config"],
        geometric_input_config=cfg["geometric_input_config"],
    )
    RECEIPT["steps"]["build_s"] = round(time.monotonic() - t0, 2)
    print("built", flush=True)

    # Load weights manually
    t0 = time.monotonic()
    state_path = None
    for name in ("model.safetensors", "pytorch_model.bin", "model.pt"):
        import os
        p = f"{WEIGHTS_DIR}/{name}"
        if os.path.exists(p):
            state_path = p
            break
    assert state_path is not None, f"no weights file in {WEIGHTS_DIR}"
    RECEIPT["outputs"]["weights_file"] = state_path
    if state_path.endswith(".safetensors"):
        from safetensors.torch import load_file
        sd = load_file(state_path)
    else:
        sd = torch.load(state_path, map_location="cpu")
    missing, unexpected = m.load_state_dict(sd, strict=False)
    RECEIPT["outputs"]["missing_keys"] = len(missing)
    RECEIPT["outputs"]["unexpected_keys"] = len(unexpected)
    m = m.to("cuda:0").half().eval()
    RECEIPT["steps"]["load_s"] = round(time.monotonic() - t0, 2)
    print(f"loaded ({len(missing)} missing / {len(unexpected)} unexpected)", flush=True)

    img = Image.open(IMAGE).convert("RGB")
    w0, h0 = img.size
    h = 1024
    w = max(1, round(w0 * (h / h0)))
    img = img.resize((w, h), Image.BICUBIC)

    import torchvision.transforms.v2 as T

    x = (
        T.Compose(
            [
                T.ToImage(),
                T.Resize(h, antialias=True),
                T.ToDtype(torch.float32, scale=True),
                T.Normalize(mean=(0.485, 0.456, 0.406), std=(0.229, 0.224, 0.225)),
                T.ToDtype(torch.float16, scale=False),
            ]
        )
        (img)
        .unsqueeze(0)
        .to("cuda:0")
    )
    x = x.repeat(1, 2, 1, 1)
    print("input shape:", tuple(x.shape), "norm: ImageNet", flush=True)

    print("inferring...", flush=True)
    t0 = time.monotonic()
    with torch.inference_mode(), torch.autocast("cuda:0", dtype=torch.float16):
        pred = m.infer(views=x, data_norm_type="imagenet")
    RECEIPT["steps"]["infer_s"] = round(time.monotonic() - t0, 2)

    pts = pred.get("pts3d_in_camera")
    if pts is None:
        pts = pred["points"]
    pts = pts[0]
    n = pts.shape[0]
    RECEIPT["outputs"]["pts3d_in_camera"] = {
        "num_points": n,
        "dtype": str(pts.dtype),
        "sample": pts[:5].tolist(),
    }

    import os
    os.makedirs(OUT_DIR, exist_ok=True)
    torch.save(
        {k: v for k, v in pred.items() if torch.is_tensor(v)},
        f"{OUT_DIR}/mappy_og_image_pred_run115.pt",
    )
    RECEIPT["outputs"]["pred_saved"] = f"{OUT_DIR}/mappy_og_image_pred_run115.pt"
    RECEIPT["status"] = "success"
    print("OK", flush=True)
except Exception as e:
    RECEIPT["error"] = f"{type(e).__name__}: {e}"
    RECEIPT["tb"] = traceback.format_exc(limit=8)
    print("FAIL", flush=True)

with open(f"{OUT_DIR}/mappy_og_image_receipt_run115.json", "w") as f:
    json.dump(RECEIPT, f, indent=2, default=str)
print(json.dumps({k: RECEIPT[k] for k in ("status", "steps", "error")}), flush=True)
