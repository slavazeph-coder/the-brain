"""Optional photo-to-relative-depth adapter using a locally installed HF snapshot.

This produces a coloured point cloud, NOT a trained Gaussian splat. Its lens and
scale are explicit visual assumptions. No network model download is performed.
"""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
try:
    from .geometry import write_point_cloud
except ImportError:
    from geometry import write_point_cloud


def lift_depth(rgb, predicted_depth):
    import numpy as np
    if (rgb.ndim != 3 or rgb.shape[2] != 3 or not 1 <= rgb.shape[0] * rgb.shape[1] <= 200_000
            or predicted_depth.shape != rgb.shape[:2] or not np.isfinite(predicted_depth).all()
            or not np.isfinite(rgb).all() or np.any(rgb < 0) or np.any(rgb > 255)):
        raise ValueError('Invalid predicted depth shape or values.')
    lo, hi = np.percentile(predicted_depth, [2, 98])
    norm = np.clip((predicted_depth-lo)/max(float(hi-lo),1e-6),0,1)
    # Relative inverse-depth normalization is a display convention, not metres.
    z = 1.0/(.25+.75*norm)
    height,width = z.shape
    y,x = np.mgrid[0:height,0:width]
    focal = width/(2*np.tan(np.deg2rad(60)/2))
    points = np.stack([(x-(width-1)/2)*z/focal, -(y-(height-1)/2)*z/focal, -z],axis=-1)
    return points.reshape(-1,3),rgb.reshape(-1,3)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--input-manifest',required=True);args=parser.parse_args()
    request=json.loads(Path(args.input_manifest).read_text())
    if len(request.get('inputs',[]))!=1 or request['inputs'][0]['kind']!='image':raise ValueError('This adapter requires exactly one image.')
    model_dir=Path(os.environ.get('WORLD_DEPTH_MODEL_DIR',''))
    if not os.environ.get('WORLD_DEPTH_MODEL_DIR') or not model_dir.is_dir():raise RuntimeError('Install and pin the Apache-2.0 Depth Anything V2 Small HF snapshot; set WORLD_DEPTH_MODEL_DIR.')
    import numpy as np
    import torch
    from PIL import Image, ImageOps
    from transformers import AutoImageProcessor, AutoModelForDepthEstimation
    Image.MAX_IMAGE_PIXELS=24_000_000
    with Image.open(request['inputs'][0]['path']) as source:
        if source.width*source.height>24_000_000:raise ValueError('Image exceeds the 24-megapixel decode budget.')
        image=ImageOps.exif_transpose(source).convert('RGB');image.thumbnail((256,256))
    processor=AutoImageProcessor.from_pretrained(str(model_dir),local_files_only=True,trust_remote_code=False)
    model=AutoModelForDepthEstimation.from_pretrained(str(model_dir),local_files_only=True,trust_remote_code=False,use_safetensors=True)
    device='cuda' if torch.cuda.is_available() else 'cpu';model.to(device).eval()
    with torch.inference_mode():
        outputs=model(**processor(images=image,return_tensors='pt').to(device))
        prediction=torch.nn.functional.interpolate(outputs.predicted_depth.unsqueeze(1),size=(image.height,image.width),mode='bicubic',align_corners=False)[0,0].float().cpu().numpy()
    points,colours=lift_depth(np.array(image),prediction)
    out=Path(request['output_dir']);out.mkdir(parents=True,exist_ok=True)
    visual=write_point_cloud(out/'relative-depth.ply',points,colours,coordinate_frame='right-handed-y-up')
    (out/'depth-evidence.json').write_text(json.dumps({'model':'depth-anything/Depth-Anything-V2-Small-hf','local_snapshot':model_dir.name,'device':device,'metric_verified':False,'representation':'relative-depth point cloud; not a trained splat','assumed_horizontal_fov_degrees':60,'unobserved_regions':'not reconstructed','source_dimensions':[image.width,image.height]},indent=2))
    (out/'manifest.json').write_text(json.dumps({'artifacts':[visual,{'name':'depth-evidence.json','kind':'evidence'}]}))

if __name__=='__main__':main()
