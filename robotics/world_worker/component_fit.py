"""Bound component diagnostics and reviewable wall-plane refinements.

All distances below compare the authored/compiled model with its reconstructed
source points. They are not independent measurements, confidence intervals or
physical accuracy claims. No geometry, scale, review or navigation flag changes.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
from pathlib import Path

import numpy as np

try:
    from . import component_evidence as ce
    from . import fit_check as fc
except ImportError:
    import component_evidence as ce
    import fit_check as fc

SCHEMA = 'brainsnn.component-fit.v1'
MAX_RAW_BYTES = ce.MAX_RAW_BYTES
MAX_EVALUATED = ce.MAX_EVALUATED
PLANE_TOLERANCE_METERS = .03
REVIEW_P95_METERS = .05
GRID_CELL_METERS = .25
MIN_PLANE_POINTS = 20
MAX_HYPOTHESES = 96
MAX_HYPOTHESIS_POINTS = 1024
MAX_TRANSLATION_METERS = .25
MAX_YAW_CHANGE_DEGREES = 5.
MIN_IMPROVEMENT_METERS = 1e-6
FIT_ROUNDOFF = 1e-10


def _canonical(value):
    return ce.cg._json(value, MAX_RAW_BYTES)


def _stats(values):
    values = np.asarray(values, float)
    if not len(values):
        return None
    if not np.isfinite(values).all() or np.any(values < 0):
        raise ValueError('Component residuals must be finite nonnegative distances.')
    return {'pointCount': int(len(values)), 'medianMeters': float(np.median(values)),
            'p95Meters': float(np.percentile(values, 95)), 'maxMeters': float(np.max(values)),
            'rmsMeters': float(np.sqrt(np.mean(values * values))),
            'outsideReviewBandFraction': float(np.mean(values > REVIEW_P95_METERS)),
            'allPointsIncluded': True}


def _canonical_normal(normal):
    normal = np.asarray(normal, float)
    length = float(np.linalg.norm(normal))
    if not math.isfinite(length) or length < 1e-12:
        return None
    normal = normal / length
    pivot = int(np.argmax(np.abs(normal)))
    return -normal if normal[pivot] < 0 else normal


def _robust_plane(points, *, vertical=False):
    """Bounded seeded consensus, then trimmed TLS. No random global state.

