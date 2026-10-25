"""Scale from standard-size references in a walkthrough: things whose size a published standard fixes.

1. Claude looks at frames of the walkthrough and finds references from a closed list (an A4 sheet, a lay-in ceiling
   tile, a EUR pallet...). For each, it gives the frame and the face's four corners. A pillow, a mug or a chair has
   no standard size and is not on the list.
2. Claude's corners only say where to look. Model pixel coordinates are good to a few percent of the image, and 1% of
   a 1280-pixel frame is 13 pixels: 4 cm at 3 m. Each side of the face is found again in the image itself, from the
   strongest edge across a band around it, fitted as a line through sub-pixel edge points. The corners are where the
   lines meet.
3. The face's plane comes from the reconstruction's own points that fall on it (or around it, for a sheet on a wall).
   Each corner is the ray from the camera through the refined pixel, cut by that plane.
4. Each edge gives metres per unit: standard length / measured length. A face whose measured proportions do not match
   the standard's (more than 3% off) is misidentified or badly cornered, and is rejected. That check needs no scale.

The result is independent evidence about scale, never verification:
- one reference instance gives `single-reference`;
- two or more instances that agree within 2% give `cross-checked`;
- otherwise the result is `conflicting`, with every estimate shown.

The sizes are the standards' nominal sizes, with their tolerances; the objects in the room may not be standard.
Detections may also come from a file (`--detections`) instead of Claude, for tests and for a person's own picks.

usage: python reference_scale.py --reconstruction <reconstruction job dir> --out reference-scale.json
                                 [--detections detections.json] [--frames 12] [--expected-metres-per-unit K]
       python reference_scale.py --input-manifest <worker job input.json>   (the worker engine)
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import math
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))

MODEL = 'claude-opus-5-5'
PROMPT_VERSION = 'brainsnn-reference-scale-v1'
SHAPE_TOLERANCE = .03     # measured proportions within 3% of the standard's
AGREEMENT = .02           # instances agreeing within 2% are cross-checked
FRAME_EDGE = 1280         # pixels on the longer side of each frame sent
MIN_EDGE_PIXELS = 40      # a face edge shorter than this in the image is too small to measure (1 px is 2.5% of it)

# Standard sizes. `size` is [long edge, short edge] of the face Claude marks, in metres; `tolerance` is the standard's
# own, on each edge. Values were checked against the sources listed; an entry with no checked source is left out.
REFERENCES = {
    'iso-a4-sheet': {'label': 'A4 sheet of paper (ISO 216), lying flat on a wall, board, door or table',
                     'size': [.297, .210], 'tolerance': .002, 'standard': 'ISO 216 (A4, 210 x 297 mm, +/-2 mm)',
                     'source': 'https://papersizes.org/a-paper-sizes.htm'},
    'iso-a3-sheet': {'label': 'A3 sheet of paper (ISO 216), lying flat on a wall, board, door or table',
                     'size': [.420, .297], 'tolerance': .002, 'standard': 'ISO 216 (A3, 297 x 420 mm, +/-2 mm)',
                     'source': 'https://papersizes.org/a-paper-sizes.htm'},
    'ceiling-tile-600': {'label': 'lay-in ceiling tile in a metric 600 mm suspended grid (the tile face, inside the grid)',
                         'size': [.595, .595], 'tolerance': .0005, 'standard': 'EN 13964 600 mm module; lay-in tile 595 mm',
                         'source': 'https://cdn.mediavalet.com/aunsw/autex/2P1vrOWCVE6M_vSFlSrEdw/f5ZQQpLQrU6jl2vud2IzSQ/Original/Grid%20Ceiling%20Tiles_Data%20Sheet.pdf'},
    'eur-pallet': {'label': 'EUR / EPAL wooden pallet, its top deck seen from above or its long side',
                   'size': [1.200, .800], 'tolerance': .003, 'standard': 'EN 13698-1 (800 x 1200 x 144 mm)',
                   'source': 'https://en.wikipedia.org/wiki/EUR-pallet'},
}
# Recognised but not measured: the plane method needs a flat face, and a 12 cm can measures to ~10% in a sparse cloud.
UNMEASURED = {
    'beverage-can-355ml': {'label': '12 fl oz (355 ml) beverage can', 'size': [.1222, .066],
                           'standard': 'industry 211 x 413 can, 4.81 in tall, 2.60 in body',
                           'source': 'https://www.tricorbraun.com/12-oz-silver-aluminum-standard-brite-can-202-diameter.html',
                           'reason': 'not flat, and too small to measure in a sparse reconstruction'},
}

SYSTEM = (
    "You find reference objects of a known standard size in frames from a walkthrough video of an indoor space. The "
    "sizes set the scale of a 3D model, so only objects on the list count, and only when they plainly are that object "
    "at that standard size. A sheet that might be US Letter rather than A4, a tile that might be a 2 ft tile, a pallet "
    "that might not be a EUR pallet: leave it out, or give low confidence. Never use objects without a standard size "
    "(pillows, mugs, chairs, books, posters).\n\n"
    "For each reference whose whole face is visible in a frame, return that frame's index and the face's four corners "
    "as pixel coordinates in the image as you received it: x to the right, y down, origin at the top-left, in order "
    "around the face starting from its top-left corner. Corners only need to be close; they are refined from the image. "
    "The same object may be listed from several frames. If no reference is visible, return an empty list.")


def response_schema():
    corner = {'type': 'array', 'items': {'type': 'number'}, 'minItems': 2, 'maxItems': 2}
    return {'type': 'object', 'additionalProperties': False, 'required': ['references'], 'properties': {'references': {
        'type': 'array', 'items': {'type': 'object', 'additionalProperties': False,
                                   'required': ['id', 'frame', 'corners', 'confidence', 'reason'],
                                   'properties': {'id': {'type': 'string', 'enum': sorted(REFERENCES) + sorted(UNMEASURED)},
                                                  'frame': {'type': 'integer'},
                                                  'corners': {'type': 'array', 'items': corner, 'minItems': 4, 'maxItems': 4},
                                                  'confidence': {'type': 'string', 'enum': ['low', 'medium', 'high']},
                                                  'reason': {'type': 'string'}}}}}}


class ReferenceSkipped(Exception):
    """No reference could be found or measured; the scale stays as it was and the report says why."""


# ---------- frames and cameras ----------

def views(source_dir: Path):
    """Registered frames with their camera: object_names.colmap_views plus the unprojection (pixel -> normalised ray)."""
    import numpy as np
    import pycolmap
    try:
        from .object_names import colmap_views, selected_model, NamingSkipped
    except ImportError:
        from object_names import colmap_views, selected_model, NamingSkipped
    try:
        out = colmap_views(source_dir)
        model = pycolmap.Reconstruction(str(selected_model(Path(source_dir).resolve() / 'colmap-work' / 'sparse')))
    except NamingSkipped as error:
        raise ReferenceSkipped(str(error)) from error
    cameras = {model.image(i).name: model.camera(model.image(i).camera_id) for i in model.reg_image_ids()}
    for v in out:
        cam = cameras[v['name']]
        v['unproject'] = lambda uv, cam=cam: np.asarray(cam.cam_from_img(np.asarray(uv, float).reshape(-1, 2)), float)
    points = np.asarray([p.xyz for p in model.points3D.values()], float)
    return out, points


def pick_frames(all_views, count):
    """`count` frames spread evenly through the walkthrough, in order."""
    if len(all_views) <= count:
        return list(all_views)
    step = len(all_views) / count
    return [all_views[int(i * step)] for i in range(count)]


def jpeg(path, edge=FRAME_EDGE):
    """The frame as sent (JPEG, longer side at most `edge`) and the factor from sent pixels to the frame's own."""
    from PIL import Image
    image = Image.open(path).convert('RGB'); factor = max(1.0, max(image.size) / edge)
    if factor > 1:
        image = image.resize((round(image.width / factor), round(image.height / factor)), Image.LANCZOS)
    out = io.BytesIO(); image.save(out, format='JPEG', quality=90)
    return out.getvalue(), factor


