"""Scene transport fixture for browser tests: writes an authored scene.glb and scene.json. No reconstruction or Blender runs.

The boxes are hand-placed, so the scene only exercises the worker → browser hand-off (manifest, tickets, SHA-256, viewer),
never a claim about any capture.
"""
import argparse
import copy
import hashlib
import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'robotics' / 'scene_compiler'))
from ifc_export import emit_ifc  # noqa: E402  the real IFC writer, run on the authored scene
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'robotics' / 'world_worker'))
from measurement_check import build_report  # noqa: E402  real checks on authored transport geometry

# (name, min corner, max corner, linear RGBA, glTF extras), Y-up metres-like units as the compiler writes them.
BOXES = [
    ('floor_observed', (0, -.02, 0), (4, 0, 3), (.55, .45, .30, 1), {'provenance': 'observed', 'label': 'floor'}),
    ('wall_1', (0, 0, 0), (4, 2.4, .1), (.75, .75, .78, 1), {'provenance': 'observed', 'label': 'wall', 'support_points': 40}),
    ('unknown_space', (3, 0, 2), (4, .3, 3), (.9, .3, .3, 1), {'provenance': 'unknown'}),
]
FACES = [((1, 0, 0), [(1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)]), ((-1, 0, 0), [(0, 0, 1), (0, 1, 1), (0, 1, 0), (0, 0, 0)]),
         ((0, 1, 0), [(0, 1, 1), (1, 1, 1), (1, 1, 0), (0, 1, 0)]), ((0, -1, 0), [(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)]),
         ((0, 0, 1), [(1, 0, 1), (1, 1, 1), (0, 1, 1), (0, 0, 1)]), ((0, 0, -1), [(0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0)])]


def glb(boxes=BOXES):
    blob, views, accessors, meshes, materials, nodes = bytearray(), [], [], [], [], []
    def view(data, target, component, count, kind, bounds=None):
        views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data), 'target': target})
        blob.extend(data)
        accessors.append({'bufferView': len(views) - 1, 'componentType': component, 'count': count, 'type': kind, **(bounds or {})})
        return len(accessors) - 1
    for name, lo, hi, colour, extras in boxes:
        positions, normals, indices = [], [], []
        for normal, corners in FACES:
            base = len(positions)
            positions += [tuple(lo[i] + c[i] * (hi[i] - lo[i]) for i in range(3)) for c in corners]
            normals += [normal] * 4
            indices += [base, base + 1, base + 2, base, base + 2, base + 3]
        position = view(struct.pack(f'<{len(positions) * 3}f', *sum(positions, ())), 34962, 5126, len(positions), 'VEC3',
                        {'min': list(map(float, lo)), 'max': list(map(float, hi))})
        normal = view(struct.pack(f'<{len(normals) * 3}f', *sum(normals, ())), 34962, 5126, len(normals), 'VEC3')
        index = view(struct.pack(f'<{len(indices)}H', *indices), 34963, 5123, len(indices), 'SCALAR')
        materials.append({'name': name + '_mat', 'pbrMetallicRoughness': {'baseColorFactor': list(colour), 'metallicFactor': 0, 'roughnessFactor': .8}})
        meshes.append({'name': name, 'primitives': [{'attributes': {'POSITION': position, 'NORMAL': normal}, 'indices': index, 'material': len(materials) - 1}]})
        nodes.append({'name': name, 'mesh': len(meshes) - 1, 'extras': extras})
    gltf = {'asset': {'version': '2.0', 'generator': 'brainsnn scene transport fixture'}, 'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}],
            'nodes': nodes, 'meshes': meshes, 'materials': materials, 'accessors': accessors, 'bufferViews': views,
            'buffers': [{'byteLength': len(blob)}]}
    text = json.dumps(gltf, separators=(',', ':')).encode()
    text += b' ' * (-len(text) % 4)
    blob += b'\0' * (-len(blob) % 4)
    return (struct.pack('<III', 0x46546C67, 2, 28 + len(text) + len(blob)) + struct.pack('<II', len(text), 0x4E4F534A) + text
            + struct.pack('<II', len(blob), 0x004E4942) + bytes(blob))


