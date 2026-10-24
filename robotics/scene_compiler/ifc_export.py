"""IFC4 (BIM) export of a compiled scene: observed floor and walls, detected objects and unknown space, in metres.

Written directly as IFC-SPF text so it runs wherever the compiler does (Blender's Python has no IfcOpenShell). Only metric
scenes are exported: IFC lengths are metres, and an arbitrary-unit scene would be off by an unknown factor. Every element
keeps its provenance in Pset_BrainSNN, and the project records how the scale was obtained, so a BIM tool never shows an
observed wall, a detected box and unseen space as the same kind of fact.
"""
from __future__ import annotations
import datetime
import math
import uuid
from pathlib import Path

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


def write_ifc(path, scene: dict, name: str = 'BrainSNN scene') -> dict:
    """Writes scene.ifc for a metric scene and returns element counts. Scene coordinates are Y-up; IFC is Z-up:
    (x, y, z) -> (x, -z, y), the same mapping the compiler uses for Blender."""
    if scene.get('units') != 'm':
        raise ValueError(IFC_NEEDS_METRES)
    w = _Writer()
    origin = w.add('IFCCARTESIANPOINT((0.,0.,0.))')
    z_axis, x_axis = w.add('IFCDIRECTION((0.,0.,1.))'), w.add('IFCDIRECTION((1.,0.,0.))')
    world = w.add(f'IFCAXIS2PLACEMENT3D({origin},{z_axis},{x_axis})')
    origin2d = w.add(f"IFCAXIS2PLACEMENT2D({w.add('IFCCARTESIANPOINT((0.,0.))')},$)")
    context = w.add(f"IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,{world},$)")
    body = w.add(f"IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,{context},$,.MODEL_VIEW.,$)")
    units = [w.add(f'IFCSIUNIT(*,.{kind}.,$,.{unit}.)') for kind, unit in
             [('LENGTHUNIT', 'METRE'), ('AREAUNIT', 'SQUARE_METRE'), ('VOLUMEUNIT', 'CUBIC_METRE'), ('PLANEANGLEUNIT', 'RADIAN')]]
    project = w.add(f"IFCPROJECT('{ifc_guid('project')}',$,{label(name)},{label('Compiled by BrainSNN World Builder from a reconstruction; not a surveyed model.')},"
                    f"$,$,$,({context}),{w.add('IFCUNITASSIGNMENT((' + ','.join(units) + '))')})")
    site_place = w.add(f'IFCLOCALPLACEMENT($,{world})')
    site = w.add(f"IFCSITE('{ifc_guid('site')}',$,'Site',$,$,{site_place},$,$,.ELEMENT.,$,$,$,$,$)")
    building_place = w.add(f'IFCLOCALPLACEMENT({site_place},{world})')
    building = w.add(f"IFCBUILDING('{ifc_guid('building')}',$,'Building',$,$,{building_place},$,$,.ELEMENT.,$,$,$)")
    storey_place = w.add(f'IFCLOCALPLACEMENT({building_place},{world})')
    storey = w.add(f"IFCBUILDINGSTOREY('{ifc_guid('storey')}',$,'Scanned floor',$,$,{storey_place},$,$,.ELEMENT.,0.)")
    for i, (parent, child) in enumerate([(project, site), (site, building), (building, storey)]):
        w.add(f"IFCRELAGGREGATES('{ifc_guid(f'aggregate-{i}')}',$,$,$,{parent},({child}))")

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

    scale = scene.get('scale') if isinstance(scene.get('scale'), dict) else {}
    properties(project, 'project', {'SceneSchema': scene.get('schema'), 'Units': 'm', 'ScaleSource': scale.get('source', 'unknown'),
                                    'MetresPerUnit': scale.get('metresPerUnit'), 'MeasuredDistanceMetres': scale.get('distance'),
                                    'SelfReported': scale.get('selfReported', True), 'MetricVerified': False})
    elements, counts = [], {'walls': 0, 'slabs': 0, 'objects': 0, 'separated': 0, 'unknownRuns': 0}
    for obj in scene.get('objects', []):
        if 'centre' not in obj or 'size' not in obj:
            continue  # unplaced detections have no geometry; they stay in scene.json with their reason
        (cx, cy, cz), (sx, sy, sz) = obj['centre'], obj['size']
        placement, solid = prism(cx, -cz, cy - sy / 2, sx, sz, sy, yaw=-math.radians(obj.get('yaw_degrees', 0)))
        seed = 'object-' + str(obj.get('name'))
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
        properties(element, seed, {'Provenance': obj.get('provenance'), 'Label': obj.get('label'), 'SupportPoints': obj.get('support_points'),
                                   'Detector': obj.get('detector') or obj.get('labelSource'), 'Separated': True if separated else None,
                                   'LabelConfidence': obj.get('labelConfidence'), 'LabelReviewed': obj.get('labelReviewed'),
                                   'LengthMetres': float(sx) if separated else None, 'WidthMetres': float(sz) if separated else None,
                                   'HeightMetres': float(sy) if separated else None})
        elements.append(element)
    for wall in scene.get('walls', []):
        if 'centre' not in wall or 'size' not in wall:
            continue
        (cx, cy, cz), (length, height, thickness) = wall['centre'], wall['size']
        placement, solid = prism(cx, -cz, cy - height / 2, length, thickness, height, yaw=-math.radians(wall.get('yaw_degrees', 0)))
        seed = 'wall-' + str(wall.get('name'))
        element = w.add(f"IFCWALL('{ifc_guid(seed)}',$,{label(wall.get('name', 'wall'))},$,$,{placement},{shape([solid])},$,.NOTDEFINED.)")
        properties(element, seed, {'Provenance': wall.get('provenance', 'observed'), 'Label': 'wall', 'SupportPoints': wall.get('support_points')})
        elements.append(element); counts['walls'] += 1
    runs = merge_unknown(scene.get('unknown', []))
    if runs:
        floor_y = float(scene.get('floor_y', 0))
        solids = []
        for x0, x1, z, c in runs:
            point = w.add(f'IFCCARTESIANPOINT(({real((x0 + x1) / 2)},{real(-(z + c / 2))},{real(floor_y)}))')
            position = w.add(f'IFCAXIS2PLACEMENT3D({point},{z_axis},{x_axis})')
            profile = w.add(f"IFCRECTANGLEPROFILEDEF(.AREA.,$,{origin2d},{real(x1 - x0)},{real(c)})")
            solids.append(w.add(f'IFCEXTRUDEDAREASOLID({profile},{position},{z_axis},{real(UNKNOWN_HEIGHT)})'))
        element = w.add(f"IFCBUILDINGELEMENTPROXY('{ifc_guid('unknown-space')}',$,'Unknown space (not free)',"
                        f"{label('Floor area no reconstructed point reached. Not evidence of free space.')},$,{storey_place},{shape(solids)},$,.NOTDEFINED.)")
        properties(element, 'unknown-space', {'Provenance': 'unknown', 'Label': 'unknown', 'Cells': len(scene.get('unknown', []))})
        elements.append(element); counts['unknownRuns'] = len(runs)
    if elements:
        w.add(f"IFCRELCONTAINEDINSPATIALSTRUCTURE('{ifc_guid('contained')}',$,$,$,({','.join(elements)}),{storey})")
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