# ---------- Claude ----------

def ask(client, frames):
    """One request with every frame. Returns (detections in each frame's own pixels, served model, usage)."""
    content = [{'type': 'text', 'text': 'The reference list (id: what it is, standard face size):\n' + '\n'.join(
        f"- {k}: {r['label']}, {r['size'][0] * 1000:g} x {r['size'][1] * 1000:g} mm" for k, r in {**REFERENCES, **UNMEASURED}.items())}]
    sent = []
    for i, view in enumerate(frames):
        data, factor = jpeg(view['path']); sent.append(factor)
        content += [{'type': 'text', 'text': f'Frame {i}:'},
                    {'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/jpeg', 'data': base64.standard_b64encode(data).decode('ascii')}}]
    content.append({'type': 'text', 'text': 'List every reference from the list that you can see, with its frame and corners.'})
    response = client.beta.messages.create(
        model=MODEL, max_tokens=8000, system=SYSTEM, messages=[{'role': 'user', 'content': content}],
        output_config={'effort': 'high', 'format': {'type': 'json_schema', 'schema': response_schema()}},
        betas=['server-side-fallback-2026-07-01'], fallbacks='default')
    if response.stop_reason == 'refusal':
        raise ReferenceSkipped('The model declined to look for references.')
    if response.stop_reason == 'max_tokens':
        raise ReferenceSkipped('The model answer was cut off before it finished.')
    text = next((b.text for b in response.content if getattr(b, 'type', None) == 'text'), None)
    try:
        answer = json.loads(text or '')
    except json.JSONDecodeError as error:
        raise ReferenceSkipped('The model answer was not valid JSON.') from error
    found = []
    for entry in answer.get('references', []) if isinstance(answer, dict) else []:
        if not isinstance(entry, dict) or entry.get('id') not in {**REFERENCES, **UNMEASURED}:
            continue
        k = entry.get('frame')
        if not isinstance(k, int) or not 0 <= k < len(frames) or entry.get('confidence') not in ('low', 'medium', 'high'):
            continue
        corners = entry.get('corners')
        if not (isinstance(corners, list) and len(corners) == 4 and all(isinstance(c, list) and len(c) == 2 for c in corners)):
            continue
        found.append({'id': entry['id'], 'frame': frames[k]['name'], 'corners': [[float(x) * sent[k], float(y) * sent[k]] for x, y in corners],
                      'confidence': entry['confidence'], 'reason': str(entry.get('reason', ''))[:200], 'by': 'model'})
    usage = getattr(response, 'usage', None)
    return found, str(getattr(response, 'model', MODEL)), {'input_tokens': getattr(usage, 'input_tokens', None),
                                                          'output_tokens': getattr(usage, 'output_tokens', None)}