The inlier band is a diagnostic setting, not an instrument tolerance. The
reported residual distribution always retains every original member point.
"""
    points = np.asarray(points, float)
    if len(points) < MIN_PLANE_POINTS:
        return None
    sample = points[np.linspace(0, len(points) - 1, min(len(points), MAX_HYPOTHESIS_POINTS), dtype=int)]
    rng = np.random.default_rng(0)
    best = None
    for _ in range(MAX_HYPOTHESES):
        selection = sample[rng.choice(len(sample), 2 if vertical else 3, replace=False)]
        if vertical:
            delta = selection[1] - selection[0]
            normal = _canonical_normal([-delta[2], 0, delta[0]])
        else:
            normal = _canonical_normal(np.cross(selection[1] - selection[0], selection[2] - selection[0]))
        if normal is None:
            continue
        offset = float(selection[0] @ normal)
        residual = np.abs(sample @ normal - offset)
        score = (int(np.count_nonzero(residual <= PLANE_TOLERANCE_METERS)), -float(np.median(residual)))
        if best is None or score > best[0]:
            best = (score, normal, offset)
    if best is None:
        return None
    normal, offset = best[1:]
    for _ in range(3):
        inliers = np.abs(points @ normal - offset) <= PLANE_TOLERANCE_METERS
        if int(inliers.sum()) < MIN_PLANE_POINTS:
            return None
        selected = points[inliers]
        centre = selected.mean(axis=0)
        data = selected[:, [0, 2]] - centre[[0, 2]] if vertical else selected - centre
        _, singular, vt = np.linalg.svd(data, full_matrices=False)
        # A line, a single point or coincident samples cannot determine a plane.
        if vertical:
            if singular[0] < .1:
                return None
            normal = _canonical_normal([vt[-1, 0], 0, vt[-1, 1]])
        else:
            if len(singular) < 3 or singular[1] < .1:
                return None
            normal = _canonical_normal(vt[-1])
        offset = float(centre @ normal)
    residual = np.abs(points @ normal - offset)
    inliers = residual <= PLANE_TOLERANCE_METERS
    if int(inliers.sum()) < MIN_PLANE_POINTS:
        return None
    return {'normal': normal, 'offset': offset, 'centre': points[inliers].mean(axis=0),
            'inlierFraction': float(inliers.mean()), 'residuals': _stats(residual)}


def _public_plane(plane):
    return {'normal': [float(x) for x in plane['normal']], 'offsetMeters': float(plane['offset']),
            'centre': [float(x) for x in plane['centre']], 'inlierFraction': plane['inlierFraction'],
            'inlierBandMeters': PLANE_TOLERANCE_METERS, 'residuals': plane['residuals'],
            'basis': 'seeded-consensus-and-trimmed-TLS-of-reconstructed-member-points'}


def _surface_distances(scene, item, kind, points):
    if kind == 'wall':
        partial = {'walls': [item], 'objects': [],
                   'openings': [opening for opening in scene.get('openings', []) if opening.get('hostWall') == item['name']]}
    else:
        partial = {'walls': [], 'objects': [item], 'openings': []}
    elements = fc.surfaces(partial)
    if kind == 'wall':
        # A reference door leaf is operator-authored, not supporting wall
        # geometry. Its surface cannot explain points inside a reviewed void.
        elements = [element for element in elements if element[2] == 'wall']
    if not elements:
        return None
    return fc.distances(points, elements)[0]


def _cell_occupancy(item, kind, points):
    """A point-sampling diagnostic, not a visibility/completeness certificate."""
    p = np.asarray(points, float) - np.asarray(item['centre'], float)
    if kind == 'floor':
        coords, size = p[:, [0, 2]], [item['size'][0], item['size'][2]]
    elif kind == 'wall':
        theta = math.radians(item.get('yaw_degrees', 0))
        coords = np.stack([p[:, 0] * math.cos(theta) + p[:, 2] * math.sin(theta), p[:, 1]], axis=1)
        size = item['size'][:2]
    else:
        return None
    counts = [max(1, math.ceil(value / GRID_CELL_METERS)) for value in size]
    lo = -np.asarray(size) / 2
    inside = np.all((coords >= lo) & (coords <= -lo), axis=1)
    cells = np.floor((coords[inside] - lo) / GRID_CELL_METERS).astype(np.int64)
    cells = np.minimum(cells, np.asarray(counts) - 1)
    present = len({(int(a), int(b)) for a, b in cells})
    total = math.prod(counts)
    return {'cellMeters': GRID_CELL_METERS, 'cellsWithMemberPoints': present, 'footprintCells': total,
            'sampledCellFraction': present / total, 'visibilityValidated': False,
            'basis': 'At least one reconstructed member point in a footprint cell; cell area is not fully observed.'}


def _wall_candidate(scene, item, fit, member_points, before):
    unavailable = lambda reason: {'kind': 'wall-plane-refinement', 'status': 'unavailable', 'reason': reason,
                                  'reviewRequired': True, 'thicknessPreserved': True}
    if fit.get('face') is None:
        return unavailable('Point-spread thickness proxy may include multiple faces; a single-face refinement is ambiguous.')
    plane = _robust_plane(member_points, vertical=True)
    unconstrained = _robust_plane(member_points)
    if plane is None or unconstrained is None or plane['inlierFraction'] < .6:
        return unavailable('Insufficient dominant planar support for a bounded wall correction.')
    if abs(float(unconstrained['normal'][1])) > math.sin(math.radians(3)):
        return unavailable('Member points suggest a leaning or conflicting surface; review capture and gravity before a vertical wall correction.')
    theta = math.radians(item.get('yaw_degrees', 0))
    old_normal = np.array([-math.sin(theta), 0, math.cos(theta)])
    normal = plane['normal']
    if float(normal @ old_normal) < 0:
        normal = -normal
        offset = -plane['offset']
    else:
        offset = plane['offset']
    direction = np.array([normal[2], 0, -normal[0]])
    yaw = math.degrees(math.atan2(direction[2], direction[0]))
    centre = np.asarray(item['centre'], float)
    old_face = np.array([fit['face'][0], centre[1], fit['face'][1]])
    behind = float((centre - old_face) @ old_normal)
    # Preserve the compiler's original one-sided thickness convention and all
    # dimensions. Never centre an assumed wall on the camera-visible surface.
    proposed = centre + normal * (offset + behind - float(centre @ normal))
    candidate_item = copy.deepcopy(item)
    candidate_item.update(centre=proposed.tolist(), yaw_degrees=yaw)
    after = _stats(_surface_distances(scene, candidate_item, 'wall', member_points))
    result = {'kind': 'wall-plane-refinement', 'status': 'no-improvement',
              'geometry': {'centre': proposed.tolist(), 'size': copy.deepcopy(item['size']), 'yaw_degrees': yaw},
              'sourceObservedFace': {'centre': (proposed - normal * behind).tolist(), 'normal': normal.tolist()},
              'before': before, 'after': after, 'plane': _public_plane(plane),
              'thicknessPreserved': True, 'reviewRequired': True,
              'scope': 'Normal translation and yaw only; length, height and thickness remain authored/compiler parameters.'}
    translation = proposed - centre
    yaw_change = abs((yaw - item.get('yaw_degrees', 0) + 180) % 360 - 180)
    within_bounds = float(np.linalg.norm(translation[[0, 2]])) <= MAX_TRANSLATION_METERS \
        and yaw_change <= MAX_YAW_CHANGE_DEGREES
    nonzero = float(np.max(np.abs(translation))) > 1e-8 or yaw_change > 1e-8
    if not within_bounds:
        result['status'] = 'unavailable'
        result['reason'] = 'Correction exceeds the bounded 0.25 m translation or 5 degree yaw review limit; recapture and review registration.'
    if nonzero and within_bounds and after['medianMeters'] < before['medianMeters'] - MIN_IMPROVEMENT_METERS \
            and after['p95Meters'] <= before['p95Meters'] + FIT_ROUNDOFF:
        edit = {'op': 'wall', 'componentId': item['componentId'],
                'translationMeters': (proposed - centre).tolist(), 'yawDegrees': yaw}
        contract = {'schema': ce.cg.EDIT_SCHEMA, 'sourceSha256': scene['componentGraph']['sourceSha256'],
                    'sceneSha256': ce.cg.scene_sha256(scene), 'revision': scene['componentGraph']['revision'], 'edits': [edit]}
        try:
            ce.cg.apply_edits(scene, contract)  # Validate hosted openings and existing controlled-edit constraints.
        except ValueError:
            result['reason'] = 'The proposed correction violates the existing component/host constraints.'
        else:
            result.update(status='review-required', suggestedEdit=edit)
    return result


def build_component_fit(scene, cloud, *, scene_bytes, cloud_bytes, component_evidence=None, evidence_bytes=None,
                        source_dir=None, views=None, scene_name='scene.json', cloud_name='cloud.json'):
    """Recompute memberships and optionally verify a retained evidence sidecar.

