"""CAD and estimating exports of a compiled metric scene: a DXF plan, a Rhino 3DM model and a quantities sheet.

All three come from scene.json, the source of the GLB, USD and IFC, so their numbers match those files. Plans use
the IFC export's frame: plan X is the scene's x and plan Y is minus its z (seen from above, y up); 3DM is Z-up with
the same X and Y. Every file says where its scale came from, and none claims a verified measurement:
- scene-plan.dxf (ezdxf): layers FLOOR, WALLS, OBJECTS, UNKNOWN, DIMENSIONS and LABELS in metres, with each wall's
  length dimensioned and the observed floor extent as a rectangle (an extent, not the room's outline).
- scene.3dm (rhino3dm): one layer each for floor, walls, objects and unknown space, every element a named box with
  its measurements, IFC class and provenance as user text, and the scale in the document's user text.
- quantities.csv: one row per element (length, width, height, plan or face area) under a summary of totals, led by
  the floor the capture saw (the extent less unknown cells), not the extent's bounding rectangle.
Both libraries are optional (requirements-cad.txt); without one, that file is skipped and the evidence says why.
"""
from __future__ import annotations

import csv
import math
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scene_compiler'))
from opening_geometry import wall_parts, door_parts, plan_wall_parts, wall_openings

LAYERS = {'FLOOR': 8, 'WALLS': 7, 'OBJECTS': 4, 'UNKNOWN': 6, 'DIMENSIONS': 2, 'LABELS': 7}  # AutoCAD colour indices
RHINO_LAYERS = {'Floor': (216, 205, 184), 'Walls': (154, 166, 184), 'Objects': (168, 85, 247), 'Unknown space (not free)': (255, 79, 154)}


def footprint(centre_x, centre_z, length, thickness, yaw_degrees):
    """Plan corners (x, -z) of a box whose length runs along (cos yaw, sin yaw) in the scene's x-z plane (scene_compiler)."""
    yaw = math.radians(yaw_degrees)
    d, n = (math.cos(yaw), math.sin(yaw)), (-math.sin(yaw), math.cos(yaw))
    corners = []
    for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        x = centre_x + a * length / 2 * d[0] + b * thickness / 2 * n[0]
        z = centre_z + a * length / 2 * d[1] + b * thickness / 2 * n[1]
        corners.append((x, -z))
    return corners


def elements(scene):
    """Floor, walls, objects and unknown cells as plan rectangles with their heights and metadata."""
    floor_y = scene['floor_y']
    out = []
    for o in scene.get('objects', []):
        if o.get('name') == 'floor_observed':
            (x0, _, z0), (x1, _, z1) = o['min'], o['max']
            out.append({'kind': 'floor', 'name': o['name'], 'label': 'floor', 'ifc': 'IfcSlab', 'corners': [(x0, -z0), (x1, -z0), (x1, -z1), (x0, -z1)],
                        'length': x1 - x0, 'width': z1 - z0, 'height': o['size'][1], 'base': o['min'][1], 'provenance': o.get('provenance', 'observed')})
        else:
            L, h, t = o['size']
            label = o.get('label') if o.get('label') not in (None, 'object') else None
            out.append({'kind': 'object', 'name': o['name'], 'label': label, 'ifc': o.get('ifcClass', 'IfcBuildingElementProxy'),
                        'corners': footprint(o['centre'][0], o['centre'][2], L, t, o.get('yaw_degrees', 0)), 'length': L, 'width': t, 'height': h,
                        'base': o['centre'][1] - h / 2, 'provenance': o.get('provenance', 'observed'), 'label_source': o.get('labelSource'),
                        'label_reviewed': o.get('labelReviewed') if label else None, 'base_inferred': o.get('base') == 'inferred'})
    for w in scene.get('walls', []):
        L, h, t = w['size']
        def rect(part):
            return {'corners': footprint(part['centre'][0], part['centre'][2], part['size'][0], part['size'][2], part.get('yaw_degrees', 0)),
                    'base': part['centre'][1] - part['size'][1] / 2, 'height': part['size'][1]}
        holes = wall_openings(w, scene.get('openings', []))
        out.append({'kind': 'wall', 'name': w['name'], 'label': 'wall', 'ifc': 'IfcWall', 'corners': footprint(w['centre'][0], w['centre'][2], L, t, w.get('yaw_degrees', 0)),
                    'length': L, 'width': t, 'height': h, 'base': w['centre'][1] - h / 2, 'provenance': w.get('provenance', 'observed'),
                    'net_face_area': L * h - sum(o['widthMeters'] * o['heightMeters'] for o in holes),
                    'solid_parts': [rect(part) for part in wall_parts(w, holes)],
                    'plan_parts': [rect(part)['corners'] for part in plan_wall_parts(w, holes, closed_doors_block=False, floor_y=floor_y)]})
    for leaf in door_parts(scene.get('walls', []), scene.get('openings', [])):
        L, h, t = leaf['size']
        out.append({'kind': 'door', 'name': leaf['name'], 'label': 'closed reference door', 'ifc': 'IfcDoor',
                    'corners': footprint(leaf['centre'][0], leaf['centre'][2], L, t, leaf.get('yaw_degrees', 0)),
                    'length': L, 'width': t, 'height': h, 'base': leaf['centre'][1] - h / 2, 'provenance': leaf['provenance']})
    for n, (x, z, c) in enumerate(scene.get('unknown', [])):
        out.append({'kind': 'unknown', 'name': f'unknown_{n + 1}', 'label': 'unknown space (not free)', 'ifc': 'IfcBuildingElementProxy',
                    'corners': [(x, -z), (x + c, -z), (x + c, -(z + c)), (x, -(z + c))], 'length': c, 'width': c, 'height': 0.3, 'base': floor_y,
                    'provenance': 'unknown'})
    return out


