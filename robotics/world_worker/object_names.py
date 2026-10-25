"""Names for the objects a metric scene separates, suggested by a vision model from the walkthrough frames that saw them.

Each separated object is projected into the reconstruction's registered frames through the hand-off's `fromSource`
transform (reconstruction coordinates -> hand-off coordinates). The two frames that see it most completely, least
occluded, are cropped around it with its outline drawn, and sent with its reconstruction-derived size in one request.
The model answers in a fixed JSON schema. Its names are suggestions: the scene marks them unreviewed, low-confidence
answers are not applied, and an object it cannot name stays "Object N".

The model is Claude through the Anthropic API, with ANTHROPIC_API_KEY in this adapter's environment. Crops leave the
worker only when the person approved it for this job (`nameObjects` in the hand-off).
"""
from __future__ import annotations

import base64
import bisect
import hashlib
import io
import itertools
import json
import math
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scene_compiler'))

MODEL = 'claude-opus-5-5'
PROMPT_VERSION = 'brainsnn-object-names-v2-geometry-scale'
MAX_OBJECTS = 40          # two crops each keeps one request well under the API's 100-image limit
VIEWS_PER_OBJECT = 2
CROP_EDGE = 512           # pixels on the longer side of each crop sent
MIN_VISIBLE = 0.85        # share of an object's points that must fall inside a frame, in front of its camera
MIN_BOX_PIXELS = 40       # the object's box in the frame must be at least this wide and tall
OCCLUSION_METRES = 0.25   # a point this much nearer the camera, in the same 8-pixel cell, hides an object point
MAX_HIDDEN = 0.5          # a view that hides more of the object than this is never used
MIN_BASELINE_METRES = 0.3 # the second view must come from a camera at least this far from the first
OUTLINE = (255, 0, 200)
CATEGORIES = ['furniture', 'appliance', 'electronics', 'lighting', 'decor', 'plant', 'storage', 'fixture', 'structure',
              'other', 'unknown']

SYSTEM = (
    "You identify objects in a 3D scan of an indoor space. Each object was separated from the scan's points and "
    "bounded by reconstructed geometry. For each one you get one or two photo crops from the walkthrough video, "
    "with the object outlined in magenta, and its geometry-derived size at an entered, unverified scale.\n\n"
    "Name the object inside the outline with a short common noun, as a person would label it on a floor plan: for "
    "example 'sofa', 'dining table', 'floor lamp', 'upright piano'. The outline comes from 3D points, so it can be "
    "loose or take in part of a neighbour; name the main thing it encloses. If it clearly holds two touching objects, "
    "name both ('sofa and side table'). The size uses an entered scale and may contain scale error, missing surfaces "
    "or a merged neighbouring object, so use it as a hint. Do not propose replacement dimensions or infer a "
    "standard size from the object's category.\n\n"
    "When the crops do not show what the object is, answer 'unknown' with low confidence. A wrong confident name is "
    "worse than 'unknown', because these names go into a building model. Use high confidence only when the object is "
    "plainly visible in at least one crop.")

RESPONSE_SCHEMA = {
    'type': 'object',
    'properties': {'objects': {'type': 'array', 'items': {
        'type': 'object',
        'properties': {'id': {'type': 'string'}, 'name': {'type': 'string'},
                       'category': {'type': 'string', 'enum': CATEGORIES},
                       'confidence': {'type': 'string', 'enum': ['low', 'medium', 'high']},
                       'reason': {'type': 'string'}},
        'required': ['id', 'name', 'category', 'confidence', 'reason'], 'additionalProperties': False}}},
    'required': ['objects'], 'additionalProperties': False}


class NamingSkipped(Exception):
    """Naming could not run or produced nothing usable; the scene compiles without names and says why."""


def source_points(points, from_source):
    """Hand-off points (N x 3, the hand-off's frame) back in reconstruction coordinates, and metres per source unit."""
    import numpy as np
    M = np.asarray(from_source, float)
    if M.shape != (3, 4) or not np.isfinite(M).all():
        raise NamingSkipped('The hand-off does not record its transform from the reconstruction.')
    A, t = M[:, :3], M[:, 3]
    det = float(np.linalg.det(A))
    if abs(det) < 1e-12:
        raise NamingSkipped('The hand-off transform is singular.')
    scale = abs(det) ** (1 / 3)
    if det <= 0 or not np.allclose(A.T @ A, np.eye(3) * scale**2, rtol=1e-5, atol=scale**2 * 1e-6):
        raise NamingSkipped('The hand-off transform must be a proper rotation and uniform positive scale.')
    return (np.asarray(points, float)[:, :3] - t) @ np.linalg.inv(A).T, scale


