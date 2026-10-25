"""Bounded camera/frame ledger for one private reconstruction job.

Paths are relative to the job root. Recorded original-source hashes are checked
against the bound reconstruction receipt; original uploads may live elsewhere.
Raster bytes, dimensions, cloud bytes and camera geometry are validated locally.
No metric accuracy, measured calibration or original-source attestation follows.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import re
import unicodedata
import warnings

SCHEMA = 'brainsnn.camera-frames.v1'
MAX_FRAMES = 60
MAX_BYTES = 1024 * 1024
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_PIXELS = 24_000_000
_SHA = re.compile(r'^[a-f0-9]{64}$')
_LEDGER = 'output/camera-frames.json'


def _fail(message):
    raise ValueError(message)


def _canonical(value):
    try:
        return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True,
                          allow_nan=False).encode('ascii')
    except (TypeError, ValueError, RecursionError, UnicodeError) as error:
        raise ValueError('Camera evidence must be finite JSON.') from error


def _exact(value, keys, name, optional=()):
    if not isinstance(value, dict) or not set(keys) <= set(value) or set(value) - set(keys) - set(optional):
        _fail(f'Invalid {name} fields.')


def _text(value, name, maximum=240):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum \
            or any(unicodedata.category(char).startswith('C') for char in value):
        _fail(f'Invalid bounded {name}.')
    return value


def _sha(value):
    if not isinstance(value, str) or not _SHA.fullmatch(value):
        _fail('Use lowercase SHA-256 digests.')
    return value


def _number(value, low, high, name):
    if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
        _fail(f'{name} must be finite and between {low} and {high}.')
    return value


def _integer(value, low, high, name):
    if type(value) is not int or not low <= value <= high:
        _fail(f'{name} must be an integer between {low} and {high}.')
    return value


def _relative(name):
    _text(name, 'job-relative path')
    path = PurePosixPath(name)
    if '\\' in name or ':' in name or path.is_absolute() or str(path) != name \
            or any(part in ('', '.', '..') for part in path.parts):
        _fail('Use canonical job-relative paths without traversal or host paths.')
    return path


def _root(job_root):
    root = Path(job_root).absolute()
    if root.is_symlink() or not root.is_dir():
        _fail('The source job root must be a regular directory.')
    return root.resolve()


def _path(root, name):
    relative = _relative(name)
    path = root
    for part in relative.parts:
        path = path / part
        if path.is_symlink():
            _fail('Symlinks are not camera evidence.')
    if not path.is_file() or not path.resolve().is_relative_to(root):
        _fail('Camera evidence file is missing or outside its source job.')
    return path


def _ledger_name(root, value):
    if value is None:
        return _LEDGER
    path = Path(value)
    name = path.relative_to(root).as_posix() if path.is_absolute() else path.as_posix()
    relative = _relative(name)
    if relative.name != 'camera-frames.json' or len(relative.parts) < 2:
        _fail('Camera ledgers need a contained artifact-directory camera-frames.json path.')
    return name


def _digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def file_record(job_root, path, **extra):
    """Hash an existing job-contained regular file; extra fields cannot replace its binding."""
    root = _root(job_root)
    path = Path(path)
    name = path.relative_to(root).as_posix() if path.is_absolute() else path.as_posix()
    checked = _path(root, name)
    size = checked.stat().st_size
    _integer(size, 1, MAX_FILE_BYTES, 'Evidence file bytes')
    if {'name', 'sha256', 'bytes'} & set(extra):
        _fail('Extra metadata cannot replace file bindings.')
    return {'name': name, 'sha256': _digest(checked), 'bytes': size, **copy.deepcopy(extra)}


def _file(value, *, root=None, extra=(), maximum=MAX_FILE_BYTES):
    _exact(value, ('name', 'sha256', 'bytes', *extra), 'file binding')
    _relative(value['name']); _sha(value['sha256'])
    _integer(value['bytes'], 1, maximum, 'Evidence file bytes')
    if root is not None:
        path = _path(root, value['name'])
        if path.stat().st_size != value['bytes'] or _digest(path) != value['sha256']:
            _fail('Camera evidence bytes or SHA-256 no longer match.')
        return path
    return None


def _dimensions(width, height):
    _integer(width, 1, MAX_PIXELS, 'Image width'); _integer(height, 1, MAX_PIXELS, 'Image height')
    if width * height > MAX_PIXELS:
        _fail('Camera evidence images exceed 24 megapixels.')


def _image(value, root):
    path = _file(value, root=root, extra=('width', 'height'))
    _dimensions(value['width'], value['height'])
    if path is not None:
        from PIL import Image
        try:
            with warnings.catch_warnings():
                warnings.simplefilter('error', Image.DecompressionBombWarning)
                with Image.open(path) as image:
                    if image.format not in ('JPEG', 'PNG', 'WEBP') or image.size != (value['width'], value['height']):
                        _fail('Camera raster dimensions or format do not match the ledger.')
                    _dimensions(*image.size); image.verify()
        except (OSError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
            raise ValueError('Camera raster is not a valid bounded image.') from error


def _matrix(value, rows, cols, name):
    if not isinstance(value, list) or len(value) != rows or any(not isinstance(row, list) or len(row) != cols for row in value):
        _fail(f'{name} must be a {rows} by {cols} matrix.')
    return [[_number(number, -10_000_000, 10_000_000, name) for number in row] for row in value]


def _det(matrix):
    a, b, c = matrix
    return a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])


def _pose(value):
    matrix = _matrix(value, 3, 4, 'Source-world to OpenCV-camera pose')
    rotation = [row[:3] for row in matrix]
    if any(abs(sum(rotation[i][k] * rotation[j][k] for k in range(3)) - (i == j)) > 1e-4
           for i in range(3) for j in range(3)) or abs(_det(rotation) - 1) > 1e-4:
        _fail('Camera pose must contain a proper rigid rotation without reflection or scale.')


def _pixel_transform(value):
    if value is None:
        return
    matrix = _matrix(value, 3, 3, 'Pixel-center transform')
    if matrix[2] != [0, 0, 1] or abs(_det(matrix)) < 1e-12:
        _fail('Pixel-center transforms must be nonsingular 2D affine matrices.')


def _camera(value):
    _exact(value, ('model', 'params'), 'camera', ('pixelConvention',))
    if value.get('pixelConvention', 'integer-centres') not in ('integer-centres', 'colmap-half-pixel'):
        _fail('Camera pixel convention must be explicit native COLMAP or integer centres.')
    if value['model'] not in ('PINHOLE', 'SIMPLE_RADIAL') or not isinstance(value['params'], list) or len(value['params']) != 4:
        _fail('Use PINHOLE [fx,fy,cx,cy] or SIMPLE_RADIAL [f,cx,cy,k].')
    params = [_number(number, -10_000_000, 10_000_000, 'Camera parameter') for number in value['params']]
    for focal in params[:2] if value['model'] == 'PINHOLE' else params[:1]:
        _number(focal, 1e-6, 10_000_000, 'Focal length')
    if value['model'] == 'SIMPLE_RADIAL':
        _number(params[3], -10, 10, 'Radial coefficient')


def frame_id(source_sha256, image_sha256, camera, cam_from_world):
    """Identity follows source/raster/camera bytes, independent of private image path."""
    _sha(source_sha256); _sha(image_sha256); _camera(camera); _pose(cam_from_world)
    return hashlib.sha256(b'brainsnn.camera-frame.v1\0' +
        _canonical([source_sha256, image_sha256, camera, cam_from_world])).hexdigest()


def validate(record, job_root=None, expected_cloud_sha256=None):
    """Validate shape, and local evidence files when a job root is supplied; return a copy."""
    raw = _canonical(record)
    if len(raw) > MAX_BYTES:
        _fail('Camera ledger exceeds 1 MiB.')
    _exact(record, ('schema', 'sources', 'reconstruction', 'clouds', 'frames', 'metric_verified'), 'camera ledger')
    if record['schema'] != SCHEMA or record['metric_verified'] is not False:
        _fail('Camera ledger schema or metric-accuracy claim is invalid.')
    root = _root(job_root) if job_root is not None else None
    sources = record['sources']
    if not isinstance(sources, list) or not 1 <= len(sources) <= 12:
        _fail('Use 1 to 12 original source records.')
    for source in sources:
        _exact(source, ('name', 'kind', 'sha256'), 'original source')
        _text(source['name'], 'source name', 200); _sha(source['sha256'])
        if '/' in source['name'] or '\\' in source['name'] or source['kind'] not in ('image', 'video'):
            _fail('Original sources need bounded names and image/video kinds.')
    receipt = _file(record['reconstruction'], root=root, maximum=MAX_BYTES)
    receipt_name = PurePosixPath(record['reconstruction']['name'])
    if receipt_name.name != 'reconstruction.json' or len(receipt_name.parts) < 2:
        _fail('Bind the source job artifact-directory reconstruction receipt.')
    if receipt is not None and _canonical(_read_json(receipt).get('sources')) != _canonical(sources):
        _fail('Original source records disagree with the bound reconstruction receipt.')
    clouds = record['clouds']
    if not isinstance(clouds, list) or not 1 <= len(clouds) <= 3:
        _fail('Bind 1 to 3 source point-cloud artifacts.')
    cloud_names, cloud_hashes, frames = set(), set(), record['frames']
    for cloud in clouds:
        _file(cloud, root=root, extra=('coordinate_frame',))
        if PurePosixPath(cloud['name']).parent != receipt_name.parent or not cloud['name'].endswith('.ply') \
                or cloud['coordinate_frame'] not in ('colmap', 'right-handed-y-up') \
                or cloud['name'] in cloud_names or cloud['sha256'] in cloud_hashes:
            _fail('Cloud artifacts need unique output PLY bindings and known coordinate frames.')
        cloud_names.add(cloud['name']); cloud_hashes.add(cloud['sha256'])
    if len({cloud['coordinate_frame'] for cloud in clouds}) != 1:
        _fail('All declared clouds must share the camera source-world frame.')
    if expected_cloud_sha256 is not None and _sha(expected_cloud_sha256) not in cloud_hashes:
        _fail('This camera ledger is bound to another point-cloud artifact.')
    if not isinstance(frames, list) or not 1 <= len(frames) <= MAX_FRAMES:
        _fail('Use 1 to 60 registered camera frames.')
    identifiers, names = set(), set()
    for frame in frames:
        _exact(frame, ('frame_id', 'image', 'origin', 'timestamp', 'camera', 'cam_from_world'), 'frame',
               ('preparedImage', 'preprocessing'))
        _image(frame['image'], root); _camera(frame['camera']); _pose(frame['cam_from_world'])
        origin = frame['origin']
        _exact(origin, ('sourceIndex', 'sourceWidth', 'sourceHeight', 'exifOrientation', 'sourceToFramePixelCenter'), 'frame origin')
        _integer(origin['sourceIndex'], 0, len(sources) - 1, 'Source index')
        if origin['sourceWidth'] is not None or origin['sourceHeight'] is not None:
            _dimensions(origin['sourceWidth'], origin['sourceHeight'])
        if origin['exifOrientation'] is not None:
            _integer(origin['exifOrientation'], 1, 8, 'EXIF orientation')
        _pixel_transform(origin['sourceToFramePixelCenter'])
        if origin['sourceToFramePixelCenter'] is not None and origin['sourceWidth'] is None:
            _fail('A known source pixel transform needs original dimensions.')
        timestamp = frame['timestamp']
        if timestamp is not None:
            _exact(timestamp, ('pts', 'timeBase'), 'source timestamp')
            _integer(timestamp['pts'], -(2**63), 2**63 - 1, 'Original PTS')
            if not isinstance(timestamp['timeBase'], list) or len(timestamp['timeBase']) != 2:
                _fail('Time base needs an exact rational numerator/denominator.')
            for number in timestamp['timeBase']:
                _integer(number, 1, 1_000_000_000, 'Time base')
            if sources[origin['sourceIndex']]['kind'] != 'video':
                _fail('An image source has no video PTS.')
        if 'preparedImage' in frame:
            _image(frame['preparedImage'], root)
        if 'preprocessing' in frame:
            prep = frame['preprocessing']
            _exact(prep, ('sourceToModelPixelCenter', 'preparedToModelPixelCenter', 'reason', 'raster'), 'preprocessing')
            _pixel_transform(prep['sourceToModelPixelCenter']); _pixel_transform(prep['preparedToModelPixelCenter'])
            _text(prep['reason'], 'preprocessing reason'); _text(prep['raster'], 'raster description', 120)
        identifier = frame_id(sources[origin['sourceIndex']]['sha256'], frame['image']['sha256'],
                              frame['camera'], frame['cam_from_world'])
        if frame['frame_id'] != identifier or identifier in identifiers or frame['image']['name'] in names:
            _fail('Camera frame identity is duplicate, stale or does not match its raster/camera/source.')
        identifiers.add(identifier); names.add(frame['image']['name'])
    return copy.deepcopy(record)


def _read_json(path):
    if not 0 < path.stat().st_size <= MAX_BYTES:
        _fail('Camera evidence JSON must be nonempty and within 1 MiB.')
    def pairs(values):
        result = {}
        for key, value in values:
            if key in result:
                _fail('Duplicate evidence JSON fields are not accepted.')
            result[key] = value
        return result
    try:
        value = json.loads(path.read_bytes(), object_pairs_hook=pairs)
        _canonical(value)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as error:
        raise ValueError('Camera evidence must be valid finite JSON.') from error
    if not isinstance(value, dict):
        _fail('Camera evidence must be a JSON object.')
    return value


def write(job_root, record, *, output_path=None):
    """Validate files and exclusively create the ledger; default is output/camera-frames.json."""
    root = _root(job_root)
    checked = validate(record, root)
    name = _ledger_name(root, output_path)
    if PurePosixPath(name).parent != PurePosixPath(record['reconstruction']['name']).parent:
        _fail('Write the ledger beside its bound reconstruction receipt.')
    path = root / name
    parent = root
    for part in PurePosixPath(name).parent.parts:
        parent = parent / part
        if parent.is_symlink():
            _fail('The artifact directory cannot contain symlinks.')
    if not path.parent.is_dir():
        _fail('The job output directory must already exist without symlinks.')
    raw = json.dumps(checked, indent=2, allow_nan=False).encode('utf-8') + b'\n'
    if len(raw) > MAX_BYTES:
        _fail('Written camera ledger exceeds 1 MiB.')
    with path.open('xb') as stream:
        stream.write(raw)
    return path


def load_record(job_root, *, ledger_path=None):
    root = _root(job_root)
    return validate(_read_json(_path(root, _ledger_name(root, ledger_path))), root)


def _projector(camera):
    # Exact COLMAP PINHOLE and SIMPLE_RADIAL forward projection, without importing
    # reconstruction/model runtimes. Intrinsics describe this exact saved raster.
    import numpy as np
    model, parameters = camera['model'], camera['params']
    def project(points):
        values = np.asarray(points, dtype=float)
        if values.ndim != 2 or values.shape[1] != 3 or not np.isfinite(values).all():
            _fail('Projection needs finite N by 3 camera coordinates.')
        result = np.full((len(values), 2), np.nan)
        front = values[:, 2] > 1e-12
        x, y = (values[front, :2] / values[front, 2:3]).T
        if model == 'PINHOLE':
            fx, fy, cx, cy = parameters
            result[front] = np.column_stack((fx * x + cx, fy * y + cy))
        else:
            focal, cx, cy, radial = parameters
            factor = 1 + radial * (x * x + y * y)
            result[front] = np.column_stack((focal * x * factor + cx, focal * y * factor + cy))
        if camera.get('pixelConvention', 'integer-centres') == 'colmap-half-pixel':
            result -= .5
        return result
    return project


def load_views(source_job_root, expected_cloud_sha256=None, *, ledger_path=None):
    """Load validated private rasters and projections in their cloud's source-world frame."""
    import numpy as np
    root = _root(source_job_root)
    path = _path(root, _ledger_name(root, ledger_path))
    record = validate(_read_json(path), root, expected_cloud_sha256)
    cloud = next((row for row in record['clouds'] if row['sha256'] == expected_cloud_sha256), record['clouds'][0])
    ledger_hash = _digest(path)
    result = []
    for frame in record['frames']:
        image = frame['image']; matrix = np.asarray(frame['cam_from_world'], dtype=float)
        matrix.setflags(write=False)
        result.append({'name': PurePosixPath(image['name']).name, 'path': _path(root, image['name']),
            'width': image['width'], 'height': image['height'], 'cam_from_world': matrix,
            'project': _projector(frame['camera']), 'frame_id': frame['frame_id'],
            'image_sha256': image['sha256'], 'image_bytes_size': image['bytes'], 'ledger_sha256': ledger_hash,
            'source_cloud_sha256': cloud['sha256'], 'source_cloud_name': cloud['name'],
            'source_cloud_coordinate_frame': cloud['coordinate_frame'], 'pixel_convention': 'integer-centres',
            'camera_pixel_convention': frame['camera'].get('pixelConvention', 'integer-centres')})
    return result
