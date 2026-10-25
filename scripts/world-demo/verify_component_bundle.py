"""Verify a saved component rebuild's local consistency, never physical accuracy or native editing.

Requires the worker CAD dependencies and IfcOpenShell. Reads files without modifying them.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from robotics.scene_compiler import component_graph as cg, ifc_export, opening_geometry
from robotics.world_worker import cad_export, fit_check, measurement_check


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    require(path.is_file() and not path.is_symlink(), f'Not a regular file: {path}')
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def read(path):
    require(path.is_file() and not path.is_symlink() and path.stat().st_size <= 16 * 1024**2, f'Invalid JSON file: {path}')
    return json.loads(path.read_text(), parse_constant=lambda value: require(False, f'Nonfinite JSON: {value}'))


def verify(bundle, original, cloud_path):
    import ifcopenshell
    import ifcopenshell.util.element
    import rhino3dm
    if original.is_dir():
        original = original / 'scene.json'
    scene, old, cloud = read(bundle / 'scene.json'), read(original), read(cloud_path)
    receipt = read(bundle / 'component-rebuild.json')
    require(receipt['schema'] == 'brainsnn.component-rebuild.v1' and receipt['blenderProcessSucceeded'] is True, 'Missing successful rebuild receipt')
    require(all(receipt[key] is False for key in ('metric_verified', 'physics_ready', 'physicalRobotValidated')), 'Unsupported verification claim')
    files = receipt['artifacts']
    require({p.name for p in bundle.iterdir()} == set(files) | {'component-rebuild.json'}, 'Bundle inventory differs from receipt')
    for name, record in files.items():
        require(Path(name).name == name and digest(bundle / name) == record['sha256'] and (bundle / name).stat().st_size == record['bytes'], f'Artifact mismatch: {name}')
    require((bundle / 'source-scene.json').read_bytes() == original.read_bytes() and (bundle / 'arena-cloud.json').read_bytes() == cloud_path.read_bytes(), 'Original bytes changed')
    require(receipt['sourceSceneSha256'] == digest(original) and receipt['editFileSha256'] == digest(bundle / 'component-edits.json'), 'Input receipt hash mismatch')
    expected = cg.apply_edits(old, read(bundle / 'component-edits.json'))
    cg.ensure_component_ids(scene)
    require(scene['componentGraph'] == expected['componentGraph'], 'Rebuilt graph differs from admitted edits')
    source = {'scene': {'sha256': digest(bundle / 'scene.json')}, 'cloud': {'sha256': digest(cloud_path)}}
    graph = read(bundle / 'component-graph.json')
    require(graph['graph'] == scene['componentGraph'] and graph['sourceFiles'] == receipt['sourceFiles'] == source, 'Graph/file binding mismatch')
    require(scene['cloudPointsSha256'] == measurement_check.points_sha256(cloud), 'Scene/cloud point binding mismatch')
    fit = read(bundle / 'fit-check.json')
    require(fit == fit_check.check(scene, cloud['points']), 'Fit check is stale')
    report = read(bundle / 'scene-measurements.json')
    require(report.pop('sourceFiles') == source and report == measurement_check.build_report(scene, cloud), 'Point comparison report is stale')
    nav = read(bundle / 'nav2-map.json')
    require(nav['source']['sceneSha256'] == source['scene']['sha256'] and nav['source']['cloudSha256'] == source['cloud']['sha256'], 'Nav2 source binding mismatch')
    for name, record in nav['artifacts'].items():
        require(Path(name).name == name and digest(bundle / name) == record['sha256'] and (bundle / name).stat().st_size == record['bytes'], 'Nav2 artifact mismatch')
    def records(value):
        return {item['componentId']: item for field in ('walls', 'objects', 'openings') for item in value.get(field, [])}
    current, prior = records(scene), records(old)
    require(set(current) == set(prior), 'Component identities changed')
    shape_keys = ('centre', 'size', 'yaw_degrees', 'offsetMeters', 'widthMeters', 'heightMeters', 'sillMeters', 'host')
    changed = {key for key, item in current.items() if any(item.get(k) != prior[key].get(k) for k in shape_keys)}
    require(all(current[key].get('provenance') == 'operator-authored-edit' and current[key].get('dimensionProvenance') == 'operator-authored-edit' for key in changed), 'Edited geometry lacks authored provenance')
    parts = [o for o in scene['objects'] if 'centre' in o] + [p for w in scene['walls'] for p in opening_geometry.wall_parts(w, scene.get('openings', []))] + opening_geometry.door_parts(scene['walls'], scene.get('openings', []))
    with (bundle / 'scene.glb').open('rb') as stream:
        magic, version, total, length, kind = struct.unpack('<5I', stream.read(20))
        require(magic == 0x46546C67 and version == 2 and total == (bundle / 'scene.glb').stat().st_size and kind == 0x4E4F534A and length <= 16 * 1024**2, 'Invalid GLB header')
        glb = json.loads(stream.read(length))
    nodes = {node.get('name'): node for node in glb.get('nodes', [])}
    require(all(node.get('extras', {}).get('componentId') in {p['componentId'] for p in parts} for node in glb.get('nodes', []) if 'componentId' in node.get('extras', {})), 'Unknown GLB component identity')
    for part in parts:
        extras = nodes[part['name']].get('extras', {})
        require(extras.get('componentId') == part['componentId'] and extras.get('provenance') == part.get('provenance'), 'GLB component metadata mismatch')
        require(extras.get('sourceProvenance') == part.get('sourceProvenance'), 'GLB source provenance mismatch')
        if part['componentId'] in changed:
            require(extras.get('dimensionProvenance') == 'operator-authored-edit', 'GLB authored dimensions missing')
    model = ifcopenshell.open(str(bundle / 'scene.ifc'))
    metadata = {part['componentId']: part for part in parts} | current
    by_id = {}
    for entity in model.by_type('IfcProduct'):
        props = ifcopenshell.util.element.get_psets(entity).get('Pset_BrainSNN', {})
        if props.get('ComponentId'):
            identifier = props['ComponentId']; require(identifier not in by_id, 'Duplicate IFC component')
            require(entity.GlobalId == ifc_export.ifc_guid(identifier) and props.get('SourceSha256') == scene['componentGraph']['sourceSha256'], 'IFC identity mismatch')
            require(props.get('SourceProvenance') == metadata.get(identifier, {}).get('sourceProvenance'), 'IFC source provenance mismatch')
            if identifier in changed:
                require(props.get('Provenance') == 'operator-authored-edit' and props.get('DimensionProvenance') == 'operator-authored-edit', 'IFC authored provenance missing')
            by_id[identifier] = entity.GlobalId
    represented = {item['componentId'] for item in parts} | {o['componentId'] for o in scene.get('openings', [])}
    require(represented <= set(by_id), 'IFC component missing')
    rhino = rhino3dm.File3dm.Read(str(bundle / 'scene.3dm'))
    require(rhino is not None and json.loads(rhino.Strings['BrainSNN.openings']) == scene.get('openings', []), 'Rhino opening metadata mismatch')
    actual = []
    for obj in rhino.Objects:
        attrs = obj.Attributes; identifier = attrs.GetUserString('componentId'); actual.append(identifier)
        require(identifier in by_id and attrs.GetUserString('ifcGlobalId') == by_id[identifier] and attrs.GetUserString('sourceSha256') == scene['componentGraph']['sourceSha256'], 'Rhino/IFC identity mismatch')
        require(attrs.GetUserString('sourceProvenance') == metadata.get(identifier, {}).get('sourceProvenance', ''), 'Rhino source provenance mismatch')
        if identifier in changed:
            require(attrs.GetUserString('provenance') == 'operator-authored-edit' and attrs.GetUserString('dimensionProvenance') == 'operator-authored-edit', 'Rhino authored provenance missing')
    expected_rhino = [item['componentId'] for item in cad_export.elements(scene) for _ in item.get('solid_parts', [item])]
    require(sorted(actual) == sorted(expected_rhino), 'Rhino component inventory mismatch')
    return {'consistent': True, 'revision': scene['componentGraph']['revision'], 'components': len(current), 'editedGeometryComponents': len(changed), 'sourceFiles': source, 'scope': 'Local file consistency only; no physical accuracy, native editing or robot execution is certified.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('bundle', 'original', 'cloud'):
        parser.add_argument('--' + name, required=True, type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.bundle, args.original, args.cloud), indent=2))
    except (ValueError, OSError, KeyError, TypeError, ImportError, struct.error) as error:
        parser.exit(2, f'REFUSED: {error}\n')