def _source_cloud_rows(root, entry):
    """Read only the bounded ASCII preview written by our adapters, from admitted bytes."""
    import numpy as np
    path = root / entry['name']
    raw = path.read_bytes()
    if len(raw) != entry['bytes'] or hashlib.sha256(raw).hexdigest() != entry['sha256']:
        raise NamingSkipped('Source point-cloud bytes changed after camera evidence validation.')
    head, separator, body = raw.partition(b'end_header\n')
    if not separator or len(head) > 8192:
        raise NamingSkipped('Unsupported source preview PLY header.')
    lines = head.decode('ascii').splitlines()
    properties = [line for line in lines if line.startswith('property ')]
    if lines[:2] != ['ply', 'format ascii 1.0'] or properties != [
            'property float x', 'property float y', 'property float z', 'property uchar red',
            'property uchar green', 'property uchar blue']:
        raise NamingSkipped('Source camera binding requires the adapter ASCII XYZ/RGB preview.')
    vertices = [line.split() for line in lines if line.startswith('element vertex ')]
    if len(vertices) != 1 or not 1 <= int(vertices[0][2]) <= 200_000:
        raise NamingSkipped('Source preview point count is invalid.')
    rows = body.decode('ascii').splitlines()
    if len(rows) != int(vertices[0][2]):
        raise NamingSkipped('Source preview body differs from its declared point count.')
    values = np.asarray([row.split() for row in rows], dtype=float)
    if values.shape != (len(rows), 6) or not np.isfinite(values).all() \
            or np.any(np.abs(values[:, :3]) > 10_000_000) \
            or np.any(values[:, 3:] < 0) or np.any(values[:, 3:] > 255) \
            or np.any(values[:, 3:] != np.rint(values[:, 3:])):
        raise NamingSkipped('Source preview has invalid XYZ/RGB values.')
    # Browser PLY parsing uses float32, even though the text can carry more digits.
    values[:, :3] = values[:, :3].astype(np.float32)
    return values


def _ordered_source_subset(cloud, source, source_points_xyz):
    """Confirm source membership, RGB and order with a bounded numeric-roundoff allowance.

    This checks data lineage, not metric accuracy. Trimming and thinning preserve
    source order. Arbitrary new coordinates cannot silently borrow another job's cameras.
    """
    import numpy as np
    target = np.asarray(cloud.get('points'), dtype=float)
    if target.ndim != 2 or target.shape[1] != 6 or not 1 <= len(target) <= 50_000 \
            or not np.isfinite(target).all():
        raise NamingSkipped('Camera evidence needs a bounded finite hand-off cloud.')
    # The saved PLY and browser both use the same float32 coordinates. Only
    # double-precision similarity inversion/serialization roundoff is allowed.
    # A discarded far outlier must not turn a moved room point into a match.
    matrix = np.asarray(cloud['fromSource'], dtype=float)
    scale = abs(float(np.linalg.det(matrix[:, :3]))) ** (1 / 3)
    offset_term = float(np.abs(matrix[:, 3]).max()) / scale
    roundoff = 128 * np.finfo(float).eps
    source_floor = 1e-6 / scale
    epsilon = max(source_floor, roundoff * (2 * float(np.abs(source[:, :3]).max()) + 2 * offset_term + 1))
    buckets = {}
    for index, row in enumerate(source):
        key = (*np.floor(row[:3] / epsilon).astype(np.int64).tolist(), *row[3:].tolist())
        buckets.setdefault(key, []).append(index)
    previous, checks = -1, 0
    offsets = list(itertools.product((-1, 0, 1), repeat=3))
    for position, target_point in zip(source_points_xyz, target):
        colour = target_point[3:]
        cell = np.floor(position / epsilon).astype(np.int64)
        best = len(source)
        for offset in offsets:
            key = (*(cell + offset).tolist(), *colour.tolist())
            indices = buckets.get(key, ())
            at = bisect.bisect_right(indices, previous)
            for offset_index in range(at, len(indices)):
                index = indices[offset_index]
                if index >= best:
                    break
                checks += 1
                if checks > 2_000_000:
                    raise NamingSkipped('Source-cloud association exceeded its comparison budget.')
                local_tolerance = np.maximum(source_floor, roundoff * (np.abs(source[index, :3]) + np.abs(position) + 2 * offset_term + 1))
                forward = matrix[:, :3] @ source[index, :3] + matrix[:, 3]
                handoff_tolerance = 1e-6 + roundoff * (np.abs(matrix[:, :3]) @ np.abs(source[index, :3])
                                                      + np.abs(matrix[:, 3]) + np.abs(target_point[:3]))
                if np.all(np.abs(source[index, :3] - position) <= local_tolerance) \
                        and np.all(np.abs(forward - target_point[:3]) <= handoff_tolerance):
                    best = index
                    break
        if best == len(source):
            raise NamingSkipped('Hand-off points, colours or ordering do not match the source camera cloud.')
        previous = best
    return epsilon