def scale_note(scene):
    s = scene.get('scale') if isinstance(scene.get('scale'), dict) else {}
    source = s.get('source', 'unknown')
    distance = f", from a {s['distance']} m distance" if isinstance(s.get('distance'), (int, float)) else ''
    return f"Scale: {source}{distance}; self-reported {bool(s.get('selfReported', True))}, verified {bool(s.get('verified', False))}"


def quantities(scene, items):
    """Rows for quantities.csv and the totals the evidence records."""
    floor = next((i for i in items if i['kind'] == 'floor'), None)
    walls = [i for i in items if i['kind'] == 'wall']; objects = [i for i in items if i['kind'] == 'object']
    doors = [i for i in items if i['kind'] == 'door']
    unknown = [i for i in items if i['kind'] == 'unknown']
    # The floor the capture saw: the extent less the unknown cells inside it. The extent alone is a bounding rectangle,
    # which for a room turned against the axes takes in empty corners.
    def inside(u):
        (ux0, uy0), (ux1, uy1) = u['corners'][0], u['corners'][2]
        (fx0, fy0), (fx1, fy1) = floor['corners'][0], floor['corners'][2]
        w = min(max(ux0, ux1), max(fx0, fx1)) - max(min(ux0, ux1), min(fx0, fx1))
        h = min(max(uy0, uy1), max(fy0, fy1)) - max(min(uy0, uy1), min(fy0, fy1))
        return max(0.0, w) * max(0.0, h)
    observed = floor['length'] * floor['width'] - sum(inside(u) for u in unknown) if floor else None
    totals = {'floor_extent_m': [round(floor['length'], 3), round(floor['width'], 3)] if floor else None,
              'floor_extent_area_m2': round(floor['length'] * floor['width'], 2) if floor else None,
              'observed_floor_area_m2': round(observed, 2) if floor else None,
              'walls': len(walls), 'wall_length_m': round(sum(w['length'] for w in walls), 2),
              'wall_face_area_m2': round(sum(w.get('net_face_area', w['length'] * w['height']) for w in walls), 2),
              'openings': len(scene.get('openings', [])), 'doors': len(doors),
              'objects': len(objects), 'named_objects': sum(1 for o in objects if o['label']),
              'unknown_area_m2': round(sum(u['length'] * u['width'] for u in unknown), 2)}
    head = ['section', 'element', 'ifc_class', 'name', 'length_m', 'width_m', 'height_m', 'area_m2', 'notes']
    rows = [head,
            ['summary', 'floor_observed', 'IfcSlab', 'floor', *(f'{v:.3f}' for v in totals['floor_extent_m'] or ['', '']), '', totals['observed_floor_area_m2'], 'floor the capture saw: the extent less unknown cells'],
            ['summary', 'floor_extent', 'IfcSlab', 'floor extent', *(f'{v:.3f}' for v in totals['floor_extent_m'] or ['', '']), '', totals['floor_extent_area_m2'], 'bounding rectangle of the observed floor, not the room outline'],
            ['summary', 'walls', 'IfcWall', f"{totals['walls']} walls", f"{totals['wall_length_m']:.2f}", '', '', totals['wall_face_area_m2'], 'total length; net one-face area after reviewed voids'],
            ['summary', 'objects', '', f"{totals['objects']} objects", '', '', '', '', f"{totals['named_objects']} named, unreviewed"],
            ['summary', 'unknown_space', 'IfcBuildingElementProxy', 'unknown space', '', '', '', totals['unknown_area_m2'], 'floor no point reached: not free space'],
            ['summary', 'scale', '', '', '', '', '', '', scale_note(scene)]]
    for i in walls + objects + doors:
        area = i.get('net_face_area', i['length'] * i['height']) if i['kind'] == 'wall' else i['length'] * i['width']
        note = 'net one-face area after reviewed voids' if i['kind'] == 'wall' else ('closed reference leaf; no clearance validation' if i['kind'] == 'door' else 'plan area') + (f"; name from {i['label_source']}, unreviewed" if i['label'] and i.get('label_source') else '') \
            + ('; base inferred: the floor under it went unseen' if i.get('base_inferred') else '')
        rows.append([i['kind'], i['name'], i['ifc'], i['label'] or i['name'].replace('_', ' ').capitalize(), f"{i['length']:.3f}", f"{i['width']:.3f}",
                     f"{i['height']:.3f}", f'{area:.2f}', note])
    return rows, totals


