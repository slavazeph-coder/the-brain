"""
FastAPI server wrapping TRIBE v2 inference for BrainSNN.
Accepts video/audio/text uploads, returns region-mapped brain predictions.
"""

import json
import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

app = FastAPI(title="BrainSNN TRIBE v2 Server", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Lazy-loaded model
_model = None
_plotter = None

SCENARIOS_DIR = Path(__file__).parent / "scenarios"
LINKS = [
    ["THL", "CTX"], ["CTX", "HPC"], ["HPC", "CTX"], ["CTX", "PFC"],
    ["PFC", "CTX"], ["CTX", "AMY"], ["AMY", "BG"], ["BG", "THL"],
    ["CBL", "CTX"], ["PFC", "HPC"],
]


def get_model():
    global _model
    if _model is None:
        from tribev2.demo_utils import TribeModel
        cache = Path("./cache")
        cache.mkdir(exist_ok=True)
        _model = TribeModel.from_pretrained("facebook/tribev2", cache_folder=cache)
    return _model


def run_inference(file_path: str, modality: str):
    """Run TRIBE v2 inference and map to BrainSNN regions."""
    from region_mapper import map_predictions_to_regions, compute_flows

    model = get_model()

    kwargs = {}
    if modality == "video":
        kwargs["video_path"] = file_path
    elif modality == "audio":
        kwargs["audio_path"] = file_path
    elif modality == "text":
        kwargs["text_path"] = file_path

    df = model.get_events_dataframe(**kwargs)
    preds, segments = model.predict(events=df)

    # Load parcellation from nilearn
    import numpy as np
    from nilearn.datasets import fetch_atlas_surf_destrieux, load_fsaverage

    atlas = fetch_atlas_surf_destrieux()
    labels = [str(l) for l in atlas["labels"]]

    # Combine left + right hemisphere parcellations
    parc_left = np.array(atlas["map_left"])
    parc_right = np.array(atlas["map_right"])
    parcellation = np.concatenate([parc_left, parc_right])

    # Map to 7 regions
    frames = map_predictions_to_regions(preds, parcellation, labels)
    flows = compute_flows(frames, LINKS)

    result_frames = []
    for i, (regions, flow) in enumerate(zip(frames, flows)):
        result_frames.append({
            "t": i,
            "regions": regions,
            "flows": flow
        })

    return result_frames, preds.shape[0]


@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": _model is not None}


@app.get("/scenarios")
async def list_scenarios():
    """List available pre-computed scenarios."""
    scenarios = []
    if SCENARIOS_DIR.exists():
        for f in sorted(SCENARIOS_DIR.glob("*.json")):
            scenarios.append({
                "name": f.stem,
                "file": f.name
            })
    return {"scenarios": scenarios}


@app.get("/scenarios/{name}")
async def get_scenario(name: str):
    """Load a pre-computed scenario."""
    path = SCENARIOS_DIR / f"{name}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Scenario '{name}' not found")
    with open(path) as f:
        data = json.load(f)
    return data


@app.post("/predict")
async def predict(
    file: UploadFile = File(...),
    modality: str = Query("video", regex="^(video|audio|text)$")
):
    """
    Run TRIBE v2 inference on an uploaded file.
    Returns region-mapped timeseries with flow data.
    """
    suffix_map = {
        "video": ".mp4",
        "audio": ".wav",
        "text": ".txt"
    }
    suffix = suffix_map.get(modality, ".bin")

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        frames, duration = run_inference(tmp_path, modality)
        return {
            "frames": frames,
            "meta": {
                "duration": duration,
                "fps": 1,
                "source": modality,
                "filename": file.filename
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        os.unlink(tmp_path)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8642)