# ---------- refine corners from the image ----------

def refine(gray, corners, band=None, samples=40):
    """The quad's corners found again in the image (float H x W grey): each side becomes the line through the strongest
    edge across a band about it, located to a fraction of a pixel; adjacent lines meet at the corners. Returns
    (corners, per-side support) or (None, reason)."""
    import numpy as np
    Q = np.asarray(corners, float); H, W = gray.shape
    gy, gx = np.gradient(gray)
    def sample(img, pts):  # bilinear
        x = np.clip(pts[:, 0], 0, W - 1.001); y = np.clip(pts[:, 1], 0, H - 1.001); x0, y0 = x.astype(int), y.astype(int); fx, fy = x - x0, y - y0
        return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x0 + 1] * fx * (1 - fy) + img[y0 + 1, x0] * (1 - fx) * fy + img[y0 + 1, x0 + 1] * fx * fy)
    lines, support = [], []
    for s in range(4):
        a, b = Q[s], Q[(s + 1) % 4]; d = b - a; length = float(np.linalg.norm(d))
        if length < MIN_EDGE_PIXELS:
            return None, f'side {s + 1} is {length:.0f} px, under {MIN_EDGE_PIXELS}'
        d /= length; n = np.array([-d[1], d[0]]); half = band or max(6.0, .06 * length)
        offsets = np.linspace(-half, half, int(2 * half) * 4 + 1); pts = []
        for t in np.linspace(.15, .85, samples):  # away from the corners, where the neighbouring side's edge is
            line = a + t * length * d + offsets[:, None] * n
            g = np.abs(sample(gx, line) * n[0] + sample(gy, line) * n[1])  # gradient across the side
            k = int(g.argmax())
            if g[k] < 4 * np.median(g) + 1e-3 or k in (0, len(g) - 1):
                continue
            y0, y1, y2 = g[k - 1], g[k], g[k + 1]; shift = .5 * (y0 - y2) / (y0 - 2 * y1 + y2) if y0 - 2 * y1 + y2 != 0 else 0
            pts.append(a + t * length * d + (offsets[k] + shift * (offsets[1] - offsets[0])) * n)
        if len(pts) < samples * .6:
            return None, f'side {s + 1} has a clear edge at {len(pts)} of {samples} places'
        P = np.asarray(pts); c = P.mean(0)
        for _ in range(3):  # least squares, then drop points more than 1.5 px off, twice
            u = np.linalg.svd(P - c)[2][0]; m = np.array([-u[1], u[0]]); r = np.abs((P - c) @ m)
            keep = r < max(1.5, 2.5 * np.median(r)); P, c = P[keep], P[keep].mean(0)
        u = np.linalg.svd(P - c)[2][0]; lines.append((c, u)); support.append(len(P))
    out = []
    for s in range(4):
        (c1, u1), (c2, u2) = lines[(s - 1) % 4], lines[s]
        A = np.array([u1, -u2]).T
        if abs(np.linalg.det(A)) < 1e-6:
            return None, 'two sides are parallel'
        t = np.linalg.solve(A, c2 - c1); out.append(c1 + t[0] * u1)
    out = np.asarray(out)
    if np.linalg.norm(out - Q, axis=1).max() > max(12.0, .25 * min(np.linalg.norm(Q[1] - Q[0]), np.linalg.norm(Q[2] - Q[1]))):
        return None, 'the edges found are far from the corners given'
    return out, support


