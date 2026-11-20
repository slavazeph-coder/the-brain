"""Bound achievable centre-pixel IoU before independent masks are available."""
import argparse
import json
from pathlib import Path
import subprocess
import sys

import numpy as np
from evaluate_appearance import BRIDGE, cameras, require, visible_samples


def rectangle(region, width, height):
    require(isinstance(region, list) and len(region) == 4 and all(type(x) is int for x in region),
            'Each rectangle needs four integer pixel edges.')
    left, top, right, bottom = region
    require(0 <= left < right <= width and 0 <= top < bottom <= height,
            'Rectangle falls outside the camera raster or has zero area.')
    return left, top, right, bottom


def bound(unique_pixels, view, regions):
    width, height = view['width'], view['height']
    require(isinstance(regions, dict) and set(regions) == {'interior', 'envelope'},
            'Declare an interior and an envelope.')
    left, top, right, bottom = rectangle(regions['interior'], width, height)
    x0, y0, x1, y1 = rectangle(regions['envelope'], width, height)
    require(x0 <= left and right <= x1 and y0 <= top and bottom <= y1,
            'The envelope must contain the interior.')
    y, x = np.divmod(unique_pixels, width)
    interior_area = (right - left) * (bottom - top)
    interior_hits = int(np.count_nonzero((left <= x) & (x < right) & (top <= y) & (y < bottom)))
    envelope_hits = int(np.count_nonzero((x0 <= x) & (x < x1) & (y0 <= y) & (y < y1)))
    misses = interior_area - interior_hits
    return {'frameId': view['frame_id'], 'imageSha256': view['image_sha256'],
            'interiorPixels': interior_area, 'interiorHits': interior_hits, 'envelopeHits': envelope_hits,
            'visibleSourcePixels': len(x), 'iouUpperBound': envelope_hits / (envelope_hits + misses),
            'interiorOnlyUpperBound': len(x) / (len(x) + misses)}


def coverage(job, spec_path):
    job = cameras._root(job)
    spec_hash = cameras._digest(spec_path)
    spec = cameras._read_json(spec_path)
    require(isinstance(spec, dict) and set(spec) == {'cameraLedgerSha256', 'cameraCloudSha256', 'regions'},
            'Invalid coverage specification.')
    cloud_hash = spec['cameraCloudSha256']
    cameras._sha(cloud_hash)
    ledger_hash = spec['cameraLedgerSha256']
    cameras._sha(ledger_hash)
    ledger = cameras._path(job, 'output/camera-frames.json')
    require(cameras._digest(ledger) == ledger_hash, 'Frozen camera ledger hash mismatch.')
    regions = spec['regions']
    require(isinstance(regions, dict) and 1 <= len(regions) <= cameras.MAX_FRAMES, 'Invalid frame regions.')
    for frame_id in regions:
        cameras._sha(frame_id)
    views = cameras.load_views(job, cloud_hash, ledger_path=ledger, frame_ids=regions)
    cloud = job / views[0]['source_cloud_name']
    proc = subprocess.run(['node', str(BRIDGE), '--ledger-centres', str(cloud), cloud_hash],
                          capture_output=True, text=True, check=False)
    require(proc.returncode == 0, proc.stderr.strip() or 'Cannot parse cloud.')
    xyz = np.asarray(json.loads(proc.stdout), dtype=float)
    frames = []
    for view in views:
        pixels, _, _ = visible_samples(xyz, view)
        frames.append(bound(pixels, view, regions[view['frame_id']]))
    require(cameras._digest(cloud) == cloud_hash and cameras._digest(ledger) == ledger_hash
            and cameras._digest(spec_path) == spec_hash, 'Coverage inputs changed during evaluation.')
    return {'kind': 'conditional-source-coverage', 'sourceSha256': cloud_hash,
            'cameraLedgerSha256': ledger_hash, 'regionsSha256': spec_hash, 'retained': len(xyz),
            'originalSourcePreserved': True, 'frames': frames}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--job', required=True, type=Path)
    parser.add_argument('--regions', required=True, type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(coverage(args.job, args.regions), indent=2, allow_nan=False))
    except (OSError, ValueError, TypeError, KeyError) as error:
        sys.exit(f'Coverage refused: {error}')