def write_dxf(scene, items, path):
    import ezdxf
    from ezdxf.enums import TextEntityAlignment
    doc = ezdxf.new('R2018', setup=True); doc.units = ezdxf.units.M; doc.header['$MEASUREMENT'] = 1; doc.header['$INSUNITS'] = 6
    for name, colour in LAYERS.items():
        doc.layers.add(name, color=colour)
    msp = doc.modelspace()
    for i in items:
        layer = {'floor': 'FLOOR', 'wall': 'WALLS', 'object': 'OBJECTS', 'door': 'OBJECTS', 'unknown': 'UNKNOWN'}[i['kind']]
        plans = i.get('plan_parts', [i['corners']])
        for corners in plans:
            msp.add_lwpolyline(corners, close=True, dxfattribs={'layer': layer})
        if i['kind'] in ('wall', 'unknown'):
            for corners in plans:
                hatch = msp.add_hatch(color=LAYERS[layer], dxfattribs={'layer': layer})
                if i['kind'] == 'unknown': hatch.set_pattern_fill('ANSI31', scale=0.02)
                hatch.paths.add_polyline_path(corners, is_closed=True)
        if i['kind'] == 'wall':
            # The wall's length along its centre line, offset to the outside of the wall.
            c = i['corners']; a = ((c[0][0] + c[3][0]) / 2, (c[0][1] + c[3][1]) / 2); b = ((c[1][0] + c[2][0]) / 2, (c[1][1] + c[2][1]) / 2)
            msp.add_aligned_dim(p1=a, p2=b, distance=0.35, dxfattribs={'layer': 'DIMENSIONS'},
                                override={'dimtxt': 0.12, 'dimasz': 0.08, 'dimdec': 2, 'dimexe': 0.05, 'dimexo': 0.05, 'dimgap': 0.03}).render()
        if i['kind'] in ('object', 'door'):
            cx, cy = sum(p[0] for p in i['corners']) / 4, sum(p[1] for p in i['corners']) / 4
            msp.add_text(i['label'] or i['name'].replace('_', ' '), height=0.1, dxfattribs={'layer': 'LABELS'}).set_placement((cx, cy), align=TextEntityAlignment.MIDDLE_CENTER)
            msp.add_text(f"{i['length']:.2f} x {i['width']:.2f} m", height=0.07, dxfattribs={'layer': 'LABELS'}).set_placement((cx, cy - 0.14), align=TextEntityAlignment.MIDDLE_CENTER)
    floor = next((i for i in items if i['kind'] == 'floor'), None)
    if floor:
        (x0, y0), (x1, _), (_, y1) = floor['corners'][0], floor['corners'][1], floor['corners'][2]
        top, left = max(y0, y1), min(x0, x1)
        msp.add_aligned_dim(p1=(min(x0, x1), top), p2=(max(x0, x1), top), distance=0.6, dxfattribs={'layer': 'DIMENSIONS'},
                            override={'dimtxt': 0.14, 'dimasz': 0.1, 'dimdec': 2}).render()
        msp.add_aligned_dim(p1=(left, min(y0, y1)), p2=(left, max(y0, y1)), distance=0.6, dxfattribs={'layer': 'DIMENSIONS'},
                            override={'dimtxt': 0.14, 'dimasz': 0.1, 'dimdec': 2}).render()
        note = ['BrainSNN World Builder - plan from a walkthrough reconstruction, metres', scale_note(scene),
                'Observed floor extent shown as a rectangle; unknown space hatched, never free. Not a survey.']
        for k, s in enumerate(note):
            msp.add_text(s, height=0.09, dxfattribs={'layer': 'LABELS'}).set_placement((left, min(y0, y1) - 0.5 - 0.16 * k), align=TextEntityAlignment.LEFT)
    doc.saveas(path)
    return {'written': True, 'layers': list(LAYERS), 'entities': len(msp)}


