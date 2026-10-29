"""Source-bound IFC and calibrated-image handoff for building review.

The PNG is a plan underlay that an operator can scale and trace in Xactimate.
It is not an ESX/SKX project, an inferred room polygon, or a physical accuracy
certificate. The existing typed IFC is the Revit interchange artifact; this
module does not write RVT or claim native-element editing has been validated.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile

try:
    from . import cad_export
    from .geometry import _finite
except ImportError:  # Direct worker/script execution.
    import cad_export
    from geometry import _finite

from component_graph import ensure_component_ids, scene_sha256, MAX_SCENE_BYTES

SCHEMA = 'brainsnn.building-handoff.v1'
FILES = ('xactimate-underlay.png', 'building-schedule.csv', 'BUILDING-IMPORT.txt', 'building-handoff.json')
FEET_PER_METRE = 1 / .3048
IMAGE_WIDTH, IMAGE_HEIGHT = 1800, 1400
DRAWING_BOX = (90, 185, 1710, 1085)
COLOURS = {'wall': '#263548', 'object': '#a5aeb9', 'unknown': '#f1c9db',
           'unknown_line': '#b36889', 'opening': '#007db3', 'extent': '#bac2cc'}


def _metric_reason(scene):
    if scene.get('units') != 'm':
        return 'Building handoff needs a metric scene; set a measured scale first.'
    scale = scene.get('scale')
    # Match the current geometry.load_arena_cloud policy. A camera trajectory
    # or a guessed standard object size is not a supported metric bypass.
    if not (isinstance(scale, dict) and scale.get('source') == 'user-measured'
            and _finite(scale.get('metresPerUnit')) and scale['metresPerUnit'] > 0
            and scale.get('selfReported') is True and scale.get('verified') is False
            and all(scale.get(k) is None or (_finite(scale[k]) and scale[k] > 0)
                    for k in ('distance', 'spanUnits'))):
        return 'Building handoff requires the existing self-reported, unverified measured-scale contract.'
    return None


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate scene JSON fields are not accepted.')
        result[key] = value
    return result


def _source(scene, scene_path):
    canonical_hash = scene_sha256(scene)
    if scene_path is None:
        return {'sha256': canonical_hash, 'binding': 'canonical-json'}, canonical_hash
    path = Path(scene_path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_SCENE_BYTES:
        raise ValueError('Scene file must be a bounded regular JSON file.')
    raw = path.read_bytes()
    try:
        parsed = json.loads(raw, object_pairs_hook=_unique_object)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as error:
        raise ValueError('Scene file is not valid JSON.') from error
    if scene_sha256(parsed) != canonical_hash:
        raise ValueError('Scene file bytes do not match the supplied scene.')
    return {'name': path.name, 'sha256': hashlib.sha256(raw).hexdigest(),
            'bytes': len(raw), 'binding': 'exact-file-bytes'}, canonical_hash


def _geometry(scene):
    if not _finite(scene.get('floor_y')):
        raise ValueError('The scene needs a finite floor elevation.')
    unknown = scene.get('unknown', [])
    if not isinstance(unknown, list) or len(unknown) > 250_000:
        raise ValueError('Unknown-space cells must be a bounded array.')
    for cell in unknown:
        if (not isinstance(cell, list) or len(cell) != 3 or not all(_finite(v) for v in cell)
                or max(abs(cell[0]), abs(cell[1])) > 10_000_000 or not 0 < cell[2] <= 100_000):
            raise ValueError('Unknown-space cells need finite x, z and a positive size.')
    items = cad_export.elements(scene)
    for item in items:
        for point in item['corners']:
            if not all(_finite(v) and abs(v) <= 10_100_000 for v in point):
                raise ValueError('Plan coordinates must be finite and bounded.')
        for key in ('length', 'width', 'height', 'base'):
            if not _finite(item[key]):
                raise ValueError('Plan dimensions must be finite.')
        if any(item[k] <= 0 for k in ('length', 'width', 'height')):
            raise ValueError('Plan dimensions must be positive.')
    if not items:
        raise ValueError('There is no placed geometry to draw.')
    return items


def _transform(items):
    points = [point for item in items for point in item['corners']]
    x0, x1 = min(p[0] for p in points), max(p[0] for p in points)
    y0, y1 = min(p[1] for p in points), max(p[1] for p in points)
    dx, dy = x1 - x0, y1 - y0
    if dx < .001 or dy < .001 or max(dx, dy) > 100_000:
        raise ValueError('Plan footprint is degenerate or too large.')
    left, top, right, bottom = DRAWING_BOX
    factor = min((right - left) / dx, (bottom - top) / dy)
    # One scalar governs both axes. Pixel Y increases down, plan Y increases up.
    origin = [left + ((right - left) - dx * factor) / 2 - x0 * factor,
              top + ((bottom - top) - dy * factor) / 2 + y1 * factor]
    return {'coordinateFrame': 'plan-x-minus-z', 'sceneToPlan': ['x', '-z'],
            'pixelsPerMetre': factor, 'pixelOrigin': origin,
            'planBoundsMetres': {'min': [x0, y0], 'max': [x1, y1]},
            'imageSizePixels': [IMAGE_WIDTH, IMAGE_HEIGHT],
            'equations': ['pixelX = pixelOrigin[0] + planX * pixelsPerMetre',
                          'pixelY = pixelOrigin[1] - planY * pixelsPerMetre']}


def _pixel(point, transform):
    factor = transform['pixelsPerMetre']; x, y = transform['pixelOrigin']
    return (x + point[0] * factor, y - point[1] * factor)


def _calibration(transform):
    maximum = 580 / transform['pixelsPerMetre']
    magnitude = 10 ** math.floor(math.log10(maximum))
    length = max(n * magnitude for n in (.1, .2, .5, 1, 2, 5) if n * magnitude <= maximum)
    start = [105.0, 1300.0]
    end = [start[0] + length * transform['pixelsPerMetre'], start[1]]
    return {'kind': 'drawn-model-scale-ruler', 'lengthMetres': length,
            'lengthFeet': length * FEET_PER_METRE, 'startPixel': start, 'endPixel': end,
            'independentMeasurement': False,
            'instruction': 'Select the centres of the ruler end ticks in Xactimate and enter the stated length. '
                           'This preserves the supplied model scale; it does not verify physical dimensions.'}


def _opening_records(scene):
    walls = {w['name']: w for w in scene.get('walls', [])}
    result = []
    for opening in scene.get('openings', []):
        wall = walls[opening['hostWall']]
        angle = math.radians(wall.get('yaw_degrees', 0))
        start = opening['offsetMeters'] - wall['size'][0] / 2
        points = [[wall['centre'][0] + along * math.cos(angle),
                   -(wall['centre'][2] + along * math.sin(angle))]
                  for along in (start, start + opening['widthMeters'])]
        result.append({'componentId': opening['componentId'], 'hostComponentId': opening['hostComponentId'],
                       'id': opening['id'], 'kind': opening['kind'], 'planEndpointsMetres': points,
                       'widthMetres': opening['widthMeters'], 'heightMetres': opening['heightMeters'],
                       'sillMetres': opening['sillMeters'], 'reviewed': True,
                       'reviewScope': 'operator-authored geometry; physical dimensions unverified',
                       'provenance': opening.get('provenance', 'operator-reviewed-reference')})
    return result


def _font(size, bold=False):
    from PIL import ImageFont
    try:
        return ImageFont.truetype('DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf', size)
    except OSError:
        return ImageFont.load_default(size=size)


def _dashed(draw, points, *, fill, width=2, dash=9):
    for a, b in zip(points, points[1:]):
        length = math.dist(a, b)
        if length <= 0:
            continue
        for i in range(math.ceil(length / (dash * 2))):
            start = min(i * dash * 2 / length, 1)
            end = min((i * dash * 2 + dash) / length, 1)
            draw.line([(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
                       for t in (start, end)], fill=fill, width=width)


def _draw(path, scene, items, transform, ruler, openings):
    from PIL import Image, ImageDraw
    image = Image.new('RGB', (IMAGE_WIDTH, IMAGE_HEIGHT), 'white'); draw = ImageDraw.Draw(image)
    # Protect every geometric feature before placing any labels. Checking only
    # the labelled wall allows a label to erase another wall at an intersection.
    protected = Image.new('L', (IMAGE_WIDTH, IMAGE_HEIGHT), 0)
    mask = ImageDraw.Draw(protected)
    for item in items:
        if item['kind'] in ('wall', 'unknown', 'object'):
            for polygon in item.get('plan_parts', [item['corners']]):
                points = [_pixel(p, transform) for p in polygon]
                mask.polygon(points, fill=255)
                mask.line(points + points[:1], fill=255, width=4)
        elif item['kind'] == 'floor':
            points = [_pixel(p, transform) for p in item['corners']]
            mask.line(points + points[:1], fill=255, width=4)
    for opening in openings:
        mask.line([_pixel(p, transform) for p in opening['planEndpointsMetres']], fill=255, width=12)
    ink = COLOURS['wall']
    draw.text((90, 38), 'BrainSNN | Building plan for review', fill=ink, font=_font(36, True))
    draw.text((90, 90), 'UNVERIFIED DIMENSIONS  |  Xactimate underlay: scale and trace',
              fill='#9b4724', font=_font(25, True))
    draw.text((90, 130), 'Wall positions and openings are model geometry. Closed room boundaries have not been established.',
              fill='#526072', font=_font(22))
    # Show the floor's bounding extent as a dashed reference only. No filled
    # rectangle can be mistaken for an inferred closed room or a finish quantity.
    for item in items:
        corners = [_pixel(p, transform) for p in item['corners']]
        if item['kind'] == 'floor':
            _dashed(draw, corners + corners[:1], fill=COLOURS['extent'])
        elif item['kind'] == 'unknown':
            draw.polygon(corners, fill=COLOURS['unknown'], outline=COLOURS['unknown_line'])
            # The cells are axis-aligned in this plan. Clip each hatch to its cell.
            x0, x1 = min(p[0] for p in corners), max(p[0] for p in corners)
            y0, y1 = min(p[1] for p in corners), max(p[1] for p in corners)
            for delta in range(0, math.ceil(x1 - x0 + y1 - y0), 18):
                sx, sy = max(x0, x0 + delta - (y1 - y0)), min(y1, y0 + delta)
                ex, ey = min(x1, x0 + delta), max(y0, y0 + delta - (x1 - x0))
                draw.line([(sx, sy), (ex, ey)], fill=COLOURS['unknown_line'], width=1)
        elif item['kind'] == 'object':
            draw.line(corners + corners[:1], fill=COLOURS['object'], width=2)
    wall_index = 0
    for item in items:
        if item['kind'] != 'wall':
            continue
        wall_index += 1
        for polygon in item.get('plan_parts', [item['corners']]):
            draw.polygon([_pixel(p, transform) for p in polygon], fill=ink)
        centre = [sum(p[axis] for p in item['corners']) / 4 for axis in (0, 1)]
        px, py = _pixel(centre, transform)
        label = f'W{wall_index}  {item["length"]:.2f} m'
        font = _font(18, True); bounds = draw.textbbox((0, 0), label, font=font)
        tw, th = bounds[2] - bounds[0], bounds[3] - bounds[1]
        p0, p1 = [_pixel(p, transform) for p in item['corners'][:2]]
        span = math.dist(p0, p1); nx, ny = -(p1[1] - p0[1]) / span, (p1[0] - p0[0]) / span
        clearance = (abs(nx) * tw + abs(ny) * (th + 8)) / 2 + item['width'] * transform['pixelsPerMetre'] / 2 + 10
        # Geometry takes precedence over annotation. If both sides of the wall
        # are occupied, omit its plan label; its complete schedule row remains.
        candidates = [(px + sign * nx * (clearance + extra) - tw / 2,
                       py + sign * ny * (clearance + extra) - th / 2)
                      for extra in (0, 30, 60) for sign in (1, -1)]
        for x, y in candidates:
            box = (math.floor(x - 6), math.floor(y - 3), math.ceil(x + tw + 7), math.ceil(y + th + 11))
            if not (95 <= box[0] < box[2] <= IMAGE_WIDTH - 95 and 190 <= box[1] < box[3] <= 1090):
                continue
            if protected.crop(box).getbbox() is not None:
                continue
            draw.rectangle((x - 4, y - 1, x + tw + 4, y + th + 8), fill='white')
            draw.text((x, y), label, font=font, fill=ink)
            mask.rectangle(box, fill=255)  # Subsequent labels cannot erase it.
            break
    for opening in openings:
        points = [_pixel(p, transform) for p in opening['planEndpointsMetres']]
        # Raised openings remain a dashed overlay on the full plan wall;
        # floor-level openings use the same geometry convention as cad_export.
        _dashed(draw, points, fill=COLOURS['opening'], width=4, dash=7)
        for px, py in points:
            draw.ellipse((px - 4, py - 4, px + 4, py + 4), fill=COLOURS['opening'])
    draw.line([(90, 1130), (1710, 1130)], fill='#d8dde4', width=2)
    draw.text((90, 1155), 'Dark: walls   Blue: reviewed openings   Pink: unknown coverage   Grey outline: object envelope',
              fill=ink, font=_font(21))
    draw.text((90, 1190), 'Dotted extent is not a room boundary. No room floor area, ceiling area, material scope or cost is inferred.',
              fill='#526072', font=_font(21))
    distance = scene['scale'].get('distance')
    scale_note = 'Scale from a user-entered measured distance; self-reported and unverified.'
    if distance is not None:
        scale_note += f' Input distance: {distance:g} m.'
    draw.text((90, 1225), scale_note, fill='#526072', font=_font(20))
    a, b = tuple(ruler['startPixel']), tuple(ruler['endPixel'])
    draw.line([a, b], fill=ink, width=4)
    for x, y in (a, b):
        draw.line([(x, y - 13), (x, y + 13)], fill=ink, width=3)
    draw.text((90, 1330), f'Calibration ruler: {ruler["lengthMetres"]:g} m  /  {ruler["lengthFeet"]:.8g} ft',
              fill=ink, font=_font(22, True))
    draw.text((820, 1280), 'Select end-tick centres when setting image scale.', fill='#526072', font=_font(21))
    draw.text((820, 1315), 'Confirm physical dimensions before using quantities.', fill='#526072', font=_font(21))
    draw.text((820, 1350), f'Source {scene["componentGraph"]["sourceSha256"][:12]}  |  revision {scene["componentGraph"]["revision"]}',
              fill='#687586', font=_font(18))
    image.save(path, format='PNG', optimize=True)
    return {'imageSizePixels': [IMAGE_WIDTH, IMAGE_HEIGHT], 'drawingBoundsPixels': list(DRAWING_BOX)}


def _csv_text(value):
    text = str(value)
    # CSV quoting alone does not prevent spreadsheet formula evaluation.
    return "'" + text if text.lstrip().startswith(('=', '+', '-', '@')) else text


def _schedule(path, scene, items, openings, canonical_hash):
    fields = ['component_id', 'plan_label', 'kind', 'name', 'length_m', 'width_m', 'height_m', 'area_m2',
              'length_ft', 'width_ft', 'height_ft', 'area_ft2', 'quantity_basis', 'review_status',
              'provenance', 'source_sha256', 'scene_sha256', 'revision']
    records = []; wall_index = 0
    for item in items:
        if item['kind'] in ('unknown', 'door'):
            continue  # Coverage cells are not finish quantities; door is already a hosted opening row.
        length, width, height = item['length'], item['width'], item['height']
        if item['kind'] == 'wall':
            wall_index += 1; plan_label = f'W{wall_index}'
            area = item['net_face_area']; basis = 'net one-face wall geometry after reviewed voids; ' + item['thickness_properties']['ThicknessBasis']
        elif item['kind'] == 'floor':
            plan_label = ''; area = None; basis = 'bounding extent only; not a closed room or floor finish quantity'
        else:
            plan_label = ''; area = length * width; basis = 'object bounding-envelope plan area; not a building finish quantity'
        records.append((item['componentId'], plan_label, item['kind'], item.get('label') or item['name'],
                        length, width, height, area, basis, item['provenance']))
    for opening in openings:
        records.append((opening['componentId'], '', opening['kind'], opening['id'],
                        opening['widthMetres'], None, opening['heightMetres'],
                        opening['widthMetres'] * opening['heightMetres'],
                        'hosted opening area; operator-authored geometry; sill ' + str(opening['sillMetres']) + ' m',
                        opening['provenance']))
    def number(value):
        return '' if value is None else f'{value:.6f}'
    with path.open('w', newline='', encoding='utf-8') as stream:
        writer = csv.writer(stream); writer.writerow(fields)
        for cid, plan, kind, name, length, width, height, area, basis, provenance in records:
            writer.writerow([cid, plan, kind, _csv_text(name), *map(number, (length, width, height, area)),
                             *[number(v * FEET_PER_METRE) if v is not None else '' for v in (length, width, height)],
                             number(area * FEET_PER_METRE ** 2) if area is not None else '', _csv_text(basis),
                             'unverified', _csv_text(provenance), scene['componentGraph']['sourceSha256'],
                             canonical_hash, scene['componentGraph']['revision']])
    return len(records)


def _instructions(ruler):
    return f'''BrainSNN building handoff - unverified geometry for review

Revit
Use the accompanying scene.ifc when available. File > Open > IFC creates a
Revit model using the IFC import settings and template. Check scale, levels,
wall/opening geometry and intended editing behavior in the actual Revit version.
Link IFC is a reference workflow: the linked IFC elements are read-only in the
host model. This package does not include a native RVT or promise native families.

Xactimate desktop
1. Open Sketch > Options > Import > Import Underlay Image.
2. Select xactimate-underlay.png.
3. Select the centres of the two calibration-ruler end ticks and enter exactly
   {ruler['lengthMetres']:g} metres (or {ruler['lengthFeet']:.12g} feet).
4. Trace and review room boundaries, doors and other openings. Enter/check heights.
5. Compare with independent tape/laser measurements before using the estimate.
The PNG requires tracing. building-schedule.csv is a reference schedule, not an
Xactimate line-item or project import. The floor extent is not a closed room.

Direct Xactimate project integration
Verisk documents TPI ESX Return for provider capture data returned as an encrypted
ESX project. Production use needs the vendor's approved schema, endpoint,
agreement and credentials plus an actual Xactimate import test. This package
does not create ESX/SKX or advertise IFC/DXF/GLB/USD as Xactimate Sketch imports.

Evidence and limits
building-handoff.json binds the source/revision, image transform, ruler and
companion-file hashes. The ruler preserves model scale; it is not an independent
physical measurement. Unknown regions remain unknown. No closed room, ceiling,
finish/material scope, demolition/replacement decision, waste factor, damage,
price or certification is inferred. Simulation-library additions do not establish
captured dimensions.

Official destination references
https://help.autodesk.com/cloudhelp/2026/ENU/Revit-Model/files/GUID-21EFC097-96F3-428A-AFA4-BFEA4EDAB3D2.htm
https://help.autodesk.com/cloudhelp/2026/ENU/Revit-Model/files/GUID-BAA2ED9C-5107-4F21-ABE1-1ACF609AEEE3.htm
https://xactware.helpdocs.io/l/enUS/article/pdlwk5k8zd-importing-using-underlays
https://developerportal.verisk.com/solutions/estimation
'''


def write_building_handoff(scene: dict, output_dir: Path, *, scene_path: Path | None = None):
    """Write four coordinated artifacts; return evidence and manifest entries.

