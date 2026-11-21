"""Prepare posed source photographs and evaluate held-out walk frames on the CPU.

prepare never reads held-out images. score runs locally with the private references.
Requires NumPy, Pillow and SciPy. See docs/world-showroom-walk-evaluation.md for the file formats.
"""
import argparse
from contextlib import contextmanager
import hashlib
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
from PIL import Image, ImageDraw
from scipy.spatial.transform import Rotation, Slerp


def require(test, message):
    if not test:
        raise ValueError(message)


def load(path):
    return json.loads(path.read_bytes())


def save(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def filename(value):
    require(isinstance(value, str) and value not in ('', '.', '..') and
            Path(value).name == value and '\\' not in value, 'Expected a simple image filename.')
    return value


@contextmanager
def new_directory(path):
    require(not path.exists(), f'Choose a new output directory: {path}')
    path.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=path.parent) as temporary:
        staging = Path(temporary) / 'output'
        staging.mkdir()
        yield staging
        require(not path.exists(), 'Output directory appeared during evaluation.')
        staging.rename(path)


def read_camera(raw, time):
    frame = filename(raw['image'])
    matrix = np.asarray(raw['world_to_camera'], dtype=float)
    require(matrix.shape == (3, 4) and np.isfinite(matrix).all(), 'Invalid camera transform.')
    r, t = matrix[:, :3], matrix[:, 3]
    require(np.allclose(r.T @ r, np.eye(3), atol=1e-4) and np.isclose(np.linalg.det(r), 1, atol=1e-4),
            'Expected an orthonormal world-to-camera rotation.')
    lens = np.asarray(raw['parameters'], dtype=float)
    require(lens.shape == (3,) and np.isfinite(lens).all() and lens[0] > 0,
            'Only undistorted SIMPLE_PINHOLE [f,cx,cy] is supported.')
    if 'model' in raw:
        require(raw['model'] == 'SIMPLE_PINHOLE', 'Unsupported camera model.')
    w, h = raw['width'], raw['height']
    require(all(type(x) is int and 1 <= x <= 16384 for x in (w, h)), 'Invalid image dimensions.')
    require(np.isfinite(time), 'Invalid timestamp.')
    return dict(id=frame, timeSeconds=time, width=w, height=h, worldToCamera=matrix.tolist(),
                center=(-r.T @ t).tolist(), intrinsics=lens.tolist())


def target_pose(name, time, inputs):
    times = [c['timeSeconds'] for c in inputs]
    k = np.searchsorted(times, time)
    require(0 < k < len(inputs) and time != times[k], 'Every target needs two bracketing source poses.')
    a, b = inputs[k-1:k+1]
    u = (time - times[k-1]) / (times[k] - times[k-1])
    def mix(key):
        return np.array(a[key]) * (1-u) + np.array(b[key]) * u
    rotations = Rotation.from_matrix([np.asarray(c['worldToCamera'])[:, :3] for c in (a, b)])
    r = Slerp([0, 1], rotations)(u).as_matrix()
    center = mix('center')
    return dict(id=filename(name), timeSeconds=time, width=a['width'], height=a['height'],
                center=center.tolist(), intrinsics=mix('intrinsics').tolist(),
                worldToCamera=np.column_stack((r, -r @ center)).tolist(),
                bracketingInputs=[a['id'], b['id']], fraction=float(u))


def prepare(cameras, images, times, holdout_times, out):
    timing, withheld = load(times), load(holdout_times)
    rows = load(cameras)['cameras']
    sources = sorted((read_camera(c, timing[c['image']]['timeSeconds']) for c in rows),
                     key=lambda c: c['timeSeconds'])
    ids = {c['id'] for c in sources}
    require(2 <= len(ids) == len(sources) and ids == set(timing), 'Camera and source timestamp IDs must match.')
    require(len({c['timeSeconds'] for c in sources}) == len(sources), 'Duplicate source time.')
    require(len({(c['width'], c['height']) for c in sources}) == 1, 'Use a consistent source raster size.')
    require(withheld and ids.isdisjoint(withheld), 'Held-out IDs must be separate from the input IDs.')
    targets = sorted((target_pose(name, v['timeSeconds'], sources) for name, v in withheld.items()),
                     key=lambda c: c['timeSeconds'])
    require(len({c['timeSeconds'] for c in targets}) == len(targets), 'Duplicate target time.')
    with new_directory(out) as staging:
        dest = staging / 'images'
        dest.mkdir()
        for c in sources:
            original = images / c['id']
            data = original.read_bytes()
            with Image.open(io.BytesIO(data)) as im:
                require(im.size == (c['width'], c['height']), 'Input image does not match camera dimensions.')
            (dest / c['id']).write_bytes(data)
            c['sha256'] = digest(data)
        save(staging / 'requests.json', dict(schema='brainsnn.walk-requests.v1',
             coordinateSystem='OpenCV world-to-camera, +X right, +Y down, +Z forward',
             cameraModel='undistorted SIMPLE_PINHOLE [f,cx,cy] in original pixel coordinates',
             targetPoseSource='SLERP rotation, linear camera center and intrinsics, by timestamp',
             inputs=sources, targets=targets))