# ---------- measure in the reconstruction ----------

def measure(view, corners, points, margin=.25):
    """The face's corners in reconstruction coordinates: rays through the pixels, cut by the plane of the cloud points
    seen on (or around) the face. Returns (4 x 3 corners, plane points used) or (None, reason)."""
    import numpy as np
    Q = np.asarray(corners, float); M = view['cam_from_world']; R, t = M[:, :3], M[:, 3]
    cam = points @ R.T + t; front = cam[:, 2] > 1e-6; uv = np.full((len(points), 2), np.nan)
    if front.any(): uv[front] = view['project'](cam[front])
    centre = Q.mean(0)
    seen = front & np.isfinite(uv).all(1); uvz = np.where(seen[:, None], uv, 0.0)
    def inside(scale):  # the points whose pixels fall inside the quad grown about its centre by `scale`
        poly = centre + (Q - centre) * scale
        side = [(poly[(k + 1) % 4, 0] - poly[k, 0]) * (uvz[:, 1] - poly[k, 1]) - (poly[(k + 1) % 4, 1] - poly[k, 1]) * (uvz[:, 0] - poly[k, 0]) for k in range(4)]
        side = np.asarray(side)
        return seen & ((side >= 0).all(0) | (side <= 0).all(0))
    sel = inside(1 + margin)
    if sel.sum() < 8:
        sel = inside(2.0)  # a sheet on a wall: the wall around it is the same plane
    if sel.sum() < 8:
        return None, f'{int(sel.sum())} reconstructed points on or around the face'
    P = points[sel]; d = np.linalg.norm(cam[sel], axis=1)
    near = d <= np.percentile(d, 60) * 1.15  # the surface itself, not points seen past its edge
    P = P[near] if near.sum() >= 8 else P
    best = None; rng = np.random.default_rng(0)
    scale = np.median(np.linalg.norm(P - P.mean(0), axis=1)) + 1e-12
    for _ in range(200):
        a, b, c = P[rng.choice(len(P), 3, replace=False)]; n = np.cross(b - a, c - a)
        if np.linalg.norm(n) < 1e-12: continue
        n /= np.linalg.norm(n); r = np.abs((P - a) @ n); inl = r < .03 * scale
        if best is None or inl.sum() > best.sum(): best = inl
    if best is None or best.sum() < 6:
        return None, 'no plane through the points on the face'
    S = P[best]; c = S.mean(0); n = np.linalg.svd(S - c)[2][2]
    C = -R.T @ t; rays = view['unproject'](Q); out = []
    for x, y in rays:
        d = R.T @ np.array([x, y, 1.0]); den = float(n @ d)
        if abs(den) < 1e-9: return None, 'a corner ray runs along the face'
        out.append(C + d * float(n @ (c - C)) / den)
    return np.asarray(out), int(best.sum())


def estimate(ref, P3):
    """Metres per unit from one measured face, its proportions check and the edges' own lengths."""
    import numpy as np
    sides = [float(np.linalg.norm(P3[(k + 1) % 4] - P3[k])) for k in range(4)]
    a, b = (sides[0] + sides[2]) / 2, (sides[1] + sides[3]) / 2
    long_, short = max(a, b), min(a, b); L, S = ref['size']
    shape = (long_ / short) / (L / S) - 1
    k_long, k_short = L / long_, S / short
    return {'sidesUnits': [round(s, 6) for s in sides], 'shapeError': round(shape, 4),
            'metresPerUnit': (k_long * L + k_short * S) / (L + S), 'fromLongEdge': k_long, 'fromShortEdge': k_short}


