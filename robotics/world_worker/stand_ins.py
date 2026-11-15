"""Stand-in models for named objects: a real-size, licensed 3D model placed where a named object stands in the compiled
scene, so the scene opens in Blender, Omniverse or a viewer with a golf cart where the scan found a golf cart.

Runs inside Blender on the compiler's scene.blend:
  blender -b scene-work/scene.blend --python-exit-code 1 --python stand_ins.py -- --scene scene.json --catalog DIR --out DIR

What it does and does not do:
- A stand-in is placed only for an object whose name has medium or high confidence AND whose measured footprint is
  within tolerance of the catalog model's real size (a 2.6 m golf cart is not placed on a 5.5 m cluster of carts: that
  object keeps its box and is reported as 'cluster'). The model is never scaled to the footprint; its real size is the point.
- The scan, the floor, the walls, the unknown volumes and the original object boxes all stay. Stand-ins are an
  additional, clearly named collection ('stand_ins'); each carries custom properties naming the object it stands for,
  the catalog asset, its licence and source, and 'provenance: stand-in, not scanned geometry'.
- Output: scene-stand-ins.glb and scene-stand-ins.usda (metric, Y-up like scene.glb) and stand-ins.json listing every
  placement and every refusal with its reason. The catalog is a directory with catalog.json; nothing is downloaded.
"""
import argparse
import json
import math
import sys
from pathlib import Path

SCHEMA = 'brainsnn.stand-ins.v1'
SIZE_TOLERANCE = 0.45   # measured footprint may differ from the model's real size by this fraction (sparse boxes are rough)


def load_catalog(folder: Path):
    doc = json.loads((folder / 'catalog.json').read_text())
    if doc.get('schema') != 'brainsnn.stand-in-catalog.v1' or not isinstance(doc.get('assets'), list):
        raise ValueError('catalog.json is not a brainsnn.stand-in-catalog.v1 file.')
    assets = {}
    for a in doc['assets']:
        for key in ('label', 'file', 'license', 'source', 'length_m', 'width_m', 'height_m'):
            if key not in a:
                raise ValueError(f'Catalog asset is missing {key}.')
        path = folder / a['file']
        if not path.is_file() or path.suffix.lower() != '.glb':
            raise ValueError(f'Catalog asset {a["file"]} is not a .glb file in the catalog directory.')
        for label in [a['label'], *a.get('aliases', [])]:
            assets[label.lower()] = {**a, 'path': path}
    return assets


def decide(obj, assets):
    """(asset, reason) for a compiled object: the asset to place, or None and why not."""
    label = str(obj.get('label') or '').lower()
    if obj.get('kind') != 'separated' or label in ('', 'object', 'unknown', 'floor'):
        return None, None
    if obj.get('labelConfidence') not in ('medium', 'high'):
        return None, f'label confidence {obj.get("labelConfidence")!r} is below medium'
    asset = assets.get(label) or next((a for key, a in assets.items() if key in label), None)
    if asset is None:
        return None, 'no catalog model for this label'
    size = obj.get('size') or [0, 0, 0]
    foot = sorted([float(size[0]), float(size[2])], reverse=True)
    real = sorted([float(asset['length_m']), float(asset['width_m'])], reverse=True)
    if foot[0] > real[0] * (1 + SIZE_TOLERANCE) and foot[1] > real[1] * (1 + SIZE_TOLERANCE):
        return None, f'cluster: measured footprint {foot[0]:.2f}×{foot[1]:.2f} m is larger than one {asset["label"]} ({real[0]:.2f}×{real[1]:.2f} m)'
    if foot[0] < real[0] * (1 - SIZE_TOLERANCE) * 0.5:
        return None, f'measured footprint {foot[0]:.2f} m is too small for a {asset["label"]} ({real[0]:.2f} m)'
    return asset, None


