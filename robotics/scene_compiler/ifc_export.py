"""IFC4 (BIM) export of a compiled scene: observed floor and walls, detected objects and unknown space, in metres.

Written directly as IFC-SPF text so it runs wherever the compiler does (Blender's Python has no IfcOpenShell). Only metric
scenes are exported: IFC lengths are metres, and an arbitrary-unit scene would be off by an unknown factor. Every element
keeps its provenance in Pset_BrainSNN, and the project records how the scale was obtained, so a BIM tool never shows an
observed wall, a detected box and unseen space as the same kind of fact.
"""
from __future__ import annotations
import datetime
import json
import math
import uuid
from pathlib import Path

try:
    from .component_graph import ensure_component_ids, derive_id
except ImportError:  # Blender/script entry points expose this directory directly.
    from component_graph import ensure_component_ids, derive_id

IFC_NEEDS_METRES = ("BIM tools read IFC in metres, and this cloud is in arbitrary units, so no scene.ifc was written. "
                    "Set a measured scale in World Builder and build a metric scene.")
UNKNOWN_HEIGHT = 0.3  # the compiler's unknown-space volume height
_GUID_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$'


def ifc_guid(seed: str) -> str:
    """Deterministic 22-character IFC GlobalId: uuid5 of the seed in IFC's base-64 compression (2 + 21 × 6 bits)."""
    n = uuid.uuid5(uuid.NAMESPACE_URL, 'brainsnn-scene:' + seed).int
    return _GUID_CHARS[n >> 126] + ''.join(_GUID_CHARS[(n >> (6 * i)) & 63] for i in range(20, -1, -1))


def real(v: float) -> str:
    """IFC REAL with a decimal point and no trailing zeros ('2.' is a valid STEP real)."""
    return f'{float(v):.6f}'.rstrip('0')


def label(text) -> str:
    """IFC STRING literal: quotes doubled, backslashes escaped, non-ASCII as \\X2\\ hex (BMP) or '?'."""
    out = []
    for ch in str(text)[:200]:
        if ch == "'":
            out.append("''")
        elif ch == '\\':
            out.append('\\\\')
        elif 32 <= ord(ch) < 127:
            out.append(ch)
        elif ord(ch) <= 0xFFFF:
            out.append('\\X2\\%04X\\X0\\' % ord(ch))
        else:
            out.append('?')
    return "'" + ''.join(out) + "'"


class _Writer:
    def __init__(self):
        self.rows = []

    def add(self, entity: str) -> str:
        self.rows.append(entity)
        return f'#{len(self.rows)}'


def merge_unknown(cells):
    """Unknown cells [x, z, size] merged into runs along x per row: (x0, x1, z, size)."""
    rows = {}
    for x, z, c in cells:
        rows.setdefault((round(z, 6), c), []).append(x)
    runs = []
    for (z, c), xs in sorted(rows.items()):
        xs.sort(); start = prev = xs[0]
        for x in xs[1:]:
            if abs(x - (prev + c)) > 1e-6:
                runs.append((start, prev + c, z, c)); start = x
            prev = x
        runs.append((start, prev + c, z, c))
    return runs