SCENE = {'schema': 'brainsnn.scene.v1', 'units': 'arbitrary', 'scale': None, 'source': 'authored transport fixture', 'floor_y': 0,
         'objects': [{'name': 'floor_observed', 'label': 'floor', 'provenance': 'observed', 'centre': [2, -.01, 1.5], 'size': [4, .02, 3]},
                     {'name': 'chair', 'label': 'chair', 'provenance': 'detected-unplaced', 'reason': 'no camera pose for this frame in the cloud\'s frame'}],
         'walls': [{'name': 'wall_1', 'label': 'wall', 'provenance': 'observed', 'centre': [2, 1.2, .05], 'size': [4, 2.4, .1], 'yaw_degrees': 0, 'support_points': 40}],
         'unknown': [[3, 2, 1]],
         'usd': {'written': False, 'reason': 'Fixture: arbitrary units.'},
         'counts': {'points': 0, 'walls': 1, 'objects': 0, 'unplaced': 1, 'unknown_cells': 1}}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input-manifest', required=True)
    request = json.loads(Path(parser.parse_args().input_manifest).read_text())
    out = Path(request['output_dir'])
    out.mkdir(parents=True, exist_ok=True)
    scene = copy.deepcopy(SCENE)
    extras = []
    preceding_artifacts = []
    # A browser point-cloud hand-off (already validated by the worker) keeps its units and scale, as the compiler does.
    cloud = next((json.loads(Path(i['path']).read_text()) for i in request['inputs'] if i['kind'] == 'cloud'), None)
    if cloud:
        metric = cloud['units'] == 'm'
        scene.update(units=cloud['units'], scale=cloud['scale'], source='browser hand-off (authored fixture scene)',
                     usd={'written': True, 'metersPerUnit': 1} if metric else {'written': False, 'reason': 'Fixture: arbitrary units.'},
                     counts={**SCENE['counts'], 'points': len(cloud['points'])})
        if metric:
            (out / 'scene.usda').write_text('#usda 1.0\n(\n    metersPerUnit = 1\n    upAxis = "Y"\n)\n')
            # Match scene-usd's diagnostic-before-GLB ordering. This is an authored transport diagnostic, not fit proof.
            diagnostic = cloud['points'][:32]
            (out / 'fit-heatmap.ply').write_text('ply\nformat ascii 1.0\n' + f'element vertex {len(diagnostic)}\n' +
                'property float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n' +
                '\n'.join(' '.join(map(str, row[:3])) + ' 255 0 0' for row in diagnostic) + '\n')
            preceding_artifacts.append({'name': 'fit-heatmap.ply', 'kind': 'evidence'})
        if cloud.get('bimReview'):
            from bim_review import apply_review
            scene = apply_review(scene, cloud)
        emit_ifc(out, scene)
        (out / 'arena-cloud.json').write_text(json.dumps(cloud, allow_nan=False))
        extras.append({'name': 'arena-cloud.json', 'kind': 'evidence'})
        if metric:
            report = build_report(scene, cloud)
            scene_raw = json.dumps(scene).encode()
            report['sourceFiles'] = {'scene': {'sha256': hashlib.sha256(scene_raw).hexdigest()},
                                     'cloud': {'sha256': hashlib.sha256((out / 'arena-cloud.json').read_bytes()).hexdigest()}}
            (out / 'scene-measurements.json').write_text(json.dumps(report, allow_nan=False))
            extras.append({'name': 'scene-measurements.json', 'kind': 'evidence'})
    (out / 'scene.glb').write_bytes(glb())
    (out / 'scene.json').write_text(json.dumps(scene))
    usd, ifc = scene['usd']['written'], (scene.get('ifc') or {}).get('written', False)
    (out / 'manifest.json').write_text(json.dumps({'artifacts': [
        *preceding_artifacts,
        {'name': 'scene.glb', 'kind': 'visual', 'representation': 'triangle-mesh', 'coordinate_frame': 'right-handed-y-up', 'units': scene['units']},
        *([{'name': 'scene.usda', 'kind': 'visual', 'representation': 'triangle-mesh', 'coordinate_frame': 'right-handed-y-up', 'units': 'm'}] if usd else []),
        *([{'name': 'scene.ifc', 'kind': 'bim'}] if ifc else []),
        {'name': 'scene.json', 'kind': 'evidence'}, *extras]}))


if __name__ == '__main__':
    main()