def combine(measured, extent):
    """Instances: detections of the same reference within 5% of the cloud's extent are one object seen again (their
    median). The result: the median over instances, the largest relative difference from it, and a status."""
    import numpy as np
    instances = []
    for m in measured:
        home = next((g for g in instances if g['id'] == m['id'] and np.linalg.norm(np.asarray(g['centre']) - m['centre']) < .05 * extent), None)
        if home: home['members'].append(m)
        else: instances.append({'id': m['id'], 'centre': m['centre'], 'members': [m]})
    for g in instances:
        g['metresPerUnit'] = float(np.median([m['metresPerUnit'] for m in g['members']]))
        g['centre'] = [round(float(v), 6) for v in g['centre']]; g['detections'] = len(g.pop('members'))
    if not instances:
        return None, 'none', None, instances
    k = float(np.median([g['metresPerUnit'] for g in instances]))
    spread = max(abs(g['metresPerUnit'] / k - 1) for g in instances)
    status = 'single-reference' if len(instances) == 1 else 'cross-checked' if spread <= AGREEMENT else 'conflicting'
    return k, status, spread, instances


def run(source_dir, *, detections=None, client=None, frames=12, log=print):
    """reference-scale.json for a reconstruction job: detections from `detections` (a list) or from Claude."""
    import numpy as np
    from PIL import Image
    started = time.monotonic(); all_views, points = views(source_dir); by_name = {v['name']: v for v in all_views}
    model, usage, sent = None, None, 0
    if detections is None:
        if client is None:
            import anthropic
            client = anthropic.Anthropic()
        chosen = pick_frames(all_views, frames); sent = len(chosen)
        log(f'asking for references in {sent} frames')
        detections, model, usage = ask(client, chosen)
    extent = float(np.linalg.norm(np.percentile(points, 98, axis=0) - np.percentile(points, 2, axis=0)))
    results, measured = [], []
    for det in detections:
        row = {k: det[k] for k in ('id', 'frame', 'confidence', 'by') if k in det}
        if det['id'] in UNMEASURED:
            results.append({**row, 'used': False, 'reason': UNMEASURED[det['id']]['reason']}); continue
        view = by_name.get(det['frame'])
        if view is None or det['id'] not in REFERENCES:
            results.append({**row, 'used': False, 'reason': 'unknown frame or reference'}); continue
        if det.get('confidence') == 'low':
            results.append({**row, 'used': False, 'reason': 'low confidence'}); continue
        gray = np.asarray(Image.open(view['path']).convert('L'), float)
        corners, support = refine(gray, det['corners'])
        if corners is None:
            results.append({**row, 'used': False, 'reason': f'corners not found in the image: {support}'}); continue
        P3, plane = measure(view, corners, points)
        if P3 is None:
            results.append({**row, 'used': False, 'reason': plane}); continue
        e = estimate(REFERENCES[det['id']], P3)
        row.update(givenCorners=[[round(v, 1) for v in c] for c in det['corners']], refinedCorners=[[round(float(v), 2) for v in c] for c in corners],
                   edgeSupport=support, planePoints=plane, **{k: (round(v, 6) if isinstance(v, float) else v) for k, v in e.items()})
        if abs(e['shapeError']) > SHAPE_TOLERANCE:
            results.append({**row, 'used': False, 'reason': f"proportions {e['shapeError'] * 100:+.1f}% off the standard's"}); continue
        results.append({**row, 'used': True}); measured.append({'id': det['id'], 'centre': P3.mean(0), 'metresPerUnit': e['metresPerUnit']})
    k, status, spread, instances = combine(measured, extent)
    return {'schema': 'brainsnn.reference-scale.v1', 'status': status, 'metresPerUnit': k and round(k, 6),
            'spreadRelative': spread if spread is None else round(spread, 4), 'instances': instances, 'detections': results,
            'references': {key: {'size': r['size'], 'tolerance': r['tolerance'], 'standard': r['standard'], 'source': r['source']} for key, r in REFERENCES.items()},
            'model': model, 'prompt_version': PROMPT_VERSION if model else None, 'frames_sent': sent, 'usage': usage,
            'elapsed_seconds': round(time.monotonic() - started, 2), 'verified': False,
            'caveats': ['Each estimate assumes the object is the standard size; a non-standard sheet or tile scales the model wrongly.',
                        'Cross-checked means independent references agree, not that the scale is surveyed or certified.',
                        'Detections are suggestions; corners are refined from the image and the face from the reconstruction.']}