Supplied evidence must exactly match a fresh computation with the same retained
source job/views. Its sampled indices and claims are never used as authority.
"""
    evidence = ce.build_component_evidence(scene, cloud, scene_bytes=scene_bytes, cloud_bytes=cloud_bytes,
        source_dir=source_dir, views=views, scene_name=scene_name, cloud_name=cloud_name)
    if (component_evidence is None) != (evidence_bytes is None):
        raise ValueError('Provide both parsed component evidence and its exact bytes, or neither.')
    evidence_hash = None
    if component_evidence is not None:
        evidence_hash = ce._raw_digest(evidence_bytes, component_evidence, None, 'component evidence')
        if _canonical(component_evidence) != _canonical(evidence):
            raise ValueError('Component evidence is stale or does not match recomputed source memberships and camera associations.')
    scene = ce.cg.ensure_component_ids(scene)
    points = cloud['points']
    floor_y = ce.sc.floor_plane(points, cloud.get('floorEstimate'))
    margin, walls, _rest, objects = ce.sc.analyse(points, floor_y, True)
    fits = {'wall': {f'wall_{i + 1}': fit for i, fit in enumerate(walls)},
            'object': {f'object_{i + 1}': fit for i, fit in enumerate(objects)}}
    floor_members = [i for i, point in enumerate(points) if abs(point[1] - floor_y) <= margin]
    by_id = {entry['componentId']: entry for entry in evidence['components']}
    records, requests, evaluated = [], [], 0
    for item, kind in ce._inventory(scene):
        entry = by_id[item['componentId']]
        record = {'componentId': entry['componentId'], 'name': entry['name'], 'kind': kind,
                  'status': 'unsupported', 'supportBasis': None, 'supportCount': None, 'residuals': None,
                  'frames': [frame['frameId'] for frame in entry['frames']], 'candidate': None,
                  'independentAccuracyValidated': False}
        records.append(record)
        def request(code, instruction, priority='normal'):
            requests.append({'componentId': entry['componentId'], 'name': entry['name'], 'kind': kind,
                             'code': code, 'priority': priority, 'instruction': instruction,
                             'basis': 'heuristic-capture-review-guidance', 'cameraPoseSuggested': False})
        authored = item.get('provenance') == 'operator-authored-edit' or item.get('dimensionProvenance') == 'operator-authored-edit'
        fit = fits.get(kind, {}).get(item.get('name'))
        original_authored_support = authored and kind == 'wall' and item.get('sourceProvenance') == 'observed' and fit is not None
        if evaluated >= MAX_EVALUATED or kind in ('opening', 'door', 'unknown') or 'centre' not in item \
                or (entry['status'] != 'source-membership' and not original_authored_support):
            record['reason'] = 'Evaluation limit reached.' if evaluated >= MAX_EVALUATED else entry.get('reason', 'No attributable source membership.')
            if kind in ('opening', 'door'):
                request('opening-needs-observation', 'Capture both jambs, the lintel and the threshold from both sides; record an independent clear-width and height check.', 'high')
            elif kind == 'unknown':
                request('unknown-space', 'Capture the unseen floor and its boundaries from overlapping views; unknown cells remain unknown.', 'high')
            else:
                request('unsupported-component', 'Capture this component and its boundaries from additional overlapping angles before relying on its dimensions.', 'high')
            continue
        members = floor_members if kind == 'floor' else fit['members'] if fit is not None else []
        if not members:
            record['reason'] = 'No recomputable original source points.'
            request('no-source-points', 'Capture this component from additional overlapping angles.', 'high')
            continue
        evaluated += 1
        member_points = np.asarray([points[i][:3] for i in sorted(set(members))], float)
        residuals = _stats(_surface_distances(scene, item, kind, member_points))
        record.update(status='evaluated-authored' if authored else 'fit-supported' if residuals['p95Meters'] <= REVIEW_P95_METERS else 'needs-review',
            supportBasis='original-compiler-membership-evaluated-against-authored-geometry' if authored else entry['membershipBasis'],
            supportCount=len(member_points), residuals=residuals, sampledCellOccupancy=_cell_occupancy(item, kind, member_points))
        if authored:
            record['sourceObservationClaim'] = False
            record['reason'] = 'Original source memberships are comparison points only; edited dimensions and surfaces are operator-authored.'
        if residuals['p95Meters'] > REVIEW_P95_METERS:
            request('surface-fit-conflict', 'Review the conflicting surface against its supporting frames; add oblique overlapping views if the reconstruction is ambiguous.', 'high')
        occupancy = record['sampledCellOccupancy']
        if occupancy and occupancy['sampledCellFraction'] < .5:
            request('sparse-footprint-sampling', 'Capture the sparsely sampled footprint and its edges. Point occupancy does not establish complete surface coverage.')
        if not entry['frames']:
            request('missing-supporting-frames', 'Retain registered source frames and capture the component in multiple clear overlapping views.')
        if kind == 'floor':
            plane = _robust_plane(member_points)
            record['plane'] = _public_plane(plane) if plane else None
            record['planeStatus'] = 'supported' if plane else 'unavailable'
            record['scope'] = 'Floor member points do not validate the full slab footprint, hidden assembly or thickness.'
            if plane is None:
                record['status'] = 'needs-review'
                request('floor-plane-insufficient-support', 'Capture floor patches spread across two dimensions; a line, coincident points or very few samples cannot support a floor plane.', 'high')
            else:
                tilt = math.degrees(math.acos(min(1., abs(float(plane['normal'][1])))))
                record['plane']['tiltFromUpDegrees'] = tilt
                if tilt > 2:
                    record['status'] = 'needs-review'
                    request('floor-level-conflict', 'Check gravity alignment and capture floor patches across the room before interpreting level or wall heights.', 'high')
        elif kind == 'wall':
            record['scope'] = 'Thickness is a compiler point-spread proxy or modelling assumption, never an independent construction-thickness measurement.'
            if not authored:
                record['candidate'] = _wall_candidate(scene, item, fit, member_points, residuals)
                if record['candidate']['status'] == 'unavailable' or record['candidate'].get('reason'):
                    request('wall-refinement-ambiguous', 'Review the wall face, gravity and registration; capture oblique overlapping views before changing the wall geometry.', 'high')
    return {'schema': SCHEMA, 'basis': 'component-model-to-reconstructed-source-points', 'units': 'm',
            'coordinateFrame': cloud['coordinateFrame'], 'sourceFiles': copy.deepcopy(evidence['sourceFiles']),
            'componentEvidenceSha256': evidence_hash, 'sourcePointsSha256': evidence['sourcePointsSha256'],
            'componentGraph': copy.deepcopy(evidence['componentGraph']),
            'summary': {'evaluatedComponents': evaluated,
                        'candidateCount': sum(bool(row['candidate'] and row['candidate']['status'] == 'review-required') for row in records),
                        'recaptureCount': len(requests)},
            'thresholds': {'planeInlierBandMeters': PLANE_TOLERANCE_METERS, 'reviewP95Meters': REVIEW_P95_METERS,
                           'basis': 'Diagnostic settings, not physical acceptance tolerances.'},
            'limits': {'evaluatedComponents': MAX_EVALUATED, 'planeHypotheses': MAX_HYPOTHESES,
                       'hypothesisSamplePoints': MAX_HYPOTHESIS_POINTS},
            'components': records, 'recaptureRequests': requests, 'geometryChanged': False, 'scaleChanged': False,
            'metricVerified': False, 'independentAccuracyValidated': False, 'physicalRobotValidated': False,
            'caveats': ['All residuals include every selected source member; outliers are not removed from the reported distribution.',
                        'Good fit to a reconstructed cloud does not establish physical dimensions, completeness or robot clearance.',
                        'Plane consensus and grid occupancy are heuristics, not calibrated uncertainty or image-ground-truth visibility.',
                        'Reviewable wall refinements preserve size and hidden thickness; accepting them authors geometry and invalidates prior evidence.',
                        'No opening is detected from an absence of points; reviewed openings need independent source and dimensional checks.']}


def write_component_fit(out_dir, scene, cloud, *, scene_path, cloud_path, evidence_path=None, source_dir=None, views=None):
    scene_path, cloud_path = Path(scene_path), Path(cloud_path)
    sources = [scene_path, cloud_path] + ([Path(evidence_path)] if evidence_path is not None else [])
    if any(path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= MAX_RAW_BYTES for path in sources):
        raise ValueError('Component fit inputs must be bounded regular JSON files.')
    raws = [path.read_bytes() for path in sources]
    report = build_component_fit(scene, cloud, scene_bytes=raws[0], cloud_bytes=raws[1],
        component_evidence=ce._json(raws[2]) if len(raws) == 3 else None,
        evidence_bytes=raws[2] if len(raws) == 3 else None, source_dir=source_dir, views=views,
        scene_name=scene_path.name, cloud_name=cloud_path.name)
    if any(path.read_bytes() != raw for path, raw in zip(sources, raws)):
        raise ValueError('Component fit inputs changed while diagnostics were computed.')
    path = Path(out_dir) / 'component-fit.json'
    temporary = path.with_suffix('.json.tmp')
    temporary.write_bytes(json.dumps(report, indent=1, allow_nan=False).encode('utf-8') + b'\n')
    temporary.replace(path)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scene', type=Path, required=True)
    parser.add_argument('--cloud', type=Path, required=True)
    parser.add_argument('--evidence', type=Path)
    parser.add_argument('--source-job', type=Path)
    parser.add_argument('--out', type=Path, required=True, help='Fresh output directory.')
    args = parser.parse_args()
    for path in (args.scene, args.cloud):
        if path.is_symlink() or not path.is_file() or not 0 < path.stat().st_size <= MAX_RAW_BYTES:
            parser.error('Sources must be bounded regular JSON files.')
    scene, cloud = (ce._json(path.read_bytes()) for path in (args.scene, args.cloud))
    args.out.mkdir(parents=True, exist_ok=False)
    report = write_component_fit(args.out, scene, cloud, scene_path=args.scene, cloud_path=args.cloud,
                                 evidence_path=args.evidence, source_dir=args.source_job)
    print(json.dumps({'written': True, **report['summary'], 'metricVerified': False}, allow_nan=False))


if __name__ == '__main__':
    main()