def reconstruction_views(source_dir, cloud, *, ledger_path=None):
    """Adapter-neutral, source-bound cameras; legacy COLMAP jobs remain explicitly unbound."""
    try:
        from . import camera_frames
    except ImportError:
        import camera_frames
    root = Path(source_dir).absolute()
    # CLI callers may pass the actual artifact directory; worker callers pass
    # the authorized job root and use its canonical output directory.
    if ledger_path is None and ((root / 'camera-frames.json').exists() or (root / 'camera-frames.json').is_symlink()):
        ledger_path = root / 'camera-frames.json'
        root = root.parent
    ledger = Path(ledger_path) if ledger_path is not None else root / 'output' / 'camera-frames.json'
    if not ledger.is_absolute():
        ledger = root / ledger
    if not ledger.exists() and not ledger.is_symlink():
        if ledger_path is not None:
            raise NamingSkipped('The supplied camera-frame ledger is missing.')
        return [{**view, 'binding_status': 'legacy-colmap-unbound'} for view in colmap_views(root)]
    record = camera_frames.load_record(root, ledger_path=ledger)  # Invalid evidence must never fall back.
    P, _scale = source_points(cloud['points'], cloud.get('fromSource'))
    candidates, failures = [], []
    for entry in record['clouds']:
        if entry['coordinate_frame'] != cloud.get('sourceFrame'):
            continue
        try:
            epsilon = _ordered_source_subset(cloud, _source_cloud_rows(root, entry), P)
            candidates.append((entry, epsilon))
        except NamingSkipped as error:
            failures.append(str(error))
    if not candidates:
        raise NamingSkipped(failures[0] if failures else 'The source camera coordinate frame does not match this hand-off.')
    if len(candidates) > 1:
        hinted = [row for row in candidates if Path(row[0]['name']).name == Path(str(cloud.get('source', ''))).name]
        if len(hinted) != 1:
            raise NamingSkipped('More than one source cloud matches; retain its actual preview artifact name.')
        candidates = hinted
    entry, epsilon = candidates[0]
    return [{**view, 'binding_status': 'ordered-source-subset', 'binding_tolerance_source_units': epsilon}
            for view in camera_frames.load_views(root, expected_cloud_sha256=entry['sha256'], ledger_path=ledger)]


def selected_model(sparse: Path):
    """The folder of the COLMAP model a reconstruction job exported. COLMAP can find several disconnected models, and
    the exported points come from the largest, which need not be model 0: the job records its index next to them.
    An older job without that record is usable only when it has a single model."""
    marker = sparse / 'selected.txt'
    if marker.is_file():
        index = marker.read_text().strip()
        if not index.isdigit() or not (sparse / index).is_dir():
            raise NamingSkipped('The reconstruction records a model that is not there.')
        return sparse / index
    models = [d for d in sparse.iterdir() if d.is_dir() and d.name.isdigit()] if sparse.is_dir() else []
    if len(models) != 1:
        raise NamingSkipped('The reconstruction has several models and does not record which one its points came from.'
                            if models else 'The reconstruction job no longer holds its camera poses.')
    return models[0]