Nonmetric scenes or a missing Pillow dependency return written=False without
new files. Invalid/stale scene evidence raises ValueError. All content is built
in a private staging directory before any target file is published.
"""
    if not isinstance(scene, dict):
        raise ValueError('Use a scene JSON object.')
    reason = _metric_reason(scene)
    if reason:
        return {'written': False, 'reason': reason, 'artifacts': []}
    try:
        from PIL import Image  # noqa: F401
    except ImportError:
        return {'written': False, 'reason': 'Pillow is required for the calibrated PNG underlay.', 'artifacts': []}
    source, supplied_hash = _source(scene, scene_path)
    scene = ensure_component_ids(scene)
    items = _geometry(scene); transform = _transform(items); ruler = _calibration(transform)
    openings = _opening_records(scene)
    out = Path(output_dir); out.mkdir(parents=True, exist_ok=True)
    graph = scene['componentGraph']
    payload = {'schema': SCHEMA, 'units': 'm', 'metricVerified': False, 'physicalDimensionsVerified': False,
               'sourceFiles': {'scene': source}, 'canonicalSceneSha256': supplied_hash,
               'sourceSha256': graph['sourceSha256'], 'namespaceBasis': graph['namespaceBasis'],
               'componentRevision': graph['revision'], 'scale': scene['scale'],
               'planTransform': transform, 'calibration': ruler,
               'readiness': {'roomBoundaries': 'not-established', 'roomQuantities': False,
                             'ceilingQuantities': False, 'nativeRevitValidated': False,
                             'xactimateProjectGenerated': False, 'xactimateApplicationValidated': False},
               'destinations': {'revit': {'workflow': 'open-or-link-existing-ifc', 'nativeRvtGenerated': False},
                                'xactimate': {'workflow': 'calibrated-png-underlay-and-manual-trace',
                                              'directEsx': 'requires-approved-Verisk-integration'}},
               'walls': [{'componentId': item['componentId'], 'name': item['name'],
                          'planPolygonsMetres': item['plan_parts'],
                          'lengthMetres': item['length'], 'heightMetres': item['height'],
                          'thicknessMetres': item['width'], 'thicknessEvidence': item['thickness_properties'],
                          'provenance': item['provenance'],
                          **{k: item[k] for k in ('sourceProvenance', 'dimensionProvenance', 'parameterProvenance') if k in item}}
                         for item in items if item['kind'] == 'wall'],
               'openings': openings, 'unknownCells': len(scene.get('unknown', [])),
               'floorExtentIsRoomBoundary': False,
               'notes': ['The scale ruler reproduces model units and cannot verify the physical building.',
                         'No room or ceiling area is inferred from a bounding extent.',
                         'Quantities are geometric references; estimator scope and prices remain separate.']}
    if (out / 'scene.ifc').is_file():
        raw_ifc = (out / 'scene.ifc').read_bytes()
        payload['destinations']['revit']['existingIfc'] = {
            'name': 'scene.ifc', 'sha256': hashlib.sha256(raw_ifc).hexdigest(),
            'bytes': len(raw_ifc), 'geometryCorrespondenceValidated': False}
    with tempfile.TemporaryDirectory(prefix='.building-handoff-', dir=out) as temporary:
        stage = Path(temporary)
        _draw(stage / FILES[0], scene, items, transform, ruler, openings)
        payload['scheduleRows'] = _schedule(stage / FILES[1], scene, items, openings, supplied_hash)
        (stage / FILES[2]).write_text(_instructions(ruler), encoding='utf-8')
        payload['files'] = {name: {'sha256': hashlib.sha256((stage / name).read_bytes()).hexdigest(),
                                  'bytes': (stage / name).stat().st_size} for name in FILES[:-1]}
        (stage / FILES[-1]).write_text(json.dumps(payload, indent=2, allow_nan=False) + '\n', encoding='utf-8')
        for name in FILES:
            os.replace(stage / name, out / name)
    artifacts = [{'name': FILES[0], 'kind': 'cad'},
                 {'name': FILES[1], 'kind': 'quantities'}, {'name': FILES[2], 'kind': 'evidence'},
                 {'name': FILES[3], 'kind': 'evidence'}]
    return {'written': True, 'schema': SCHEMA, 'artifacts': artifacts,
            'sourceFiles': payload['sourceFiles'], 'sourceSha256': graph['sourceSha256'],
            'revision': graph['revision'], 'scheduleRows': payload['scheduleRows'],
            'metricVerified': False, 'roomQuantities': False, 'xactimateProjectGenerated': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scene', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if args.out.exists() and (not args.out.is_dir() or any(args.out.iterdir())):
        parser.error('Use a new or empty output directory to avoid mixing scene revisions.')
    if args.scene.is_symlink() or not args.scene.is_file() or args.scene.stat().st_size > MAX_SCENE_BYTES:
        parser.error('Scene must be a bounded regular JSON file.')
    scene = json.loads(args.scene.read_text(encoding='utf-8'), object_pairs_hook=_unique_object)
    print(json.dumps(write_building_handoff(scene, args.out, scene_path=args.scene), allow_nan=False))


if __name__ == '__main__':
    main()