def against_handoff(report, cloud):
    """The reference scale in the hand-off's own units, and against the scale typed into it, if any."""
    import numpy as np
    M = np.asarray(cloud.get('fromSource'), float)
    if M.shape != (3, 4) or not report['metresPerUnit']:
        return None
    units_per_source = abs(float(np.linalg.det(M[:, :3]))) ** (1 / 3)  # hand-off units per reconstruction unit
    out = {'units': cloud.get('units'), 'unitsPerReconstructionUnit': round(units_per_source, 9),
           'metresPerHandoffUnit': round(report['metresPerUnit'] / units_per_source, 6)}
    scale = cloud.get('scale') or {}
    if cloud.get('units') == 'm' and isinstance(scale.get('metresPerUnit'), (int, float)):
        # The hand-off is already metric from a typed span: one hand-off unit should be one metre.
        out['typedScaleRelativeDifference'] = round(out['metresPerHandoffUnit'] - 1, 5)
        out['agreesWithTypedScale'] = abs(out['metresPerHandoffUnit'] - 1) <= AGREEMENT
    return out


def adapter(manifest_path):
    """The worker engine: the hand-off cloud as input, the reconstruction job as its source. Writes
    reference-scale.json and manifest.json to the job's output. Frames go to Anthropic: the site asks first."""
    request = json.loads(Path(manifest_path).read_text()); out = Path(request['output_dir'])
    source = request.get('source') or {}
    if not source.get('path') or source.get('missing'):
        raise SystemExit('Reference scale needs the reconstruction job as its source job.')
    clouds = [i for i in request.get('inputs', []) if i.get('kind') == 'cloud']
    cloud = json.loads(Path(clouds[0]['path']).read_text()) if clouds else {}
    try:
        report = run(Path(source['path']))
    except ReferenceSkipped as error:
        report = {'schema': 'brainsnn.reference-scale.v1', 'status': 'none', 'metresPerUnit': None, 'reason': str(error), 'verified': False}
    if cloud and report.get('metresPerUnit'):
        report['handoff'] = against_handoff(report, cloud)
    (out / 'reference-scale.json').write_text(json.dumps(report, indent=1))
    (out / 'manifest.json').write_text(json.dumps({'artifacts': [{'name': 'reference-scale.json', 'kind': 'scale-evidence'}]}))
    print('REFERENCE_SCALE_OK', json.dumps({k: report.get(k) for k in ('status', 'metresPerUnit', 'spreadRelative')}), flush=True)


def main(argv=None):
    if argv is None and '--input-manifest' in sys.argv:
        return adapter(sys.argv[sys.argv.index('--input-manifest') + 1])
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--reconstruction', type=Path, required=True, help='reconstruction job directory (output/ and colmap-work/)')
    ap.add_argument('--out', type=Path, required=True)
    ap.add_argument('--detections', type=Path, help='detections JSON (a list of {id, frame, corners, confidence}) instead of asking Claude')
    ap.add_argument('--frames', type=int, default=12)
    ap.add_argument('--expected-metres-per-unit', type=float, help='a known scale to compare with (a benchmark truth or a taped span)')
    a = ap.parse_args(argv)
    detections = json.loads(a.detections.read_text()) if a.detections else None
    try:
        report = run(a.reconstruction, detections=detections, frames=a.frames)
    except ReferenceSkipped as error:
        sys.exit(f'No reference scale: {error}')
    if a.expected_metres_per_unit and report['metresPerUnit']:
        report['against'] = {'metresPerUnit': a.expected_metres_per_unit, 'relativeError': round(report['metresPerUnit'] / a.expected_metres_per_unit - 1, 5)}
    a.out.write_text(json.dumps(report, indent=1))
    print(json.dumps({k: report[k] for k in ('status', 'metresPerUnit', 'spreadRelative')} | ({'against': report['against']} if 'against' in report else {})))


if __name__ == '__main__':
    main()