def colmap_views(source_dir: Path):
    """Registered frames of a reconstruction job: name, image path, size, cam_from_world (3 x 4) and the camera's own
    projection (COLMAP's model, so its fitted lens distortion is respected)."""
    import numpy as np
    import pycolmap
    source_dir = Path(source_dir).resolve()
    images = source_dir / 'colmap-work' / 'images'
    if not images.is_dir():
        raise NamingSkipped('The reconstruction job no longer holds its frames.')
    sparse = selected_model(source_dir / 'colmap-work' / 'sparse')
    model, views = pycolmap.Reconstruction(str(sparse)), []
    for image_id in sorted(model.reg_image_ids()):
        image = model.image(image_id); camera = model.camera(image.camera_id)
        path = (images / image.name).resolve()
        if path.parent != images.resolve() or path.is_symlink() or not path.is_file():
            continue
        views.append({'name': image.name, 'path': path, 'width': camera.width, 'height': camera.height,
                      'cam_from_world': np.asarray(image.cam_from_world().matrix(), float),
                      'project': lambda cam, camera=camera: np.asarray(camera.img_from_cam(cam), float)})
    if not views:
        raise NamingSkipped('The reconstruction has no registered frames.')
    return views


def project(view, P):
    """Pixels (N x 2) and depths of points P (reconstruction coordinates) in a view; NaN where behind the camera."""
    import numpy as np
    M = view['cam_from_world']; cam = P @ M[:, :3].T + M[:, 3]
    uv = np.full((len(P), 2), np.nan); front = cam[:, 2] > 1e-6
    if front.any(): uv[front] = view['project'](cam[front])
    return uv, cam[:, 2]


