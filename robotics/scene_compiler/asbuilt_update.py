"""Review prior IFC against a compiled capture; write bounded placement-only copies.

This is model-to-model comparison, never survey validation. Source IFC, scale,
unselected elements and geometry are preserved. No inferred additions/deletions.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import tempfile

import numpy as np
import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.element
import ifcopenshell.util.placement
import ifcopenshell.util.unit
from ifcopenshell.api.geometry.edit_object_placement import edit_object_placement
from ifcopenshell.api.pset.add_pset import add_pset
from ifcopenshell.api.pset.edit_pset import edit_pset
from . import component_graph as cg, nav2_export

MAX_IFC_BYTES = 16 * 1024 * 1024
MAX_ELEMENTS = 1024
SCHEMA = 'brainsnn.asbuilt-review.v1'

def _sha(raw):
    return hashlib.sha256(raw).hexdigest()

def _json(raw, limit):
    if not isinstance(raw, bytes) or not 0 < len(raw) <= limit:
        raise ValueError('Input byte limit exceeded.')
    return json.loads(raw, parse_constant=lambda _v: (_ for _ in ()).throw(ValueError('Nonfinite JSON.')))

def _number(value, lo, hi):
    if type(value) not in (int, float) or not math.isfinite(value) or not lo <= value <= hi:
        raise ValueError('Invalid finite numeric parameter.')
    return float(value)

def _vec(value):
    if not isinstance(value, list) or len(value) != 3:
        raise ValueError('Expected three metre coordinates.')
    return [_number(n, -1e7, 1e7) for n in value]

def _keys(value, expected):
    if not isinstance(value, dict) or set(value) != set(expected):
        raise ValueError('Unsupported review record fields.')

def _text(value, limit, empty=False):
    if not isinstance(value, str) or len(value) > limit or not empty and not value.strip() \
            or any(ord(c) < 32 and c not in '\t\r\n' for c in value):
        raise ValueError('Use bounded plain text.')
    return value

def _ifc(raw):
    if not isinstance(raw, bytes) or not 0 < len(raw) <= MAX_IFC_BYTES:
        raise ValueError('IFC limit is 16 MiB.')
    model = ifcopenshell.file.from_string(raw.decode('utf-8-sig'))
    projects = model.by_type('IfcProject')
    if len(projects) != 1 or not projects[0].UnitsInContext:
        raise ValueError('One IFC project with explicit units is required.')
    units = [u for u in projects[0].UnitsInContext.Units if getattr(u, 'UnitType', None) == 'LENGTHUNIT']
    if len(units) != 1:
        raise ValueError('Declare exactly one IFC length unit; units are never assumed.')
    def factor(unit,depth=0):
        if depth>4:
            raise ValueError('Unsupported cyclic IFC unit definition.')
        if unit.is_a('IfcSIUnit') and unit.Name=='METRE':
            prefixes={None:1,'EXA':1e18,'PETA':1e15,'TERA':1e12,'GIGA':1e9,'MEGA':1e6,'KILO':1e3,'HECTO':1e2,'DECA':10,'DECI':.1,'CENTI':.01,'MILLI':.001,'MICRO':1e-6,'NANO':1e-9}
            if unit.Prefix not in prefixes:
                raise ValueError('Unsupported IFC length prefix.')
            return prefixes[unit.Prefix]
        if unit.is_a()=='IfcConversionBasedUnit':
            f=unit.ConversionFactor
            return _number(f.ValueComponent.wrappedValue,1e-12,1e12)*factor(f.UnitComponent,depth+1)
        raise ValueError('Unsupported IFC length unit; it cannot be assumed to mean metres.')
    scale = _number(factor(units[0]), 1e-9, 1e6)
    return model, scale

def _hull(points):
    points = sorted(set(map(tuple, points)))
    if len(points) <= 2:
        return points
    def cross(o,a,b):
        return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
    lower,upper=[],[]
    for p in points:
        while len(lower)>=2 and cross(lower[-2],lower[-1],p)<=0: lower.pop()
        lower.append(p)
    for p in reversed(points):
        while len(upper)>=2 and cross(upper[-2],upper[-1],p)<=0: upper.pop()
        upper.append(p)
    return lower[:-1]+upper[:-1]

def ifc_inventory(raw):
    model, scale = _ifc(raw)
    settings = ifcopenshell.geom.settings()
    settings.set(settings.USE_WORLD_COORDS, True)
    products = [e for e in model.by_type('IfcElement') if e.Representation]
    if not 1 <= len(products) <= MAX_ELEMENTS:
        raise ValueError('Use an IFC slice with 1 to 1024 represented elements.')
    elements, skipped, vertex_count = [], [], 0
    for element in sorted(products, key=lambda e: str(e.GlobalId)):
        try:
            shape = ifcopenshell.geom.create_shape(settings, element)
            points = np.asarray(shape.geometry.verts, dtype=np.float64).reshape(-1, 3)
            vertex_count += len(points)
            if vertex_count > 2_000_000:
                raise ValueError('IFC geometry exceeds two million vertices.')
            if not len(points) or not np.isfinite(points).all():
                raise ValueError('Empty or nonfinite element geometry.')
            # IFC project frame X,Y,Z-up -> BrainSNN right-handed X,Y-up,Z.
            points = points[:, [0, 2, 1]] * [1, 1, -1]
            lo, hi = points.min(axis=0), points.max(axis=0)
            if np.abs(points).max() > 1e7:
                raise ValueError('IFC coordinates exceed the review range.')
            props = ifcopenshell.util.element.get_psets(element).get('Pset_BrainSNN', {})
            hull = _hull(points[:,[0,2]])
            if len(hull)>2048:
                raise ValueError('IFC footprint exceeds review complexity.')
            elements.append({'globalId': element.GlobalId, 'expressId': element.id(),
                'name': (element.Name or element.GlobalId)[:160], 'ifcClass': element.is_a(),
                'componentId': props.get('ComponentId'), 'provenance': props.get('Provenance'),
                'min': lo.tolist(), 'max': hi.tolist(), 'footprintXZ': hull})
        except (RuntimeError, ValueError) as error:
            if 'exceeds' in str(error):
                raise
            skipped.append({'globalId': element.GlobalId, 'reason': 'Geometry could not be evaluated.'})
    if not elements or len({e['globalId'] for e in elements}) != len(elements):
        raise ValueError('IFC inventory needs unique nonempty GlobalIds and evaluated geometry.')
    return {'schema': 'brainsnn.ifc-prior.v1', 'sourceSha256': _sha(raw), 'ifcSchema': model.schema,
        'nativeLengthScale': scale, 'units': 'm', 'coordinateFrame': 'right-handed-y-up',
        'geometry': 'world-axis-aligned-bounds', 'elements': elements, 'skipped': skipped,
        'hasMapConversion': bool(model.by_type('IfcMapConversion')) if model.schema != 'IFC2X3' else False}

def _current(scene):
    if scene.get('schema') != 'brainsnn.scene.v1' or scene.get('units') != 'm' \
            or 'componentGraph' not in scene:
        raise ValueError('Use a metric compiler scene with its original component graph.')
    cg.ensure_component_ids(scene)
    result = {}
    for kind, field in [('wall', 'walls'), ('object', 'objects'), ('opening', 'openings')]:
        for item in scene.get(field, []):
            entry = {'kind': kind, 'item': item, 'floor': item.get('name') == 'floor_observed' or item.get('label') == 'floor'}
            if 'centre' in item and 'size' in item:
                centre, size = np.array(item['centre']), np.array(item['size'])
                angle = math.radians(item.get('yaw_degrees', 0))
                half = np.array([abs(math.cos(angle))*size[0]+abs(math.sin(angle))*size[2], size[1],
                                 abs(math.sin(angle))*size[0]+abs(math.cos(angle))*size[2]]) / 2
                entry.update(centre=centre, size=half*2)
            elif 'min' in item and 'max' in item:
                lo, hi = np.array(item['min']), np.array(item['max'])
                entry.update(centre=(lo+hi)/2, size=hi-lo)
            result[item['componentId']] = entry
    return result

def _registration(reg):
    _keys(reg, ['method', 'translationMeters', 'yawDegrees', 'reviewed', 'note'])
    if reg['method'] not in ('operator-entered-rigid', 'operator-reviewed-same-frame') or type(reg['reviewed']) is not bool:
        raise ValueError('Unsupported registration declaration.')
    t = np.array(_vec(reg['translationMeters']))
    yaw = _number(reg['yawDegrees'], -360, 360)
    _text(reg['note'], 500, True)
    if reg['method'] == 'operator-reviewed-same-frame' and (yaw != 0 or t.any()):
        raise ValueError('Same-frame registration cannot move or rescale geometry.')
    a = math.radians(yaw)
    r = np.array([[math.cos(a), 0, -math.sin(a)], [0, 1, 0], [math.sin(a), 0, math.cos(a)]])
    return r, t

def compare(ifc_raw, scene_raw, request):
    """Recompute decisions from the actual source files, not client-supplied boxes."""
    scene = _json(scene_raw, cg.MAX_SCENE_BYTES)
    current, prior = _current(scene), ifc_inventory(ifc_raw)
    _keys(request, ['schema', 'source', 'registration', 'toleranceMeters', 'maxTranslationMeters',
                    'maxExtentDifferenceMeters', 'pairs', 'selectedTranslations', 'brief',
                    'metricVerified', 'physicalRobotValidated'])
    if request['schema'] != SCHEMA or request['metricVerified'] is not False or request['physicalRobotValidated'] is not False:
        raise ValueError('The review cannot promote physical or metric validation.')
    cg._json(request, 1024*1024)
    _keys(request['source'], ['priorIfcSha256', 'currentSceneSha256', 'componentRevision'])
    if request['source'] != {'priorIfcSha256': _sha(ifc_raw), 'currentSceneSha256': _sha(scene_raw),
                             'componentRevision': scene['componentGraph']['revision']}:
        raise ValueError('Review does not match these exact IFC and scene files/revision.')
    r, t = _registration(request['registration'])
    tolerance = _number(request['toleranceMeters'], .001, 1)
    max_shift = _number(request['maxTranslationMeters'], .001, 2)
    max_extent = _number(request['maxExtentDifferenceMeters'], .001, .25)
    brief = request['brief']
    _keys(brief, ['targets', 'intendedUse', 'accuracyTargetMeters', 'detail'])
    _text(brief['targets'], 500); _text(brief['intendedUse'], 500)
    _number(brief['accuracyTargetMeters'], .001, 1)
    if brief['detail'] != 'observed-component-proxies':
        raise ValueError('No certified LOD is established by this workflow.')
    pairs, selected = request['pairs'], request['selectedTranslations']
    if not isinstance(pairs, list) or len(pairs) > MAX_ELEMENTS or not isinstance(selected, list) \
            or not 1 <= len(selected) <= 32 or len(set(selected)) != len(selected):
        raise ValueError('Select 1 to 32 distinct reviewed translations.')
    if len({p['priorGlobalId'] for p in pairs}) != len(pairs) or len({p['currentComponentId'] for p in pairs}) != len(pairs):
        raise ValueError('Correspondences must be one to one.')
    lookup = {p['globalId']: p for p in prior['elements']}
    rows = []
    for pair in pairs:
        _keys(pair, ['priorGlobalId', 'currentComponentId', 'reviewed'])
        if pair['priorGlobalId'] not in lookup or pair['currentComponentId'] not in current or type(pair['reviewed']) is not bool:
            raise ValueError('Correspondence references a missing component.')
        p, c = lookup[pair['priorGlobalId']], current[pair['currentComponentId']]
        if 'centre' not in c:
            continue
        lo, hi = np.array(p['min']), np.array(p['max'])
        footprint=np.array([[x,lo[1],z] for x,z in p['footprintXZ']]) @ r.T + t
        registered_lo,registered_hi=footprint.min(axis=0),footprint.max(axis=0)
        registered_hi[1]=hi[1]+t[1]
        position,size=(registered_lo+registered_hi)/2,registered_hi-registered_lo
        delta = c['centre'] - position
        distance, difference = float(np.linalg.norm(delta)), float(np.abs(size-c['size']).max())
        structural = c['floor'] or c['kind'] != 'object' or p['ifcClass'] not in ('IfcFurniture','IfcFurnishingElement','IfcBuildingElementProxy')
        eligible = request['registration']['reviewed'] and pair['reviewed'] and not structural \
            and p.get('provenance') != 'unknown' and tolerance < distance <= max_shift and difference <= max_extent
        rows.append({'priorGlobalId': p['globalId'], 'currentComponentId': pair['currentComponentId'],
            'priorName': p['name'], 'currentName': c['item'].get('name'),
            'deltaMeters': delta.tolist(), 'distanceMeters': distance, 'extentDifferenceMeters': difference,
            'targetCentreMeters': c['centre'].tolist(), 'eligible': bool(eligible), 'selected': p['globalId'] in selected})
    chosen = [row for row in rows if row['selected']]
    if len(chosen) != len(selected) or any(not row['eligible'] for row in chosen) \
            or not request['registration']['note'].strip():
        raise ValueError('A selected translation lacks reviewed identity/frame, compatible bounds or bounded movement.')
    return {'schema': 'brainsnn.asbuilt-update-report.v1', 'source': request['source'],
        'reviewSha256': _sha(cg._json(request, 1024*1024)), 'registration': request['registration'],
        'brief': brief, 'rows': rows, 'skippedPrior': prior['skipped'], 'metricVerified': False,
        'physicalRobotValidated': False, 'scope': 'Operator-reviewed model-to-model translations; not physical validation.'}

def update_ifc(ifc_raw, scene_raw, request):
    report = compare(ifc_raw, scene_raw, request)
    if report['skippedPrior']:
        raise ValueError('Cannot verify unchanged geometry when prior elements were skipped.')
    model, scale = _ifc(ifc_raw)
    before = {e['globalId']: e for e in ifc_inventory(ifc_raw)['elements']}
    r, _t = _registration(request['registration'])
    selected = {row['priorGlobalId']: row for row in report['rows'] if row['selected']}
    # Do not break hosted features, child assemblies, connected MEP networks or shared placements.
    for guid, row in selected.items():
        element = model.by_guid(guid)
        if not element.ObjectPlacement or not element.ObjectPlacement.is_a('IfcLocalPlacement'):
            raise ValueError('Only local object placements can be updated.')
        if any(getattr(element, key, ()) for key in ('IsDecomposedBy','Decomposes','IsNestedBy','Nests','HasOpenings','FillsVoids','ConnectedTo','ConnectedFrom','HasPorts')):
            raise ValueError('Hosted, nested or connected elements require a dedicated coordinated edit.')
        if len(model.get_inverse(element.ObjectPlacement)) > 1:
            raise ValueError('Shared placements cannot be changed by this bounded workflow.')
        for inverse in model.get_inverse(element):
            if inverse.is_a('IfcRelConnectsPorts') or inverse.is_a('IfcRelConnectsPortToElement'):
                raise ValueError('Connected MEP elements need a coordinated edit.')
        matrix = ifcopenshell.util.placement.get_local_placement(element.ObjectPlacement).copy()
        matrix[:3, 3] *= scale
        delta = r.T @ np.array(row['deltaMeters'])
        matrix[:3, 3] += [delta[0], -delta[2], delta[1]]
        edit_object_placement(model, product=element, matrix=matrix, is_si=True, should_transform_children=False)
        audit=add_pset(model,product=element,name='Pset_BrainSNN_AsBuiltReview')
        edit_pset(model,pset=audit,properties={'PriorIfcSha256':_sha(ifc_raw),
            'CaptureSceneSha256':_sha(scene_raw),'ReviewSha256':report['reviewSha256'],
            'PlacementProvenance':'operator-reviewed-translation','PriorGeometryRetained':True,
            'MetricVerified':False,'PhysicalRobotValidated':False})
    output = model.to_string().encode('utf-8')
    after_inventory = ifc_inventory(output)
    after = {e['globalId']: e for e in after_inventory['elements']}
    if after_inventory['skipped'] or set(before) != set(after):
        raise ValueError('Updated IFC lost evaluable elements.')
    for guid, old in before.items():
        new = after[guid]
        if not np.allclose(np.subtract(new['max'],new['min']),np.subtract(old['max'],old['min']),atol=1e-6,rtol=0):
            raise ValueError('A placement update changed geometry bounds.')
        delta = np.array(new['min'])-old['min']
        expected = r.T @ np.array(selected[guid]['deltaMeters']) if guid in selected else np.zeros(3)
        if not np.allclose(delta,expected,atol=1e-6,rtol=0):
            raise ValueError('Updated IFC changed an unselected element or missed the target.')
    report['outputIfcSha256'] = _sha(output)
    report['updatedCount'] = len(selected)
    report['caveats'] = ['Translations preserve prior geometry; bad shapes still require remodeling.',
        'No additions, deletions, resizing, MEP reconnection, scale fitting or robot validation.',
        'The accuracy target is a requested tolerance, not an achieved physical accuracy.']
    return output, report

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    inv = commands.add_parser('inventory'); inv.add_argument('--ifc', type=Path, required=True); inv.add_argument('--output', type=Path, required=True)
    apply = commands.add_parser('apply'); apply.add_argument('--ifc', type=Path, required=True); apply.add_argument('--scene', type=Path, required=True); apply.add_argument('--review', type=Path, required=True); apply.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'inventory':
        result = ifc_inventory(args.ifc.read_bytes())
        with args.output.open('x') as file:
            json.dump(result,file,indent=2,allow_nan=False)
        return
    if args.output_dir.exists():
        raise ValueError('Choose a new output directory. Original files are never overwritten.')
    raw = args.ifc.read_bytes(); scene = args.scene.read_bytes(); review = _json(args.review.read_bytes(),1024*1024)
    updated, report = update_ifc(raw,scene,review)
    args.output_dir.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.asbuilt-',dir=args.output_dir.parent) as temp:
        root = Path(temp)
        (root/'updated.ifc').write_bytes(updated)
        (root/'asbuilt-update-report.json').write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
        (root/'asbuilt-review.json').write_bytes(cg._json(review,1024*1024))
        # Single publish after read-back and bounds validation; fail if another writer won.
        nav2_export._publish_directory(root,args.output_dir)
    print(json.dumps({'updated':str(args.output_dir/'updated.ifc'),'count':report['updatedCount'],'metricVerified':False}))

if __name__ == '__main__':
    main()