def box(r, corners, base, height):
    """A rhino3dm Brep box on a plan rectangle (corners in order), from base up by height: built centred on the
    origin, turned to the rectangle's length direction and moved to its centre (rhino3dm boxes are axis-aligned)."""
    (ax, ay), (bx, by), _, (dx, dy) = corners
    length, width = math.hypot(bx - ax, by - ay), math.hypot(dx - ax, dy - ay)
    cx, cy = sum(p[0] for p in corners) / 4, sum(p[1] for p in corners) / 4
    brep = r.Brep.CreateFromBox(r.Box(r.BoundingBox(r.Point3d(-length / 2, -width / 2, base), r.Point3d(length / 2, width / 2, base + height))))
    brep.Transform(r.Transform.Rotation(math.atan2(by - ay, bx - ax), r.Vector3d(0, 0, 1), r.Point3d(0, 0, 0)))
    brep.Transform(r.Transform.Translation(cx, cy, 0))
    return brep


def write_3dm(scene, items, path):
    import rhino3dm as r
    model = r.File3dm(); model.Settings.ModelUnitSystem = r.UnitSystem.Meters
    index = {}
    for name, colour in RHINO_LAYERS.items():
        layer = r.Layer(); layer.Name = name; layer.Color = (*colour, 255); index[name] = model.Layers.Add(layer)
    model.Strings['BrainSNN.source'] = 'World Builder scene compiled from a walkthrough reconstruction'  # document user text
    model.Strings['BrainSNN.scale'] = scale_note(scene)
    model.Strings['BrainSNN.metricVerified'] = 'false'
    for i in items:
        for part_no, part in enumerate(i.get('solid_parts', [i]), 1):
            brep = box(r, part['corners'], part['base'], part['height'])
            attrs = r.ObjectAttributes()
            attrs.LayerIndex = index[{'floor': 'Floor', 'wall': 'Walls', 'object': 'Objects', 'door': 'Objects', 'unknown': 'Unknown space (not free)'}[i['kind']]]
            attrs.Name = i['label'] if i['kind'] in ('object', 'door') and i['label'] else i['name']
            if len(i.get('solid_parts', [])) > 1: attrs.Name += f' part {part_no}'
            for key, value in (('element', i['name']), ('ifcClass', i['ifc']), ('provenance', i['provenance']), ('length_m', f"{i['length']:.3f}"),
                               ('width_m', f"{i['width']:.3f}"), ('height_m', f"{i['height']:.3f}"), ('labelSource', i.get('label_source') or ''),
                               ('labelReviewed', '' if i.get('label_reviewed') is None else str(i['label_reviewed']).lower()),
                               ('base', 'inferred' if i.get('base_inferred') else '')):
                if value: attrs.SetUserString(key, value)
            model.Objects.AddBrep(brep, attrs)
    model.Write(str(path), 8)
    return {'written': True, 'layers': list(RHINO_LAYERS), 'objects': len(model.Objects), 'units': 'm'}


def export(scene: dict, out: Path):
    """Write scene-plan.dxf, scene.3dm and quantities.csv for a metric scene. Returns evidence; skips what it cannot write."""
    out = Path(out)
    if scene.get('units') != 'm':
        return {'skipped': 'CAD exports need a metric scene.'}
    items = elements(scene)
    rows, totals = quantities(scene, items)
    with (out / 'quantities.csv').open('w', newline='') as f:
        csv.writer(f).writerows(rows)
    evidence = {'quantities': {'written': True, 'rows': len(rows) - 1, **totals}}
    for key, name, writer in (('dxf', 'scene-plan.dxf', write_dxf), ('3dm', 'scene.3dm', write_3dm)):
        try:
            evidence[key] = writer(scene, items, out / name)
        except ImportError as error:
            evidence[key] = {'written': False, 'reason': f'{error.name} is not installed (requirements-cad.txt)'}
            (out / name).unlink(missing_ok=True)
    return evidence