def _reviewed_openings(scene):
    """Defend the standalone exporter as well as the worker's validated review path."""
    openings = scene.get('openings', [])
    if not isinstance(openings, list) or len(openings) > 32:
        raise ValueError('Use at most 32 reviewed BIM openings.')
    walls = {wall.get('name'): wall for wall in scene.get('walls', [])}
    ids = set()
    for opening in openings:
        if not isinstance(opening, dict) or opening.get('reviewed') is not True or opening.get('kind') not in ('opening', 'door'):
            raise ValueError('IFC openings require an explicit operator review.')
        identifier = opening.get('id')
        if not isinstance(identifier, str) or not identifier or len(identifier) > 64 or identifier in ids:
            raise ValueError('IFC opening IDs must be unique.')
        ids.add(identifier)
        host_name = opening.get('hostWall')
        if not isinstance(host_name, str) or not 1 <= len(host_name) <= 160:
            raise ValueError('IFC opening needs a bounded host wall name.')
        wall = walls.get(host_name)
        if wall is None or opening.get('host') != {key: wall.get(key, 0 if key == 'yaw_degrees' else None)
                                                 for key in ('centre', 'size', 'yaw_degrees')}:
            raise ValueError('IFC opening host geometry is missing or stale.')
        for key in ('offsetMeters', 'widthMeters', 'heightMeters', 'sillMeters'):
            value = opening.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                raise ValueError('IFC opening dimensions must be finite positive metres.')
        if opening['widthMeters'] < .05 or opening['heightMeters'] < .05 \
                or opening['offsetMeters'] + opening['widthMeters'] > wall['size'][0] + 1e-9 \
                or opening['sillMeters'] + opening['heightMeters'] > wall['size'][1] + 1e-9:
            raise ValueError('IFC opening does not fit inside its host wall.')
        if opening['kind'] == 'door' and opening['sillMeters'] != 0:
            raise ValueError('An IFC door must start at the host wall base.')
    for index, first in enumerate(openings):
        for second in openings[index + 1:]:
            if first['hostWall'] == second['hostWall'] and \
                    min(first['offsetMeters'] + first['widthMeters'], second['offsetMeters'] + second['widthMeters']) > max(first['offsetMeters'], second['offsetMeters']) + 1e-9 and \
                    min(first['sillMeters'] + first['heightMeters'], second['sillMeters'] + second['heightMeters']) > max(first['sillMeters'], second['sillMeters']) + 1e-9:
                raise ValueError('IFC opening rectangles must not overlap.')
    return openings


