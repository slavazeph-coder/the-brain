"""Reviewed SimReady Central packages -> separate BrainSNN OpenUSD additions.

Operator-only CLI. Consumes NVIDIA index_to_library.py output; it does not
fetch assets, run vendor code, replace scan evidence, or certify robot physics.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
from urllib.parse import urlsplit

PIN = re.compile(r'/datasets/([\w.-]+/[\w.-]+)/resolve/([a-f0-9]{40})/([\w.-]+)/com\.nvidia\.simready\.packaging\.json', re.ASCII)
IDENT = re.compile(r'[A-Za-z_][A-Za-z0-9_]{0,79}', re.ASCII)
MAX_BYTES, MAX_FILES, MAX_INSTANCES, MAX_UNIQUE = 2 * 1024**3, 20000, 64, 16


def read_json(path: Path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 32 * 1024**2:
        raise ValueError('Expected a bounded regular JSON file.')
    def bad(value):
        raise ValueError('Non-finite JSON number: ' + value)
    return json.loads(path.read_text(encoding='utf-8'), parse_constant=bad)


def pin(url):
    if not isinstance(url, str):
        raise ValueError('Missing immutable package URL.')
    u = urlsplit(url)
    m = PIN.fullmatch(u.path)
    if u.scheme != 'https' or u.netloc != 'huggingface.co' or u.query or u.fragment or not m:
        raise ValueError('Expected an HTTPS Hugging Face package URL pinned to a 40-character commit.')
    repo, revision, asset = m.groups()
    if asset in ('.', '..') or any(s in ('.', '..') for s in repo.split('/')):
        raise ValueError('Invalid package identity.')
    return {'url': url, 'repo': repo, 'revision': revision, 'asset': asset}


def local(root: Path, relative, directory=False):
    if not isinstance(relative, str) or not relative or '\\' in relative or ':' in relative:
        raise ValueError('Expected a relative POSIX path.')
    if relative.startswith('/') or any(p in ('', '.', '..') for p in relative.split('/')):
        raise ValueError('Unsafe relative path.')
    base, current = root.resolve(), root.resolve()
    for part in relative.split('/'):
        current /= part
        if current.is_symlink():
            raise ValueError('Symlinks are not accepted in packages.')
    if not current.resolve().is_relative_to(base) or not (current.is_dir() if directory else current.is_file()):
        raise ValueError('Package path is absent or outside the workspace.')
    return current


def file_hash(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024**2), b''):
            h.update(block)
    return h.hexdigest()


def receipt(root):
    h, count, size = hashlib.sha256(), 0, 0
    for p in sorted(root.rglob('*')):
        if p.is_symlink():
            raise ValueError('Symlink in package.')
        if p.is_dir():
            continue
        if not p.is_file():
            raise ValueError('Non-regular file in package.')
        count += 1
        size += p.stat().st_size
        if size > MAX_BYTES or count > MAX_FILES:
            raise ValueError('Package exceeds the bounded import profile.')
        row = [p.relative_to(root).as_posix(), p.stat().st_size, file_hash(p)]
        h.update((json.dumps(row, separators=(',', ':')) + '\n').encode())
    if not count:
        raise ValueError('Empty package.')
    return {'sha256': h.hexdigest(), 'bytes': size, 'files': count}


def inspect(library, workspace):
    if not isinstance(library, dict) or not isinstance(library.get('assets'), list) or len(library['assets']) > 10000:
        raise ValueError('Expected NVIDIA library.json.')
    records, seen = [], set()
    for a in library['assets']:
        s = pin(a.get('source_url'))
        package = a.get('package') or {}
        if s['url'] in seen or (package.get('repo_id'), package.get('commit'), a.get('asset_name')) != (s['repo'], s['revision'], s['asset']):
            raise ValueError('Duplicate or inconsistent source identity.')
        seen.add(s['url'])
        files = a.get('files') or {}
        folder = local(workspace, files.get('directory'), True)
        root_usd = local(workspace, files.get('root_usd'))
        if not root_usd.is_relative_to(folder) or root_usd.suffix not in ('.usd', '.usda', '.usdc'):
            raise ValueError('Root USD must belong to this package.')
        manifest = read_json(folder / 'com.nvidia.simready.packaging.json')
        if not manifest.get('package_id') or manifest.get('package_id') != package.get('package_id') or manifest.get('license') != a.get('license'):
            raise ValueError('Package manifest does not match the library record.')
        records.append({'source': s, 'package_id': package['package_id'], 'license': a.get('license'),
                        'validation_reported': a.get('validation') or {}, 'benchmark_reported': a.get('benchmark'),
                        'directory': folder.relative_to(workspace.resolve()).as_posix(),
                        'root_usd': root_usd.relative_to(folder).as_posix(), 'receipt': receipt(folder),
                        'provenance': 'library-asset', 'validation_reexecuted': False})
    return records


def vector(value, bound):
    if not isinstance(value, list) or len(value) != 3 or any(type(x) not in (float, int) or not math.isfinite(x) or abs(x) > bound for x in value):
        raise ValueError('Expected three finite bounded coordinates.')
    return [float(x) for x in value]


def plan(records, request):
    if not isinstance(request, dict) or request.get('schema') != 'brainsnn.simready-placements.v1':
        raise ValueError('Unknown placement schema.')
    items = request.get('placements')
    if not isinstance(items, list) or not 1 <= len(items) <= MAX_INSTANCES:
        raise ValueError('Use 1 to 64 placements per batch.')
    by_url, ids, used, placements = {r['source']['url']: r for r in records}, set(), set(), []
    for p in items:
        if not isinstance(p, dict) or not isinstance(p.get('id'), str) or not IDENT.fullmatch(p['id']) or p['id'] in ids:
            raise ValueError('Unique USD-safe placement IDs are required.')
        ids.add(p['id'])
        a = by_url.get(p.get('source_url'))
        if a is None:
            raise ValueError('Asset is not in the inspected local library.')
        approval = p.get('approval') or {}
        if approval.get('package_sha256') != a['receipt']['sha256'] or approval.get('license') != a['license']:
            raise ValueError('Review does not match these exact bytes and license.')
        if approval.get('license_reviewed') is not True or approval.get('placement_reviewed') is not True or not a['license']:
            raise ValueError('Explicit package-license and placement review is required.')
        v = a['validation_reported']
        if v.get('passed') is not True or v.get('failed_features') or not v.get('profile'):
            raise ValueError('Missing or failing upstream profile validation.')
        if type(p.get('scale', 1)) not in (int, float) or p.get('scale', 1) != 1:
            raise ValueError('Physical assets cannot be resized without requalification.')
        policy = p.get('collision_policy', 'authored')
        if policy not in ('authored', 'convexHull') or (policy != 'authored' and approval.get('approximation_reviewed') is not True):
            raise ValueError('A convex hull may seal openings; review this approximation explicitly.')
        used.add(a['source']['url'])
        placements.append({'id': p['id'], 'asset': a, 'translation_m': vector(p.get('translation_m'), 10000),
                           'rotation_xyz_deg': vector(p.get('rotation_xyz_deg', [0, 0, 0]), 360),
                           'collision_policy': policy, 'provenance': 'library-asset'})
    if len(used) > MAX_UNIQUE:
        raise ValueError('At most 16 unique packages in the initial profile.')
    return {'schema': 'brainsnn.simready-plan.v1', 'units': 'm', 'up_axis': 'Y', 'placements': placements,
            'physics_ready': False, 'metric_verified': False, 'observed_geometry_replaced': False}


def audit_layers(path, root, Sdf):
    todo, seen = [path], set()
    while todo:
        current = todo.pop()
        if current in seen:
            continue
        seen.add(current)
        if len(seen) > 256:
            raise ValueError('Too many composed USD layers.')
        layer = Sdf.Layer.FindOrOpen(str(current))
        if layer is None:
            raise ValueError('Cannot open USD layer.')
        for ref in layer.GetExternalReferences():
            if not ref:
                continue
            if ':' in ref or '\\' in ref or Path(ref).is_absolute():
                raise ValueError('Remote or absolute USD dependency rejected.')
            target = (current.parent / ref).resolve()
            if not target.is_relative_to(root.resolve()):
                raise ValueError('USD dependency escapes its package.')
            todo.append(local(root, target.relative_to(root.resolve()).as_posix()))



def audit_asset_dependencies(prim, root):
    """Check authored asset-valued attributes, including active instance-proxy materials.

    This validates referenced file presence and containment, not shader/MDL program semantics.
    All authored time samples are checked. Inactive composition-layer references are checked
    separately; inactive asset-valued attributes are outside this audit.
    """
    from pxr import Sdf, Usd
    count, files = 0, set()
    for child in Usd.PrimRange(prim, Usd.TraverseInstanceProxies()):
        for attr in child.GetAttributes():
            if str(attr.GetTypeName()) not in ('asset', 'asset[]'):
                continue
            times = attr.GetTimeSamples()
            if len(times) > 4096:
                raise ValueError('Too many sampled asset dependencies.')
            for time in [Usd.TimeCode.Default(), *times]:
                values = attr.Get(time)
                values = values if str(attr.GetTypeName()) == 'asset[]' else [values]
                for value in values or []:
                    if value is None or not isinstance(value, Sdf.AssetPath) or not value.path:
                        continue
                    count += 1
                    if count > 100000:
                        raise ValueError('Too many asset-valued dependencies.')
                    if ':' in value.path or '\\' in value.path or Path(value.path).is_absolute():
                        raise ValueError('Remote or absolute asset-valued dependency rejected.')
                    resolved = value.resolvedPath
                    if not resolved or not Path(resolved).resolve().is_relative_to(root.resolve()):
                        raise ValueError('Asset-valued dependency is missing or escapes its package.')
                    target = local(root, Path(resolved).resolve().relative_to(root.resolve()).as_posix())
                    files.add(target.relative_to(root.resolve()).as_posix())
    return {'asset_values_checked': count, 'unique_files': len(files), 'files': sorted(files),
            'shader_programs_executed': False, 'scope': 'active variants; default and authored time samples'}


def compose(data, workspace, out):
    """Optional usd-core path. An additions layer, not a scan or physics certificate."""
    from pxr import Gf, Sdf, Usd, UsdGeom, UsdPhysics
    if out.exists():
        raise ValueError('Output must be a fresh directory.')
    sources = {}
    for item in data['placements']:
        a = item['asset']
        folder = local(workspace, a['directory'], True)
        if out.resolve().is_relative_to(folder.resolve()):
            raise ValueError('Output must be outside every source package.')
        if receipt(folder) != a['receipt']:
            raise ValueError('Asset bytes changed after review.')
        audit_layers(folder / a['root_usd'], folder, Sdf)
        stage = Usd.Stage.Open(str(folder / a['root_usd']))
        if not stage or not stage.GetDefaultPrim() or not stage.HasAuthoredMetadata('metersPerUnit') or not stage.HasAuthoredMetadata('upAxis'):
            raise ValueError('Explicit defaultPrim, units and upAxis are required.')
        axis = str(UsdGeom.GetStageUpAxis(stage))
        if axis not in ('Y', 'Z') or abs(UsdGeom.GetStageMetersPerUnit(stage) - 1.0) > 1e-12:
            raise ValueError('Requires metre-authored Y/Z-up assets; no silent physics-unit conversion.')
        if stage.GetCompositionErrors():
            raise ValueError('Source USD has composition errors.')
        audit_asset_dependencies(stage.GetDefaultPrim(), folder)
        prims = list(Usd.PrimRange(stage.GetDefaultPrim(), Usd.TraverseInstanceProxies()))
        if not any(p.HasAPI(UsdPhysics.CollisionAPI) for p in prims):
            raise ValueError('No authored collider in the referenced asset.')
        if any(UsdGeom.Xformable(p) and UsdGeom.Xformable(p).GetResetXformStack()
               for p in prims):
            raise ValueError('Reset transform stacks would bypass placement and axis conversion.')
        if item['collision_policy'] == 'convexHull' and any(p.IsInstance() for p in prims):
            raise ValueError('Convex hull overrides on instanced assets require separate authoring and review.')
        sources[a['receipt']['sha256']] = (folder, axis)
    out.mkdir(parents=True)
    stage = Usd.Stage.CreateNew(str(out / 'simready-additions.usda'))
    UsdGeom.SetStageMetersPerUnit(stage, 1.0)
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.y)
    world = UsdGeom.Xform.Define(stage, '/SimReadyAdditions')
    stage.SetDefaultPrim(world.GetPrim())
    for digest, (folder, _) in sources.items():
        destination = out / 'assets' / digest
        shutil.copytree(folder, destination)
        if receipt(destination)['sha256'] != digest:
            raise ValueError('Package changed during copy.')
    for item in data['placements']:
        a, path = item['asset'], '/SimReadyAdditions/' + item['id']
        transform = UsdGeom.Xform.Define(stage, path)
        transform.AddTranslateOp().Set(Gf.Vec3d(*item['translation_m']))
        transform.AddRotateXYZOp().Set(Gf.Vec3f(*item['rotation_xyz_deg']))
        basis = UsdGeom.Xform.Define(stage, path + '/Basis')
        digest = a['receipt']['sha256']
        if sources[digest][1] == 'Z':
            basis.AddRotateXOp().Set(-90.0)
        # Separate wrapper avoids overwriting the asset's own transform stack.
        prim = stage.DefinePrim(path + '/Basis/Asset')
        prim.GetReferences().AddReference('assets/' + digest + '/' + a['root_usd'])
        prim.SetCustomDataByKey('brainsnn:provenance', 'library-asset')
        prim.SetCustomDataByKey('brainsnn:sourceURL', a['source']['url'])
        prim.SetCustomDataByKey('brainsnn:license', a['license'])
        prim.SetCustomDataByKey('brainsnn:packageSHA256', a['receipt']['sha256'])
        prim.SetCustomDataByKey('brainsnn:physicsReady', False)
        if item['collision_policy'] == 'convexHull':
            for child in Usd.PrimRange(prim):
                if child.IsA(UsdGeom.Mesh) and child.HasAPI(UsdPhysics.CollisionAPI):
                    UsdPhysics.MeshCollisionAPI.Apply(child).CreateApproximationAttr().Set('convexHull')
    stage.GetRootLayer().Save()
    reopened = Usd.Stage.Open(str(out / 'simready-additions.usda'))
    if not reopened or not reopened.GetDefaultPrim() or reopened.GetCompositionErrors():
        raise ValueError('Serialized USD did not reopen without composition errors.')
    for item in data['placements']:
        prim = reopened.GetPrimAtPath('/SimReadyAdditions/' + item['id'] + '/Basis/Asset')
        audit_asset_dependencies(prim, out / 'assets' / item['asset']['receipt']['sha256'])
    report = {**data, 'usd_reopened': True, 'usd_sha256': file_hash(out / 'simready-additions.usda')}
    (out / 'simready-receipt.json').write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
    return report


def main():
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    p.add_argument('--library', required=True, type=Path)
    p.add_argument('--workspace', required=True, type=Path)
    p.add_argument('--placements', type=Path)
    p.add_argument('--out', required=True, type=Path)
    p.add_argument('--compose', action='store_true')
    a = p.parse_args()
    records = inspect(read_json(a.library), a.workspace.resolve())
    data = plan(records, read_json(a.placements)) if a.placements else {'schema': 'brainsnn.simready-library.v1', 'assets': records}
    if a.compose:
        if not a.placements:
            p.error('--compose requires --placements')
        compose(data, a.workspace.resolve(), a.out)
    else:
        with a.out.open('x', encoding='utf-8') as f:
            json.dump(data, f, indent=2, allow_nan=False)
    print(json.dumps({'output': str(a.out), 'assets': len(records), 'physics_ready': False}))


if __name__ == '__main__':
    main()