def nearest(target, sources):
    # Normalize translation by the local spacing, keeping the score independent of scan units.
    bracket = [np.array(c['center']) for c in sources if c['id'] in target['bracketingInputs']]
    spacing = max(float(np.linalg.norm(bracket[0] - bracket[1])), 1e-9)
    rt = np.asarray(target['worldToCamera'])[:, :3]
    def distance(c):
        r = np.asarray(c['worldToCamera'])[:, :3]
        angle = Rotation.from_matrix(rt @ r.T).magnitude()
        return np.linalg.norm(np.subtract(c['center'], target['center'])) / spacing + angle / (np.pi/4)
    return min(sources, key=distance)


def raster(path, camera, size, exact=True):
    with Image.open(path) as image:
        w, h = image.size
        # A bounded renderer rounds the shorter output side to a whole pixel.
        if camera['width'] >= camera['height']:
            rounding = abs(h - max(1, w * camera['height'] / camera['width']))
        else:
            rounding = abs(w - max(1, h * camera['width'] / camera['height']))
        require(w * h <= 48_000_000 and rounding <= .5 + 1e-9,
                'Reference and prediction must use the requested camera framing.')
        if exact:
            require((w, h) == (camera['width'], camera['height']), 'Camera and image dimensions differ.')
        return np.asarray(image.convert('RGB').resize(size, Image.Resampling.BOX))


def project(xyz, rgb, camera, size):
    w, h = size
    m = np.asarray(camera['worldToCamera'])
    p = xyz @ m[:, :3].T + m[:, 3]
    indices = np.flatnonzero(p[:, 2] > 1e-7)
    q = p[indices]
    f, cx, cy = camera['intrinsics']
    uv = (q[:, :2] / q[:, 2:] * f + [cx, cy]) * [w/camera['width'], h/camera['height']]
    visible = ((uv >= 0) & (uv < [w, h])).all(axis=1)
    indices = indices[visible]
    pixels = uv[visible].astype(int)
    flat = pixels[:, 1] * w + pixels[:, 0]
    order = np.lexsort((indices, p[indices, 2], flat))
    unique, first = np.unique(flat[order], return_index=True)
    winners = np.full(w*h, -1, dtype=int)
    winners[unique] = indices[order[first]]
    mask = winners.reshape(h, w) >= 0
    result = np.zeros((h, w, 3), dtype=np.uint8)
    result[mask] = rgb[winners[unique]]
    return result, mask, winners.reshape(h, w)


def prediction_files(path, request_hash, targets):
    if path is None:
        return None, {}
    data = load(path)
    require(data.get('schema') == 'brainsnn.walk-predictions.v1' and data.get('requestSha256') == request_hash,
            'Predictions must bind to the exact requests.json digest.')
    method = data.get('method')
    require(isinstance(method, str) and 0 < len(method.strip()) <= 150, 'Name the prediction method.')
    entries = data['targets']
    require(len(entries) == len(targets) and {e['id'] for e in entries} == {t['id'] for t in targets},
            'Submit exactly one prediction per requested target.')
    result = {}
    for row in entries:
        img = path.parent / filename(row['image'])
        require(digest(img.read_bytes()) == row['sha256'], 'Prediction image hash mismatch.')
        mask = None
        require(('mask' in row) == ('maskSha256' in row), 'Each support mask needs a filename and hash.')
        if 'mask' in row:
            mask = path.parent / filename(row['mask'])
            require(digest(mask.read_bytes()) == row['maskSha256'], 'Prediction mask hash mismatch.')
        result[row['id']] = (img, mask)
    return method, result


