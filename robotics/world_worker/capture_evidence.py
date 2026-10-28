"""Offline source-bound capture validation and conservative wall evidence.

ARKit poses remain estimates, not surveyed calibration. Two reconstructed
surfaces provide a thickness candidate, never proof of physical wall structure.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import numpy as np
try:
    from .simready_bridge import file_hash, local, read_json
except ImportError:
    from simready_bridge import file_hash, local, read_json


def validate_bundle(bundle, root, *, image_paths=None):
    """Validate a proposed native capture bundle without extracting archives."""
    if not isinstance(bundle, dict) or bundle.get('schema') != 'brainsnn.capture.v1' or bundle.get('pose_convention') != 'arkit-camera-to-world':
        raise ValueError('Expected brainsnn.capture.v1 with explicit ARKit camera-to-world poses.')
    if bundle.get('units') != 'm' or bundle.get('pixel_convention') != 'integer-centres':
        raise ValueError('Capture units and pixel convention must be explicit.')
    frames = bundle.get('frames')
    if not isinstance(frames, list) or not 3 <= len(frames) <= 3000:
        raise ValueError('A bundle needs 3 to 3000 frames.')
    from PIL import Image
    last, ids, paths, records, usable, total = -float('inf'), set(), set(), [], 0, 0
    for frame in frames:
        if not isinstance(frame, dict):
            raise ValueError('Each frame must be an object.')
        name = frame.get('id')
        if not isinstance(name, str) or not name or len(name) > 100 or name in ids:
            raise ValueError('Frame ids must be unique bounded strings.')
        ids.add(name)
        stamp = frame.get('timestamp_seconds')
        if type(stamp) not in (float, int) or not np.isfinite(stamp) or stamp < 0 or stamp <= last:
            raise ValueError('Original timestamps must be finite, nonnegative and strictly increasing.')
        last = stamp
        relative = frame.get('image')
        if image_paths is None:
            image = local(root, relative)
        else:
            # The worker maps exact uploaded names to owner-authorized files. Never
            # resolve any bundle-supplied path against the worker filesystem.
            if not isinstance(relative, str) or relative not in image_paths:
                raise ValueError('Capture frame has no exact uploaded source.')
            image = Path(image_paths[relative])
            if image.is_symlink() or not image.is_file():
                raise ValueError('Capture source must be a regular uploaded file.')
        if image in paths or Path(relative).suffix.lower() not in ('.jpg', '.jpeg', '.png'):
            raise ValueError('Each frame needs its own JPEG or PNG.')
        paths.add(image)
        total += image.stat().st_size
        if total > 2 * 1024**3 or image.stat().st_size > 64 * 1024**2:
            raise ValueError('Capture exceeds the bounded import profile.')
        digest = file_hash(image)
        if digest != frame.get('image_sha256'):
            raise ValueError('Frame bytes do not match their capture hash.')
        with Image.open(image) as im:
            width, height = im.size
            if width * height > 24_000_000 or width < 256 or height < 256:
                raise ValueError('Capture resolution is outside the supported profile.')
            if im.format not in ('JPEG', 'PNG'):
                raise ValueError('Native capture requires original JPEG/PNG rasters.')
            im.verify()
        with Image.open(image) as im:
            if im.getexif().get(274, 1) != 1:
                raise ValueError('Native capture requires original upright rasters (EXIF orientation 1).')
        if [width, height] != frame.get('image_size'):
            raise ValueError('Image dimensions disagree with recorded calibration.')
        K = np.asarray(frame.get('intrinsics'), dtype=float)
        T = np.asarray(frame.get('camera_to_world'), dtype=float)
        if K.shape != (3, 3) or T.shape != (4, 4) or not np.isfinite(K).all() or not np.isfinite(T).all():
            raise ValueError('Invalid camera matrices.')
        if K[0,0] <= 0 or K[1,1] <= 0 or not np.allclose(K[2], [0,0,1]) or abs(K[1,0]) > 1e-8 or abs(K[0,1]) > 1e-8:
            raise ValueError('Invalid intrinsic calibration.')
        if any(key in frame or key in bundle for key in ('distortion', 'distortion_coefficients', 'lens_distortion')):
            raise ValueError('Lens distortion is not supported by capture.v1; do not silently discard it.')
        if not (0 <= K[0,2] < width and 0 <= K[1,2] < height):
            raise ValueError('Principal point lies outside the original raster.')
        R = T[:3,:3]
        if not np.allclose(T[3], [0,0,0,1], atol=1e-6) or not np.allclose(R.T @ R, np.eye(3), atol=1e-4) or not np.isclose(np.linalg.det(R), 1, atol=1e-4):
            raise ValueError('Camera pose must be a rigid right-handed transform.')
        tracking = frame.get('tracking_state')
        if tracking not in ('normal', 'limited', 'not-available'):
            raise ValueError('Unknown tracking state.')
        usable += tracking == 'normal'
        # ARKit x-right, y-up, -z-forward -> COLMAP x-right, y-down, +z-forward.
        rotation = np.diag([1., -1., -1.]) @ R.T
        translation = -rotation @ T[:3,3]
        records.append({'id': name, 'image': frame['image'], 'image_sha256': digest,
                        'image_size': [width, height],
                        'timestamp_seconds': stamp, 'tracking_state': tracking,
                        'world_to_colmap_camera': np.column_stack((rotation, translation)).tolist(),
                        'intrinsics_integer_centres': K.tolist(), 'pose_is_prior': True})
    if usable < 3:
        raise ValueError('Fewer than three normally tracked frames.')
    return {'schema': 'brainsnn.capture-evidence.v1', 'frames': records, 'normal_tracking_frames': usable,
            'bytes': total, 'metric_verified': False, 'poses_refined': False,
            'reconstruction_executed': False,
            'limitations': ['Estimated poses require geometric refinement and independent dimensional checks.',
                            'This validator is not a native capture app or a reconstruction adapter.']}


def wall_candidate(points, origin, normal, along, *, cell_m=.25):
    """Find two separated supported surface modes in a reviewed wall subset.

    The returned thickness is finish-face separation in reconstructed coordinates.
    No camera observations or independent dimensions are available here. A single
    broad noisy face is therefore never labeled a measured two-sided wall.
    """
    P, o, n, a = (np.asarray(x, dtype=float) for x in (points, origin, normal, along))
    if P.ndim != 2 or P.shape[1] != 3 or not 60 <= len(P) <= 200000 or any(x.shape != (3,) for x in (o,n,a)):
        raise ValueError('Invalid bounded wall subset or frame.')
    if not all(np.isfinite(x).all() for x in (P,o,n,a)) or not np.isfinite(cell_m) or not .05 <= cell_m <= 1:
        raise ValueError('Non-finite geometry or invalid cell size.')
    if np.linalg.norm(n) < 1e-10 or np.linalg.norm(a) < 1e-10:
        raise ValueError('Zero-length wall axes.')
    n, a = n / np.linalg.norm(n), a / np.linalg.norm(a)
    if abs(n @ a) > 1e-6:
        raise ValueError('Wall axes must be perpendicular.')
    up = np.cross(n, a)
    rel = P-o; offsets, s, z = rel@n, rel@a, rel@up
    base = {'schema': 'brainsnn.wall-evidence.v1', 'status': 'insufficient-evidence',
            'thickness_m': None, 'thickness_source': 'unknown', 'metric_verified': False,
            'physical_two_sides_verified': False, 'support_points': len(P)}
    lo, hi = np.quantile(offsets, [.01,.99])
    if hi-lo < .025 or hi-lo > 1:
        return {**base, 'reason': 'Surface spread is unresolved or outside this wall profile.'}
    bins = np.arange(np.floor(lo/.005)*.005-.01, hi+.015, .005)
    hist, edges = np.histogram(offsets, bins)
    smooth = np.convolve(hist, [1,2,1], 'same')/4
    peaks = [i for i in range(1,len(smooth)-1) if smooth[i] > smooth[i-1] and smooth[i] >= smooth[i+1]]
    pairs = []
    for i in peaks:
        for j in peaks:
            gap=(j-i)*.005
            if not .025 <= gap <= .45 or j <= i+2:
                continue
            weak = min(smooth[i],smooth[j])
            if weak < max(10, .03*len(P)) or np.min(smooth[i+1:j]) > .2*weak:
                continue
            pairs.append((weak,i,j))
    if not pairs:
        return {**base, 'reason': 'No distinct supported surface pair; spread alone is not thickness.'}
    _,i,j=max(pairs)
    centres=(edges[:-1]+edges[1:])/2
    masks=[np.abs(offsets-centres[k]) < .015 for k in (i,j)]
    tables=[]
    for mask in masks:
        cells=np.floor(np.column_stack((s[mask],z[mask]))/cell_m).astype(int)
        groups={}
        for key,value in zip(map(tuple,cells),offsets[mask]):
            groups.setdefault(key,[]).append(float(value))
        tables.append({k:float(np.median(v)) for k,v in groups.items() if len(v)>=3})
    shared=sorted(tables[0].keys() & tables[1].keys())
    coverage=len(shared)/max(1,min(map(len,tables)))
    if len(shared)<6 or coverage<.3:
        return {**base, 'reason': 'Both surface candidates do not overlap in enough local cells.'}
    thickness=np.array([tables[1][k]-tables[0][k] for k in shared])
    return {**base, 'status':'two-surface-candidate', 'thickness_m':float(np.median(thickness)),
            'surface_offsets_m': [float(np.median([table[k] for k in shared])) for table in tables],
            'thickness_source':'paired-reconstructed-surfaces-unverified', 'matched_cells':len(shared),
            'cell_coverage':coverage, 'cell_thickness_p05_p95_m':np.quantile(thickness,[.05,.95]).tolist(),
            'reason':'Candidate finish-face separation only; duplicated surfaces and registration bias require independent review.'}


def main():
    p=argparse.ArgumentParser(description=__doc__.split('\n')[0])
    p.add_argument('--bundle',required=True,type=Path)
    p.add_argument('--root',required=True,type=Path)
    p.add_argument('--out',required=True,type=Path)
    a=p.parse_args()
    result=validate_bundle(read_json(a.bundle),a.root.resolve())
    result['bundle_sha256']=file_hash(a.bundle)
    with a.out.open('x',encoding='utf-8') as f:
        json.dump(result,f,indent=2,allow_nan=False)

if __name__=='__main__':
    main()
