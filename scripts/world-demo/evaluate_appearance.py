"""Score reviewed World Builder membership in frozen source-camera frames. Offline, CPU-only."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from robotics.world_worker import camera_frames as cameras
from robotics.world_worker.object_names import project

SCHEMA = 'brainsnn.appearance-holdout.v1'
BRIDGE = Path(__file__).with_name('appearance_membership.mjs')


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def checked_labels(path):
    # Use the camera reader's bounded, duplicate-key rejecting JSON contract.
    labels = cameras._read_json(path)
    fields = {'schema', 'captureKind', 'sourceSha256', 'cameraCloudSha256', 'cameraLedger',
              'target', 'selectionOperator', 'labelReviewer', 'reviewProtocol', 'selectionFrameIds', 'frames'}
    require(set(labels) == fields and labels['schema'] == SCHEMA, 'Invalid held-out label manifest.')
    require(labels['captureKind'] in ('real-phone', 'authored-fixture'), 'Declare the capture origin.')
    require(labels['reviewProtocol'] == 'blind-image-labels-held-out-from-selection-and-tuning',
            'Declare the independent label and selection protocol.')
    for field in ('target', 'selectionOperator', 'labelReviewer'):
        cameras._text(labels[field], field, 120)
    require(labels['selectionOperator'].strip().casefold() != labels['labelReviewer'].strip().casefold(),
            'A separate reviewer must label the held-out images.')
    for field in ('sourceSha256', 'cameraCloudSha256'):
        cameras._sha(labels[field])
    ledger = labels['cameraLedger']
    require(isinstance(ledger, dict) and set(ledger) == {'name', 'sha256'}, 'Invalid ledger binding.')
    cameras._sha(ledger['sha256'])
    frames = labels['frames']
    require(isinstance(frames, list) and 2 <= len(frames) <= cameras.MAX_FRAMES, 'Use at least two held-out views.')
    for frame in frames:
        require(isinstance(frame, dict) and set(frame) == {'frameId', 'mask', 'maskSha256'}, 'Invalid mask binding.')
        cameras._sha(frame['frameId'])
        cameras._sha(frame['maskSha256'])
    held = {f['frameId'] for f in frames}
    used = labels['selectionFrameIds']
    require(isinstance(used, list) and len(used) <= cameras.MAX_FRAMES, 'Invalid selection frame list.')
    for frame_id in used:
        cameras._sha(frame_id)
    require(len(held) == len(frames) and len(set(used)) == len(used) and held.isdisjoint(used),
            'Duplicate frame or overlap with selection views.')
    return labels


def load_mask(job, binding, view):
    path = cameras._path(job, binding['mask'])
    require(path.stat().st_size <= cameras.MAX_FILE_BYTES, 'Label mask exceeds the image budget.')
    data = path.read_bytes()
    require(hashlib.sha256(data).hexdigest() == binding['maskSha256'], 'Label mask hash mismatch.')
    with Image.open(io.BytesIO(data), formats=['PNG']) as image:
        require(image.size == (view['width'], view['height']) and image.mode == 'L' and image.n_frames == 1,
                'Mask must be a single 8-bit grayscale PNG in the exact camera raster.')
        mask = np.asarray(image)
    require(np.isin(mask, (0, 1, 2, 255)).all(), 'Mask has undefined labels.')
    require((mask == 1).any() and (mask == 2).any(), 'Choose views with labelled target and visible floor.')
    return mask


def visible_samples(xyz, view):
    # The worker projector applies the true radial lens and pixel-centre convention.
    uv, depth = project(view, xyz)
    width, height = view['width'], view['height']
    inside = ((uv[:, 0] >= -.5) & (uv[:, 0] < width - .5) &
              (uv[:, 1] >= -.5) & (uv[:, 1] < height - .5))
    indices = np.flatnonzero(inside)
    pixels = np.floor(uv[indices] + .5).astype(np.int64)
    flat = pixels[:, 1] * width + pixels[:, 0]
    # Primary key: raster pixel. Nearest positive Z wins. Source indices are
    # strictly increasing in preview order, so a depth tie uses the lower source ID.
    order = np.lexsort((indices, depth[indices], flat))
    unique_pixels, first = np.unique(flat[order], return_index=True)
    winners = indices[order[first]]
    return unique_pixels, winners, indices


def score_view(xyz, selected, view, mask):
    unique_pixels, winners, indices = visible_samples(xyz, view)
    truth = mask.ravel()[unique_pixels]
    predicted = selected[winners] & (truth != 255)
    tp = int(np.count_nonzero(predicted & (truth == 1)))
    floor = int(np.count_nonzero(predicted & (truth == 2)))
    predicted_count = int(predicted.sum())
    labelled = int(np.count_nonzero(mask == 1))
    supported = int(np.count_nonzero(truth == 1))
    fp = predicted_count - tp
    union = labelled + fp
    return {
        'referencePixels': labelled, 'predictedPixels': predicted_count,
        'intersection': tp, 'union': union, 'falsePositive': fp, 'falseNegative': labelled - tp,
        'floorPixelsPredicted': floor, 'otherBackgroundPixelsPredicted': fp - floor,
        'referencePixelsWithoutSourceCentre': labelled - supported,
        'referencePixelsWithUnselectedWinner': supported - tp,
        'ignoredPredictedPixels': int(np.count_nonzero(selected[winners] & (truth == 255))),
        'selectedInFrustum': int(selected[indices].sum()),
        'selectedLosingDepthTest': int(selected[indices].sum() - selected[winners].sum()),
        'iou': tp / union, 'iouCeilingFromSampleCoverage': supported / labelled,
        'floorContamination': floor / predicted_count if predicted_count else None,
        'meetsTargets': bool(predicted_count and 100 * tp >= 85 * union and 100 * floor < predicted_count),
    }


def evaluate(job, labels_path, source, edits, variant, receipt, object_id):
    job = cameras._root(job)
    require(labels_path.is_file() and 0 < labels_path.stat().st_size <= cameras.MAX_BYTES, 'Invalid label manifest size.')
    label_sha = cameras._digest(labels_path)
    labels = checked_labels(labels_path)
    require(source.is_file() and 0 < source.stat().st_size <= cameras.MAX_FILE_BYTES, 'Invalid source file size.')
    original = cameras._digest(source)
    require(original == labels['sourceSha256'], 'Source SHA-256 differs from the frozen label manifest.')
    held = [f['frameId'] for f in labels['frames']]
    binding = labels['cameraLedger']
    ledger = cameras._path(job, binding['name'])
    require(cameras._digest(ledger) == binding['sha256'], 'Frozen camera ledger hash mismatch.')
    # Frame IDs bind image + camera + pose. Check raster identity too, so a
    # duplicate image under a changed pose cannot leak across the split.
    record = cameras._read_json(ledger)
    cameras.validate(record, expected_cloud_sha256=labels['cameraCloudSha256'])
    frame_map = {f['frame_id']: f for f in record['frames']}
    used = labels['selectionFrameIds']
    require(set(held + used) <= frame_map.keys(), 'Declared frame ID missing from camera ledger.')
    held_images = {frame_map[f]['image']['sha256'] for f in held}
    require(len(held_images) == len(held) and held_images.isdisjoint(frame_map[f]['image']['sha256'] for f in used),
            'Duplicate raster or raster reused across the holdout split.')
    poses = {tuple(v for row in frame_map[f]['cam_from_world'] for v in row) for f in held}
    require(len(poses) >= 2, 'Two distinct held-out camera poses are required.')
    views = cameras.load_views(job, labels['cameraCloudSha256'], ledger_path=ledger, frame_ids=held)
    by_id = {v['frame_id']: v for v in views}
    require(all(v['ledger_sha256'] == binding['sha256'] for v in views), 'Camera ledger changed.')
    cloud = job / views[0]['source_cloud_name']
    process = subprocess.run(['node', str(BRIDGE), str(source), str(edits), str(variant), str(receipt),
                              object_id, str(cloud), labels['cameraCloudSha256']], capture_output=True, check=False)
    require(process.returncode == 0, process.stderr.decode(errors='replace').strip() or 'Workshop replay failed.')
    membership = json.loads(process.stdout)
    evidence = membership['evidence']
    require(evidence['source']['sha256'] == original, 'Replayed source hash mismatch.')
    xyz = np.asarray(membership['xyz'], dtype=float)
    selected = np.zeros(len(xyz), dtype=bool)
    selected[membership['indices']] = True
    frames = []
    for entry in labels['frames']:
        view = by_id[entry['frameId']]
        scores = score_view(xyz, selected, view, load_mask(job, entry, view))
        frames.append({'frameId': entry['frameId'], 'imageSha256': view['image_sha256'],
                       'maskSha256': entry['maskSha256'], **scores})
    after = cameras._digest(source)
    require(after == original, 'Original source changed during evaluation.')
    require(cameras._digest(labels_path) == label_sha and cameras._digest(ledger) == binding['sha256'], 'Evaluation inputs changed.')
    return {
        'schema': 'brainsnn.appearance-holdout-result.v1', 'captureKindDeclared': labels['captureKind'],
        'target': labels['target'], 'reviewProtocolDeclared': labels['reviewProtocol'], 'selectionOperator': labels['selectionOperator'],
        'labelReviewer': labels['labelReviewer'], 'labelsSha256': label_sha, 'cameraLedgerSha256': binding['sha256'],
        'cameraCloudSha256': labels['cameraCloudSha256'], 'sourceSha256Before': original, 'sourceSha256After': after,
        'originalSourcePreserved': True, 'membership': evidence, 'frames': frames,
        'projection': 'original-retained-centres/nearest-pixel/all-retained-z-buffer/source-id-tie',
        'targets': {'minIoUInclusive': .85, 'maxFloorContaminationExclusive': .01, 'scope': 'each-frame'},
        'allFramesMeetTargets': all(f['meetsTargets'] for f in frames),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ('job', 'labels', 'source', 'edits', 'variant', 'receipt'):
        parser.add_argument('--' + flag, required=True, type=Path)
    parser.add_argument('--object', required=True, dest='object_id')
    parser.add_argument('--out', type=Path, help='Create a new JSON file. Default: stdout.')
    args = parser.parse_args()
    try:
        report = evaluate(args.job, args.labels, args.source, args.edits, args.variant, args.receipt, args.object_id)
        text = json.dumps(report, indent=2, allow_nan=False) + '\n'
        if args.out:
            with args.out.open('x', encoding='utf-8') as stream:
                stream.write(text)
        else:
            sys.stdout.write(text)
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(f'Evaluation refused: {error}', file=sys.stderr)
        return 2
    return 0 if report['allFramesMeetTargets'] else 1


if __name__ == '__main__':
    sys.exit(main())