def load_support(path, image_path, size):
    with Image.open(image_path) as prediction, Image.open(path, formats=['PNG']) as image:
        require(image.size == prediction.size and image.n_frames == 1,
                'The support mask must be a still PNG at the prediction resolution.')
        channels = np.asarray(image.convert('RGBA'))
        require(np.all(channels[:,:,3] == 255) and np.all(channels[:,:,:3] == channels[:,:,:1]) and
                np.isin(channels[:,:,0], (0, 255)).all(), 'Use an opaque black/white support mask.')
        # When downsampling, require full support in the retained comparison pixel.
        return np.asarray(Image.fromarray(channels[:,:,0]).resize(size, Image.Resampling.BOX)) == 255


def mae(truth, image, mask=None):
    error = np.abs(truth.astype(np.int16) - image)
    if mask is not None:
        error = error[mask]
    return round(float(error.mean()), 4) if error.size else None


def region_checks(truth, pictures, winners, annotations, groups):
    # Boxes are normalized half-open [left,top,right,bottom] in the original image.
    h, w = winners.shape
    rows = []
    for a in annotations:
        bounds = np.asarray(a['box'], dtype=float)
        require(bounds.shape == (4,) and np.isfinite(bounds).all() and np.all(bounds >= 0) and
                np.all(bounds <= 1) and np.all(bounds[2:] > bounds[:2]), 'Invalid normalized box.')
        l, t = np.floor(bounds[:2]*[w,h]).astype(int)
        r, b = np.ceil(bounds[2:]*[w,h]).astype(int)
        row = dict(objectId=a['objectId'], rgbMae={k:mae(truth[t:b,l:r], im[t:b,l:r]) for k,im in pictures.items()})
        if groups is not None:
            visible = np.isin(winners, groups[a['objectId']])
            ys, xs = np.nonzero(visible)
            row['visiblePointPixels'] = int(len(xs))
            if len(xs):
                lo = np.percentile([xs, ys], 2, axis=1)
                hi = np.percentile([xs+1, ys+1], 98, axis=1)
                box = bounds * [w,h,w,h]
                common = np.prod(np.maximum(0, np.minimum(box[2:], hi) - np.maximum(box[:2], lo)))
                union = np.prod(box[2:]-box[:2]) + np.prod(hi-lo) - common
                row['visiblePointEnvelopeIoU'] = round(float(common/union), 4)
            else:
                row['visiblePointEnvelopeIoU'] = 0
        rows.append(row)
    return rows