def choose_views(objects, P, views, metres_per_unit, cell=8):
    """For each object, up to VIEWS_PER_OBJECT frames that see it whole and largely unoccluded, best first, with its
    pixel box in each. A cell z-buffer of the other points stands in for occlusion: an object point is hidden when a
    point that is not part of the object falls in its 8-pixel cell OCCLUSION_METRES nearer the camera."""
    import numpy as np
    near = OCCLUSION_METRES / metres_per_unit
    ranked = [[] for _ in objects]
    for view in views:
        W, H = view['width'], view['height']
        uv, z = project(view, P)
        ok = np.isfinite(uv).all(1) & (z > 0) & (uv[:, 0] >= 0) & (uv[:, 1] >= 0) & (uv[:, 0] < W) & (uv[:, 1] < H)
        cols, rows = W // cell + 1, H // cell + 1
        key = np.where(ok, (np.nan_to_num(uv[:, 1]) // cell) * cols + np.nan_to_num(uv[:, 0]) // cell, -1).astype(int)
        for n, obj in enumerate(objects):
            members = np.asarray(obj['members'])
            seen = ok[members]
            if seen.mean() < MIN_VISIBLE:
                continue
            m = members[seen]
            others = ok.copy(); others[members] = False
            nearest = np.full(cols * rows, np.inf)
            np.minimum.at(nearest, key[others], z[others])
            hidden = float((nearest[key[m]] < z[m] - near).mean())
            if hidden > MAX_HIDDEN:
                continue
            (x0, y0), (x1, y1) = np.percentile(uv[m], 2, axis=0), np.percentile(uv[m], 98, axis=0)
            if min(x1 - x0, y1 - y0) < MIN_BOX_PIXELS:
                continue
            size = min(1.0, (x1 - x0) * (y1 - y0) / (W * H) / 0.35)  # larger is better, up to about a third of the frame
            centre = -view['cam_from_world'][:, :3].T @ view['cam_from_world'][:, 3]
            ranked[n].append({'score': (1 - hidden) * size * seen.mean(), 'hidden': hidden, 'visible': float(seen.mean()), 'view': view,
                              'box': [float(x0), float(y0), float(x1), float(y1)], 'camera': centre})
    chosen = []
    for options in ranked:
        options.sort(key=lambda o: -o['score'])
        picks = options[:1]
        for o in options[1:]:
            if len(picks) == VIEWS_PER_OBJECT: break
            if all(np.linalg.norm(o['camera'] - p['camera']) * metres_per_unit >= MIN_BASELINE_METRES for p in picks):
                picks.append(o)
        chosen.append(picks)
    return chosen


def view_image_bytes(view):
    """Read the admitted raster bytes again before use; new evidence fails closed on replacement."""
    path = Path(view['path'])
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 64 * 1024**2:
        raise NamingSkipped('Source camera image is missing, oversized or unsafe.')
    raw = path.read_bytes()
    if 'image_sha256' in view and (hashlib.sha256(raw).hexdigest() != view['image_sha256']
                                  or len(raw) != view['image_bytes_size']):
        raise NamingSkipped('Source camera image changed after evidence validation.')
    return raw


def crop_with_evidence(view, box):
    """JPEG bytes of the frame around a pixel box (a quarter of its size added on each side), the box outlined."""
    from PIL import Image, ImageDraw
    x0, y0, x1, y1 = box
    pad_x, pad_y = max(48, (x1 - x0) * .25), max(48, (y1 - y0) * .25)
    with Image.open(io.BytesIO(view_image_bytes(view))) as source:
        if source.size != (view['width'], view['height']):
            raise NamingSkipped('Source camera image dimensions changed.')
        image = source.convert('RGB')
    left, top = max(0, int(x0 - pad_x)), max(0, int(y0 - pad_y))
    right, bottom = min(image.width, int(math.ceil(x1 + pad_x))), min(image.height, int(math.ceil(y1 + pad_y)))
    piece = image.crop((left, top, right, bottom))
    ImageDraw.Draw(piece).rectangle([x0 - left, y0 - top, x1 - left, y1 - top], outline=OUTLINE, width=max(2, round(max(piece.size) / 170)))
    piece.thumbnail((CROP_EDGE, CROP_EDGE))
    out = io.BytesIO(); piece.save(out, format='JPEG', quality=85)
    raw = out.getvalue()
    return raw, {'pixelBox': [float(v) for v in box], 'cropRectangle': [left, top, right, bottom],
                 'cropWidth': piece.width, 'cropHeight': piece.height, 'cropSha256': hashlib.sha256(raw).hexdigest(),
                 'cropBytes': len(raw), 'raster': 'Outlined JPEG derivative of the admitted camera raster.'}


def crop(view, box):
    return crop_with_evidence(view, box)[0]


def frame_evidence(pick, crop_record=None):
    view = pick['view']
    return {'frameId': view.get('frame_id'), 'imageSha256': view.get('image_sha256'),
            'cameraLedgerSha256': view.get('ledger_sha256'), 'sourceCloudSha256': view.get('source_cloud_sha256'),
            'bindingStatus': view.get('binding_status', 'injected-view-unbound'),
            'pixelConvention': view.get('pixel_convention', 'legacy-or-injected-unspecified'),
            'pixelBox': [float(v) for v in pick['box']], 'visibleFraction': pick.get('visible'),
            'occludedFraction': pick['hidden'], **({'crop': crop_record} if crop_record else {})}


def request_content(items):
    """The user turn: per object, its id, geometry-derived size and crops; then what to return."""
    content = [{'type': 'text', 'text': f'{len(items)} objects from one scan follow. Name each one.'}]
    for item in items:
        L, W, H = item['size']
        content.append({'type': 'text', 'text': f"Object {item['id']}: reconstruction box {L:.2f} x {W:.2f} m in plan, {H:.2f} m tall; entered scale, physically unverified."})
        for jpeg in item['crops']:
            content.append({'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/jpeg',
                                                        'data': base64.standard_b64encode(jpeg).decode('ascii')}})
    content.append({'type': 'text', 'text': 'Return one entry for every object id above, using exactly those ids.'})
    return content


def ask(client, items):
    """One request for every object. Returns (answers by id, served model, usage). Raises NamingSkipped on a refusal,
    a truncated answer or JSON that does not match the ids sent."""
    response = client.beta.messages.create(
        model=MODEL, max_tokens=16000, system=SYSTEM,
        messages=[{'role': 'user', 'content': request_content(items)}],
        output_config={'effort': 'medium', 'format': {'type': 'json_schema', 'schema': RESPONSE_SCHEMA}},
        # On a policy decline, the API retries on a fallback model inside the same call.
        betas=['server-side-fallback-2026-07-01'], fallbacks='default')
    if response.stop_reason == 'refusal':
        category = getattr(getattr(response, 'stop_details', None), 'category', None)
        raise NamingSkipped(f'The model declined to name these objects ({category or "no category"}).')
    if response.stop_reason == 'max_tokens':
        raise NamingSkipped('The model answer was cut off before it finished.')
    text = next((block.text for block in response.content if getattr(block, 'type', None) == 'text'), None)
    try:
        answer = json.loads(text or '')
    except json.JSONDecodeError as error:
        raise NamingSkipped('The model answer was not valid JSON.') from error
    sent, answers = {item['id'] for item in items}, {}
    for entry in answer.get('objects', []) if isinstance(answer, dict) else []:
        if isinstance(entry, dict) and entry.get('id') in sent and entry['id'] not in answers \
                and entry.get('category') in CATEGORIES and entry.get('confidence') in ('low', 'medium', 'high'):
            answers[entry['id']] = {'label': str(entry.get('name', '')).strip().lower()[:60] or 'unknown',
                                    'category': entry['category'], 'confidence': entry['confidence'],
                                    'reason': str(entry.get('reason', ''))[:200]}
    if not answers:
        raise NamingSkipped('The model answer named none of the objects sent.')
    usage = getattr(response, 'usage', None)
    return answers, str(getattr(response, 'model', MODEL)), {
        'input_tokens': getattr(usage, 'input_tokens', None), 'output_tokens': getattr(usage, 'output_tokens', None)}


def name_objects(cloud, source_dir, *, client=None, views=None, log=print, detect=None):
    """names (for scene_compiler --names) and evidence for a metric hand-off whose reconstruction is in source_dir.
    With detect (detector_names.load), an object detector on the worker answers instead of the API: no crop is made
    and no frame leaves the worker."""
    import scene_compiler as sc
    started = time.monotonic()
    if cloud.get('units') != 'm':
        raise NamingSkipped('Naming needs a metric scene.')
    pts = cloud['points']
    P, metres_per_unit = source_points(pts, cloud.get('fromSource'))
    floor_y = sc.floor_plane(pts, cloud.get('floorEstimate'))
    _, _, _, separated = sc.analyse(pts, floor_y, True)
    if not separated:
        raise NamingSkipped('The scene has no separated objects to name.')
    order = sorted(range(len(separated)), key=lambda i: -(separated[i]['length'] * separated[i]['thickness']
                                                          * (separated[i]['y1'] - separated[i]['y0'])))[:MAX_OBJECTS]
    objects = [separated[i] for i in order]
    views = views if views is not None else reconstruction_views(source_dir, cloud)
    chosen = choose_views(objects, P, views, metres_per_unit)
    items, skipped = [], []
    for i, obj, picks in zip(order, objects, chosen):
        if not picks:
            skipped.append({'id': f'object_{i + 1}', 'reason': 'not seen whole and unoccluded in any frame'}); continue
        crops = [] if detect else [crop_with_evidence(p['view'], p['box']) for p in picks]
        items.append({'id': str(i + 1), 'object': obj, 'size': [obj['length'], obj['thickness'], obj['y1'] - obj['y0']],
                      'views': [p['view']['name'] for p in picks], 'picks': picks,
                      'crops': [row[0] for row in crops],
                      'frameEvidence': [frame_evidence(pick, None if detect else crops[n][1]) for n, pick in enumerate(picks)]})
    if not items:
        raise NamingSkipped('No separated object was seen whole and unoccluded in any frame.')
    if detect:
        try:
            from . import detector_names
        except ImportError:
            import detector_names
        log(f'naming {len(items)} objects with the on-worker detector')
        answers, served, usage = detector_names.answer(items, detect)
        provider, requested, version = 'on-worker detector', detector_names.MODEL['sha256'], detector_names.RULES_VERSION
    else:
        if client is None:
            import anthropic
            client = anthropic.Anthropic()
        log(f'naming {len(items)} objects with {sum(len(i["crops"]) for i in items)} crops')
        answers, served, usage = ask(client, items)
        provider, requested, version = 'Anthropic', MODEL, PROMPT_VERSION
    names = {'schema': 'brainsnn.object-names.v1', 'model': served, 'prompt_version': version, 'objects': [
        {'id': f"object_{item['id']}", 'centre': [float(v) for v in item['object']['centre']],
         'height': float(item['object']['y1'] - item['object']['y0']), 'views': item['views'], **answers[item['id']]}
        for item in items if item['id'] in answers]}
    for record, item in zip(names['objects'], [i for i in items if i['id'] in answers]):
        record['frameEvidence'] = item['frameEvidence']
    evidence = {'provider': provider, 'requested_model': requested, 'model': served, 'prompt_version': version,
                'objects_separated': len(separated), ('objects_checked' if detect else 'objects_sent'): len(items),
                'crops_sent': sum(len(i['crops']) for i in items),
                'answered': len(answers), 'skipped': skipped + [{'id': f"object_{i['id']}", 'reason': 'no answer'} for i in items if i['id'] not in answers],
                'usage': usage, 'elapsed_seconds': round(time.monotonic() - started, 3), 'reviewed': False,
                'frame_evidence': {'bound': all(v.get('binding_status') == 'ordered-source-subset' for v in views),
                                   'frames': len(views), 'scope': 'Raster/geometry association; naming remains an unreviewed suggestion.'}}
    return names, evidence
