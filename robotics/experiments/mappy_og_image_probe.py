import json
import sys
import time

import torch
from PIL import Image

sys.path.insert(0, "/workspace/slava/map-anything")
sys.path.insert(0, "/workspace/slava/world-builder/sources/dinov2")

RECEIPT = {
    "run": 71,
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
        "weights": "/workspace/slava/models/map-anything-apache/00f9c245bbcb60522d1ed7f9e9d88462c6e3f38a",
    },
    "image": "/workspace/slava/the-brain/brainsnn-r3f-app/public/og-image.png",
    "steps": {},
    "outputs": {},
    "status": "failed",
    "error": None,
}

try:
    import platform
    RECEIPT["hostname"] = platform.node()
    RECEIPT["gpu"] = torch.cuda.get_device_name(0)

    print("loading model...", flush=True)
    t0 = time.monotonic()
    from mapanything.models import MapAnything

    import gc
    gc.collect(); torch.cuda.empty_cache()
    m = MapAnything.from_pretrained(RECEIPT["source"]["weights"], low_cpu_mem_usage=True, torch_dtype=torch.float16)
    m = m.half().to(RECEIPT["device"]).eval()
    RECEIPT["steps"]["load_s"] = round(time.monotonic() - t0, 2)
    print("loaded", flush=True)

    img = Image.open(RECEIPT["image"]).convert("RGB")
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
        .to(RECEIPT["device"])
    )
    x = x.repeat(1, 2, 1, 1)
    print("input shape:", tuple(x.shape), "norm: ImageNet", flush=True)

    print("inferring...", flush=True)
    t0 = time.monotonic()
    with torch.inference_mode(), torch.autocast(RECEIPT["device"], dtype=torch.float16):
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

    os.makedirs("/workspace/slava/the-brain/robotics/experiments", exist_ok=True)
    torch.save(
        {k: v for k, v in pred.items() if torch.is_tensor(v)},
        "/workspace/slava/the-brain/robotics/experiments/mappy_og_image_pred.pt",
    )
    RECEIPT["outputs"]["pred_saved"] = "/workspace/slava/the-brain/robotics/experiments/mappy_og_image_pred.pt"
    RECEIPT["status"] = "success"
    print("OK", flush=True)
except Exception as e:
    import traceback

    RECEIPT["error"] = f"{type(e).__name__}: {e}"
    RECEIPT["tb"] = traceback.format_exc(limit=8)
    print("FAIL", flush=True)

with open("/workspace/slava/the-brain/robotics/experiments/mappy_og_image_receipt.json", "w") as f:
    json.dump(RECEIPT, f, indent=2, default=str)
print(json.dumps({k: RECEIPT[k] for k in ("status", "steps", "error")}), flush=True)