def score(pack, references, cloud, out, predictions=None, annotations=None, groups=None, width=320, cloud_inputs=None):
    require(16 <= width <= 1280, 'Use an evaluation width of 16 to 1280 pixels.')
    request = pack / 'requests.json'
    data = load(request)
    require(data['schema'] == 'brainsnn.walk-requests.v1', 'Invalid walk requests.')
    sources, targets = data['inputs'], data['targets']
    ids = {c['id'] for c in sources}
    held = {t['id'] for t in targets}
    require(2 <= len(ids) == len(sources) and 1 <= len(held) == len(targets) and ids.isdisjoint(held),
            'Use distinct source and held-out frame IDs.')
    lineage = 'Cloud membership was not supplied.'
    if cloud_inputs:
        contributors = load(cloud_inputs)['images']
        require(isinstance(contributors, list) and contributors and set(contributors) <= ids,
                'Cloud provenance declares images outside the conditioning set.')
        lineage = {'receiptSha256':digest(cloud_inputs.read_bytes()), 'declaredInputs':len(set(contributors)),
                   'declaredInputsDisjointFromTargets':True}
    source_hashes = set()
    for c in sources:
        source_hash = digest((pack / 'images' / filename(c['id'])).read_bytes())
        require(source_hash == c['sha256'], 'A source photograph changed after preparation.')
        source_hashes.add(source_hash)
    method, predictions_by_id = prediction_files(predictions, digest(request.read_bytes()), targets)
    archive = np.load(cloud, allow_pickle=False)
    with archive:
        xyz, rgb = archive['xyz'], archive['rgb']
    require(xyz.ndim == 2 and xyz.shape[1] == 3 and xyz.shape == rgb.shape and np.isfinite(xyz).all()
            and rgb.dtype == np.uint8, 'Expected finite Nx3 xyz and matching uint8 RGB.')
    labels = load(annotations) if annotations else []
    target_ids = {t['id'] for t in targets}
    require(all(a['image'] in target_ids for a in labels), 'Labels must belong to held-out views.')
    require(not groups or labels, 'Object memberships require image annotations.')
    memberships = None
    if groups:
        with np.load(groups, allow_pickle=False) as members:
            memberships = {a['objectId']:members[a['objectId']] for a in labels}
        require(all(v.ndim == 1 and np.issubdtype(v.dtype, np.integer) and
                    np.all((v >= 0) & (v < len(xyz))) for v in memberships.values()), 'Invalid cloud membership.')
    rows = []
    with new_directory(out) as staging:
        for i, target in enumerate(targets):
            name = filename(target['id'])
            ref = references / name
            truth_hash = digest(ref.read_bytes())
            require(truth_hash not in source_hashes, 'Held-out photograph duplicates an input.')
            h = max(1, round(width * target['height'] / target['width']))
            size = (width, h)
            truth = raster(ref, target, size)
            source = nearest(target, sources)
            closest = raster(pack / 'images' / filename(source['id']), source, size)
            rendered, mask, winners = project(xyz, rgb, target, size)
            pictures = {'nearest':closest, 'geometryWithNearestFill':np.where(mask[:,:,None], rendered, closest)}
            support_scores = {}
            if method:
                prediction, supplied_mask = predictions_by_id[name]
                pictures['submitted'] = raster(prediction, target, size, exact=False)
                if supplied_mask:
                    support = load_support(supplied_mask, prediction, size)
                    support_scores = {'submittedSupport':{'pixels':int(support.sum()),
                        'coverage':round(float(support.mean()), 6),
                        'rgbMae':{k:mae(truth, im, support) for k,im in pictures.items()}}}
            regions = region_checks(truth, pictures, winners, [a for a in labels if a['image'] == name], memberships)
            rows.append(dict(id=name, referenceSha256=truth_hash, nearestInput=source['id'],
                             size=size, geometryCoverage=round(float(mask.mean()), 6),
                             rgbMae={k:mae(truth, im) for k,im in pictures.items()},
                             coveredRgbMae={k:mae(truth, im, mask) for k,im in pictures.items()}, regions=regions,
                             **support_scores))
            tiles = [('Withheld photograph', truth), ('Nearest source', closest),
                     ('Observed point colors', rendered)]
            if method:
                tiles.append(('Submitted prediction', pictures['submitted']))
            plate = Image.new('RGB', (width*len(tiles), h+22), '#192326')
            draw = ImageDraw.Draw(plate)
            for j, (label, im) in enumerate(tiles):
                plate.paste(Image.fromarray(im), (j*width,22))
                draw.text((j*width+4,3), label, fill='white')
            plate.save(staging / f'view-{i+1:03d}.png')
        summary = {key:round(float(np.mean([r['rgbMae'][key] for r in rows])), 4) for key in rows[0]['rgbMae']}
        report = dict(schema='brainsnn.walk-evaluation.v1', requestSha256=digest(request.read_bytes()),
                      cloudSha256=digest(cloud.read_bytes()), sourceViews=len(sources), heldOutViews=len(targets),
                      submittedMethod=method, cloudInputProvenance=lineage, targetPoseSource=data['targetPoseSource'], meanRgbMae=summary,
                      meanGeometryCoverage=round(float(np.mean([r['geometryCoverage'] for r in rows])), 6),
                      frames=rows)
        with_mask = [r['submittedSupport'] for r in rows if 'submittedSupport' in r]
        if with_mask:
            count = sum(item['pixels'] for item in with_mask)
            report['submittedSupport'] = dict(frames=len(with_mask), pixels=count,
                meanCoverage=round(float(np.mean([item['coverage'] for item in with_mask])), 6),
                pixelWeightedRgbMae={key:(round(sum(item['pixels'] * item['rgbMae'][key]
                    for item in with_mask if item['pixels']) / count, 4) if count else None) for key in summary})
        save(staging / 'scores.json', report)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('prepare', help='Create an input-only directory for a camera-path model.')
    for arg in ('cameras','images','times','holdout-times','out'):
        p.add_argument('--'+arg, type=Path, required=True)
    p = sub.add_parser('score', help='Compare a point cloud, retrieval, and optional submitted frames.')
    for arg in ('pack','references','cloud','out'):
        p.add_argument('--'+arg, type=Path, required=True)
    for arg in ('predictions', 'annotations', 'groups', 'cloud-inputs'):
        p.add_argument('--'+arg, type=Path)
    p.add_argument('--width', type=int, default=320)
    args = vars(parser.parse_args())
    if args.pop('command') == 'prepare':
        prepare(**args)
    else:
        report = score(**args)
        print(json.dumps({k:v for k,v in report.items() if k != 'frames'}, indent=2))


if __name__ == '__main__':
    main()