def write_ifc(path, scene: dict, name: str = 'BrainSNN scene') -> dict:
    """Writes scene.ifc for a metric scene and returns element counts. Scene coordinates are Y-up; IFC is Z-up:
    (x, y, z) -> (x, -z, y), the same mapping the compiler uses for Blender."""
    if scene.get('units') != 'm':
        raise ValueError(IFC_NEEDS_METRES)
    scene = ensure_component_ids(scene)
    source_sha256 = scene['componentGraph']['sourceSha256']
    hierarchy = {key: derive_id(source_sha256, 'hierarchy', key) for key in ('project', 'site', 'building', 'storey')}
    openings = _reviewed_openings(scene)
    w = _Writer()
    origin = w.add('IFCCARTESIANPOINT((0.,0.,0.))')
    z_axis, x_axis = w.add('IFCDIRECTION((0.,0.,1.))'), w.add('IFCDIRECTION((1.,0.,0.))')
    world = w.add(f'IFCAXIS2PLACEMENT3D({origin},{z_axis},{x_axis})')
    origin2d = w.add(f"IFCAXIS2PLACEMENT2D({w.add('IFCCARTESIANPOINT((0.,0.))')},$)")
    context = w.add(f"IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,{world},$)")
    body = w.add(f"IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,{context},$,.MODEL_VIEW.,$)")
    units = [w.add(f'IFCSIUNIT(*,.{kind}.,$,.{unit}.)') for kind, unit in
             [('LENGTHUNIT', 'METRE'), ('AREAUNIT', 'SQUARE_METRE'), ('VOLUMEUNIT', 'CUBIC_METRE'), ('PLANEANGLEUNIT', 'RADIAN')]]
    project = w.add(f"IFCPROJECT('{ifc_guid(hierarchy['project'])}',$,{label(name)},{label('Compiled by BrainSNN World Builder from a reconstruction; not a surveyed model.')},"
                    f"$,$,$,({context}),{w.add('IFCUNITASSIGNMENT((' + ','.join(units) + '))')})")
    site_place = w.add(f'IFCLOCALPLACEMENT($,{world})')
    site = w.add(f"IFCSITE('{ifc_guid(hierarchy['site'])}',$,'Site',$,$,{site_place},$,$,.ELEMENT.,$,$,$,$,$)")
    building_place = w.add(f'IFCLOCALPLACEMENT({site_place},{world})')
    building = w.add(f"IFCBUILDING('{ifc_guid(hierarchy['building'])}',$,'Building',$,$,{building_place},$,$,.ELEMENT.,$,$,$)")
    storey_place = w.add(f'IFCLOCALPLACEMENT({building_place},{world})')
    storey = w.add(f"IFCBUILDINGSTOREY('{ifc_guid(hierarchy['storey'])}',$,'Scanned floor',$,$,{storey_place},$,$,.ELEMENT.,0.)")
    for i, (parent, child) in enumerate([(project, site), (site, building), (building, storey)]):
        w.add(f"IFCRELAGGREGATES('{ifc_guid(derive_id(source_sha256, 'relation', f'aggregate-{i}'))}',$,$,$,{parent},({child}))")

    def prism(cx, cy, z0, length, width, height, yaw=0.0, placement_parent=storey_place):
        """A rectangular prism centred on (cx, cy), from z0 up, its length rotated by yaw about Z."""
        point = w.add(f'IFCCARTESIANPOINT(({real(cx)},{real(cy)},{real(z0)}))')
        direction = w.add(f'IFCDIRECTION(({real(math.cos(yaw))},{real(math.sin(yaw))},0.))')
        placement = w.add(f'IFCLOCALPLACEMENT({placement_parent},{w.add(f"IFCAXIS2PLACEMENT3D({point},{z_axis},{direction})")})')
        profile = w.add(f"IFCRECTANGLEPROFILEDEF(.AREA.,$,{origin2d},{real(max(length, .001))},{real(max(width, .001))})")
        solid = w.add(f'IFCEXTRUDEDAREASOLID({profile},{world},{z_axis},{real(max(height, .001))})')
        return placement, solid

    def shape(items):
        rep = w.add(f"IFCSHAPEREPRESENTATION({body},'Body','SweptSolid',({','.join(items)}))")
        return w.add(f'IFCPRODUCTDEFINITIONSHAPE($,$,({rep}))')

    def properties(element, seed, values):
        props = []
        for key, value in values.items():
            if value is None:
                continue
            literal = (f'IFCBOOLEAN(.{"T" if value else "F"}.)' if isinstance(value, bool) else f'IFCINTEGER({value})' if isinstance(value, int)
                       else f'IFCREAL({real(value)})' if isinstance(value, float) else f'IFCLABEL({label(value)})')
            props.append(w.add(f"IFCPROPERTYSINGLEVALUE({label(key)},$,{literal},$)"))
        pset = w.add(f"IFCPROPERTYSET('{ifc_guid(seed + '-pset')}',$,'Pset_BrainSNN',$,({','.join(props)}))")
        w.add(f"IFCRELDEFINESBYPROPERTIES('{ifc_guid(seed + '-rel')}',$,$,$,({element}),{pset})")

    def lineage(item):
        return {'SourceProvenance': item.get('sourceProvenance'), 'SupportPoints': item.get('support_points'),
                'SupportPointsScope': item.get('supportPointsScope'), 'DimensionProvenance': item.get('dimensionProvenance'),
                'ParameterProvenance': json.dumps(item['parameterProvenance'], sort_keys=True, separators=(',', ':'))
                    if item.get('parameterProvenance') else None}

    scale = scene.get('scale') if isinstance(scene.get('scale'), dict) else {}
    properties(project, hierarchy['project'], {'SceneSchema': scene.get('schema'), 'Units': 'm', 'ScaleSource': scale.get('source', 'unknown'),
                                    'MetresPerUnit': scale.get('metresPerUnit'), 'MeasuredDistanceMetres': scale.get('distance'),
                                    'SelfReported': scale.get('selfReported', True), 'MetricVerified': False,
                                    'ComponentId': hierarchy['project'], 'SourceSha256': source_sha256})
    elements, counts = [], {'walls': 0, 'slabs': 0, 'objects': 0, 'separated': 0, 'unknownRuns': 0}
    for obj in scene.get('objects', []):
        if 'centre' not in obj or 'size' not in obj:
            continue  # unplaced detections have no geometry; they stay in scene.json with their reason
        (cx, cy, cz), (sx, sy, sz) = obj['centre'], obj['size']
        placement, solid = prism(cx, -cz, cy - sy / 2, sx, sz, sy, yaw=-math.radians(obj.get('yaw_degrees', 0)))
        seed = obj['componentId']
        separated, named = obj.get('kind') == 'separated', obj.get('label') not in (None, 'object')
        if obj.get('label') == 'floor':
            element = w.add(f"IFCSLAB('{ifc_guid(seed)}',$,{label(obj.get('name', 'floor'))},$,$,{placement},{shape([solid])},$,.FLOOR.)"); counts['slabs'] += 1
        elif separated and not named:
            # A measured cluster of points with no name: a proxy, not furniture, because nothing says what it is.
            title = str(obj.get('name', 'object')).replace('_', ' ').capitalize()
            element = w.add(f"IFCBUILDINGELEMENTPROXY('{ifc_guid(seed)}',$,{label(title)},{label('Separated from the reconstructed points; not identified.')},"
                            f"$,{placement},{shape([solid])},$,.NOTDEFINED.)"); counts['separated'] += 1
        elif separated and obj.get('ifcClass') == 'IfcBuildingElementProxy':
            # Named by a model, but not furniture (a plant, a lamp, a radiator): a proxy that carries the suggested name.
            element = w.add(f"IFCBUILDINGELEMENTPROXY('{ifc_guid(seed)}',$,{label(obj['label'])},{label('Separated from the reconstructed points; name suggested by a model, not reviewed.')},"
                            f"$,{placement},{shape([solid])},$,.NOTDEFINED.)"); counts['separated'] += 1
        else:
            element = w.add(f"IFCFURNITURE('{ifc_guid(seed)}',$,{label(obj.get('label', 'object'))},$,$,{placement},{shape([solid])},$,.NOTDEFINED.)")
            counts['separated' if separated else 'objects'] += 1
        properties(element, seed, {**lineage(obj), 'ComponentId': seed, 'SourceSha256': source_sha256,
                                   'Provenance': obj.get('provenance'), 'Label': obj.get('label'), 'SupportPoints': obj.get('support_points'),
                                   'Detector': obj.get('detector') or obj.get('labelSource'), 'Separated': True if separated else None,
                                   'LabelConfidence': obj.get('labelConfidence'), 'LabelReviewed': obj.get('labelReviewed'),
                                   'LabelProvenance': obj.get('labelProvenance'),
                                   'Base': obj.get('base'),
                                   'LengthMetres': float(sx) if separated else None, 'WidthMetres': float(sz) if separated else None,
                                   'HeightMetres': float(sy) if separated else None})
        elements.append(element)
    wall_refs = {}
    for wall in scene.get('walls', []):
        if 'centre' not in wall or 'size' not in wall:
            continue
        (cx, cy, cz), (length, height, thickness) = wall['centre'], wall['size']
        placement, solid = prism(cx, -cz, cy - height / 2, length, thickness, height, yaw=-math.radians(wall.get('yaw_degrees', 0)))
        seed = wall['componentId']
        wall_label = wall.get('label') if wall.get('label') not in (None, 'wall') else wall.get('name', 'wall')
        element = w.add(f"IFCWALL('{ifc_guid(seed)}',$,{label(wall_label)},$,$,{placement},{shape([solid])},$,.NOTDEFINED.)")
        properties(element, seed, {**lineage(wall), 'ComponentId': seed, 'SourceSha256': source_sha256,
                                   'ElementName': wall.get('name'), 'Provenance': wall.get('provenance', 'observed'),
                                   'Label': wall.get('label', 'wall'), 'LabelProvenance': wall.get('labelProvenance'),
                                   'SupportPoints': wall.get('support_points')})
        wall_refs[wall['name']] = (element, placement, seed)
        elements.append(element); counts['walls'] += 1
    if openings:
        counts.update(openings=0, doors=0)
    for opening in openings:
        host_element, host_place, host_component_id = wall_refs[opening['hostWall']]
        length, _height, thickness = opening['host']['size']
        # The host's local X is its length. Relative placement preserves rotated walls in IFC's Z-up frame.
        ox = -length / 2 + opening['offsetMeters'] + opening['widthMeters'] / 2
        placement, solid = prism(ox, 0, opening['sillMeters'], opening['widthMeters'], thickness + .02,
                                 opening['heightMeters'], placement_parent=host_place)
        seed = opening['componentId']
        opening_label = opening.get('label') or opening['id']
        element = w.add(f"IFCOPENINGELEMENT('{ifc_guid(seed)}',$,{label(opening_label)},"
                        f"{label('Operator-reviewed opening; dimensions and clearance not independently verified.')},"
                        f"$,{placement},{shape([solid])},$,.OPENING.)")
        w.add(f"IFCRELVOIDSELEMENT('{ifc_guid(seed + '-voids')}',$,$,$,{host_element},{element})")
        properties(element, seed, {**lineage(opening), 'ComponentId': seed, 'SourceSha256': source_sha256, 'HostComponentId': host_component_id,
                                   'Provenance': opening.get('provenance', 'operator-reviewed'), 'ReviewSelfReported': True, 'Reviewed': True,
                                   'OpeningKey': opening['id'], 'HostWall': opening['hostWall'], 'WidthMetres': float(opening['widthMeters']),
                                   'HeightMetres': float(opening['heightMeters']), 'SillMetres': float(opening['sillMeters']),
                                   'MetricVerified': False, 'ClearanceVerified': False})
        counts['openings'] += 1
        if opening['kind'] == 'door':
            door_place, door_solid = prism(0, 0, 0, opening['widthMeters'], min(.05, thickness),
                                           opening['heightMeters'], placement_parent=placement)
            door_seed = opening['doorComponentId']
            door = w.add(f"IFCDOOR('{ifc_guid(door_seed)}',$,{label(opening_label + ' door')},"
                         f"{label('Closed reference leaf; handing, swing and physical passage not verified.')},"
                         f"$,{door_place},{shape([door_solid])},$,{real(opening['heightMeters'])},"
                         f"{real(opening['widthMeters'])},.DOOR.,.NOTDEFINED.,$)")
            w.add(f"IFCRELFILLSELEMENT('{ifc_guid(door_seed + '-fills')}',$,$,$,{element},{door})")
            properties(door, door_seed, {**lineage(opening), 'ComponentId': door_seed, 'SourceSha256': source_sha256,
                                         'HostComponentId': host_component_id, 'OpeningComponentId': seed,
                                         'Provenance': opening.get('provenance', 'operator-reviewed'), 'ReviewSelfReported': True,
                                         'Reviewed': True, 'LeafRepresentation': 'closed-reference',
                                         'SwingVerified': False, 'MetricVerified': False, 'ClearanceVerified': False})
            elements.append(door); counts['doors'] += 1
    runs = merge_unknown(scene.get('unknown', []))
    if runs:
        unknown_id = derive_id(source_sha256, 'unknown', 'space')
        floor_y = float(scene.get('floor_y', 0))
        solids = []
        for x0, x1, z, c in runs:
            point = w.add(f'IFCCARTESIANPOINT(({real((x0 + x1) / 2)},{real(-(z + c / 2))},{real(floor_y)}))')
            position = w.add(f'IFCAXIS2PLACEMENT3D({point},{z_axis},{x_axis})')
            profile = w.add(f"IFCRECTANGLEPROFILEDEF(.AREA.,$,{origin2d},{real(x1 - x0)},{real(c)})")
            solids.append(w.add(f'IFCEXTRUDEDAREASOLID({profile},{position},{z_axis},{real(UNKNOWN_HEIGHT)})'))
        element = w.add(f"IFCBUILDINGELEMENTPROXY('{ifc_guid(unknown_id)}',$,'Unknown space (not free)',"
                        f"{label('Floor area no reconstructed point reached. Not evidence of free space.')},$,{storey_place},{shape(solids)},$,.NOTDEFINED.)")
        properties(element, unknown_id, {'ComponentId': unknown_id, 'SourceSha256': source_sha256,
                                        'Provenance': 'unknown', 'Label': 'unknown', 'Cells': len(scene.get('unknown', []))})
        elements.append(element); counts['unknownRuns'] = len(runs)
    if elements:
        w.add(f"IFCRELCONTAINEDINSPATIALSTRUCTURE('{ifc_guid(derive_id(source_sha256, 'relation', 'contained'))}',$,$,$,({','.join(elements)}),{storey})")
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S')
    text = ['ISO-10303-21;', 'HEADER;', "FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');",
            f"FILE_NAME('scene.ifc','{stamp}',(''),('BrainSNN'),'BrainSNN scene compiler','BrainSNN World Builder','');",
            "FILE_SCHEMA(('IFC4'));", 'ENDSEC;', 'DATA;']
    text += [f'#{i + 1}={row};' for i, row in enumerate(w.rows)] + ['ENDSEC;', 'END-ISO-10303-21;']
    Path(path).write_text('\n'.join(text) + '\n', encoding='ascii')
    return counts


def emit_ifc(out, scene: dict) -> dict:
    """Write scene.ifc for a metric scene, or record why not; a skipped IFC also removes a stale file."""
    path = Path(out) / 'scene.ifc'
    if scene.get('units') == 'm':
        scene['ifc'] = {'written': True, 'schema': 'IFC4', 'elements': write_ifc(path, scene)}
    else:
        path.unlink(missing_ok=True)
        scene['ifc'] = {'written': False, 'reason': IFC_NEEDS_METRES}
    return scene['ifc']