def main():
    import bpy
    import mathutils
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    p = argparse.ArgumentParser(); p.add_argument('--scene', required=True); p.add_argument('--catalog', required=True); p.add_argument('--out', required=True)
    a = p.parse_args(argv)
    scene = json.loads(Path(a.scene).read_text()); out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    if scene.get('units') != 'm':
        raise SystemExit('Stand-ins need a metric scene: a model has a real size, and an arbitrary-unit scene has none.')
    assets = load_catalog(Path(a.catalog))
    floor_y = float(scene['floor_y'])
    coll = bpy.data.collections.new('stand_ins'); bpy.context.scene.collection.children.link(coll)
    placed, refused, cache = [], [], {}
    for obj in scene.get('objects', []):
        asset, reason = decide(obj, assets)
        if asset is None:
            if reason: refused.append({'object': obj['name'], 'label': obj.get('label'), 'reason': reason})
            continue
        key = str(asset['path'])
        if key not in cache:
            before = set(bpy.data.objects)
            bpy.ops.import_scene.gltf(filepath=key)
            new = [o for o in bpy.data.objects if o not in before]
            roots = [o for o in new if o.parent is None or o.parent not in new]
            # measure the model's real extent (metres) once, from its mesh bounds
            pts = [o.matrix_world @ mathutils.Vector(c) for o in new if o.type == 'MESH' for c in o.bound_box]
            lo = mathutils.Vector([min(v[i] for v in pts) for i in range(3)]); hi = mathutils.Vector([max(v[i] for v in pts) for i in range(3)])
            cache[key] = {'roots': roots, 'all': new, 'lo': lo, 'hi': hi}
            for o in new: o.hide_render = o.hide_viewport = True
        src = cache[key]
        # instance: duplicate the imported hierarchy under one empty, so every placement is independent
        root = bpy.data.objects.new(f'stand_in_{obj["name"]}', None); coll.objects.link(root)
        dup = {}
        for o in src['all']:
            c = o.copy()
            if o.data is not None: c.data = o.data
            c.hide_render = c.hide_viewport = False; coll.objects.link(c); dup[o] = c
        for o, c in dup.items():
            c.parent = dup.get(o.parent, root) if o.parent in dup else root
        # the model's bottom centre goes to the object's floor-centre; yaw from the compiled box (scene Y-up: yaw about Y)
        cx, _, cz = obj['centre']; yaw = math.radians(float(obj.get('yaw_degrees', 0.0)))
        mid = (src['lo'] + src['hi']) / 2
        for c in dup.values():
            if c.parent is root: c.location = c.location - mathutils.Vector((mid.x, mid.y, src['lo'].z))   # Blender Z-up: bottom centre to the origin
        # Blender's glTF import converts to Z-up; the compiler scene (scene.blend) is also Blender Z-up with scene Y-up
        # mapped as (x, -z, y). Place in Blender coordinates accordingly.
        axis = math.radians(90.0) if str(asset.get('length_axis', 'x')).lower() == 'y' else 0.0   # bring the model's length onto +X first
        root.location = (cx, -cz, floor_y); root.rotation_euler = (0, 0, -yaw + axis)
        for key_, value in (('brainsnn_provenance', 'stand-in, not scanned geometry'), ('brainsnn_object', obj['name']), ('brainsnn_label', obj.get('label')),
                            ('brainsnn_asset', asset['file']), ('brainsnn_license', asset['license']), ('brainsnn_source', asset['source']),
                            ('brainsnn_label_confidence', obj.get('labelConfidence')), ('brainsnn_component', obj.get('componentId'))):
            root[key_] = value if value is not None else ''
        placed.append({'object': obj['name'], 'label': obj.get('label'), 'labelConfidence': obj.get('labelConfidence'), 'asset': asset['file'],
                       'license': asset['license'], 'source': asset['source'], 'real_size_m': [asset['length_m'], asset['width_m'], asset['height_m']],
                       'measured_size_m': [round(float(v), 3) for v in obj['size']], 'centre': [float(v) for v in obj['centre']],
                       'yaw_degrees': float(obj.get('yaw_degrees', 0.0)), 'scale': 1.0, 'componentId': obj.get('componentId'),
                       'provenance': 'stand-in, not scanned geometry; placed on a named, separated object'})
    for src in cache.values():
        for o in src['all']: bpy.data.objects.remove(o, do_unlink=True)
    report = {'schema': SCHEMA, 'placed': placed, 'refused': refused, 'catalog': sorted({a['file'] for a in assets.values()}),
              'size_tolerance': SIZE_TOLERANCE, 'written': bool(placed),
              'scope': 'Stand-ins are real-size licensed models standing where named objects were measured. They are not scanned geometry and carry no scale authority.'}
    if placed:
        bpy.ops.object.select_all(action='DESELECT')
        bpy.ops.export_scene.gltf(filepath=str(out / 'scene-stand-ins.glb'), export_format='GLB', export_extras=True, export_apply=True)
        try:
            kwargs = {'filepath': str(out / 'scene-stand-ins.usda'), 'export_custom_properties': True}
            props = {p.identifier for p in bpy.ops.wm.usd_export.get_rna_type().properties}
            if 'export_textures_mode' in props: kwargs['export_textures_mode'] = 'KEEP'      # one file, no textures directory (Blender 4.2+)
            elif 'export_textures' in props: kwargs['export_textures'] = False
            bpy.ops.wm.usd_export(**kwargs)
            report['usd'] = {'written': (out / 'scene-stand-ins.usda').is_file()}
        except Exception as error:
            report['usd'] = {'written': False, 'reason': f'{type(error).__name__}: {str(error)[:120]}'}
    (out / 'stand-ins.json').write_text(json.dumps(report, indent=2, allow_nan=False))
    print(f'STAND_INS_OK placed={len(placed)} refused={len(refused)}')


if __name__ == '__main__':
    main()
