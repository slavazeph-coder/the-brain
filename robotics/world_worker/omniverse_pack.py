"""Source-bound Omniverse packages for completed BrainSNN metric scene jobs.

No arbitrary USD uploads, remote downloads, guessed mass, scene replacement or
physics-readiness claim. Installed NVIDIA assets remain separate library additions.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import re
import shutil
import tempfile
import zipfile
try:
    from . import simready_bridge as bridge
    from .geometry import load_arena_cloud
    from .nvidia_pack import REPO, REVISION, ASSETS, safe_relative
except ImportError:
    import simready_bridge as bridge
    from geometry import load_arena_cloud
    from nvidia_pack import REPO, REVISION, ASSETS, safe_relative
HASH = re.compile(r'[0-9a-f]{64}')
MAX_TOTAL = 1536 * 1024**2


def json_write(path, data):
    path.write_text(json.dumps(data, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def traversed(stage):
    from pxr import Usd
    return Usd.PrimRange(stage.GetPseudoRoot(), Usd.TraverseInstanceProxies())


def asset_paths(value):
    from pxr import Sdf
    if isinstance(value, Sdf.AssetPath):
        if value.path:
            yield value.path
    elif isinstance(value, dict):
        for v in value.values():
            yield from asset_paths(v)
    elif not isinstance(value, (str, bytes)) and hasattr(value, '__iter__'):
        for v in value:
            yield from asset_paths(v)


def audit_dependencies(path, root):
    """Check composition AND asset-valued texture/MDL paths before stage loading."""
    from pxr import Sdf
    root = root.resolve(); todo, seen = [path.resolve()], set()
    while todo:
        current = todo.pop()
        if current in seen:
            continue
        if len(seen) >= 256:
            raise ValueError('USD layer budget exceeded.')
        seen.add(current)
        layer = Sdf.Layer.FindOrOpen(str(current))
        if layer is None:
            raise ValueError('Cannot parse USD layer.')
        refs = set(layer.GetExternalReferences())
        def visit(p):
            spec = layer.GetObjectAtPath(p)
            # Relationship targets and connections may have a traversed path,
            # but no spec or metadata of their own. Their parent is inspected.
            if spec is None:
                return
            for key in spec.ListInfoKeys():
                if key == 'subLayerOffsets':
                    continue
                refs.update(asset_paths(spec.GetInfo(key)))
        layer.Traverse('/', visit)
        for ref in refs:
            if not ref:
                continue
            if ':' in ref or '\\' in ref or Path(ref).is_absolute() or any(ord(c) < 32 for c in ref):
                raise ValueError('Nonportable or remote USD asset dependency.')
            target = (current.parent / ref).resolve()
            if not target.is_relative_to(root):
                raise ValueError('USD asset dependency leaves package.')
            target = bridge.local(root, target.relative_to(root).as_posix())
            if target.suffix.lower() in ('.usd', '.usda', '.usdc'):
                todo.append(target)
    return len(seen)


def failures(value):
    """Keep every upstream failing feature, not only the latest package envelope."""
    found = []
    if isinstance(value, dict):
        for key, child in value.items():
            if isinstance(child, dict) and child.get('passed') is False:
                found.append(str(key))
            found += failures(child)
    elif isinstance(value, list):
        for child in value:
            found += failures(child)
    return sorted(set(found))


def installed_assets(workspace, *, verify=True):
    from pxr import Usd, UsdGeom, UsdPhysics
    workspace = workspace.resolve(); result = []
    if not workspace.is_dir():
        return result
    for asset in ASSETS:
        receipt_path = workspace / (asset + '.receipt.json')
        if not receipt_path.is_file():
            continue
        data = bridge.read_json(receipt_path)
        expected_url = f'https://huggingface.co/datasets/{REPO}/resolve/{REVISION}/{asset}/com.nvidia.simready.packaging.json'
        if data.get('repo') != REPO or data.get('revision') != REVISION or data.get('asset') != asset or data.get('source_url') != expected_url:
            raise ValueError('Installed NVIDIA receipt is not pinned to the reviewed source.')
        folder = bridge.local(workspace, asset, True)
        manifest = bridge.read_json(folder / 'com.nvidia.simready.packaging.json')
        if manifest.get('license') != 'CC-BY-4.0' or manifest.get('package_id') != data.get('package_id'):
            raise ValueError('Installed NVIDIA package identity or license mismatch.')
        rows = data.get('files')
        if not isinstance(rows, list) or not 1 <= len(rows) <= 2000 or any(not isinstance(r, dict) or type(r.get('size')) is not int or r['size'] < 0 for r in rows) or sum(r['size'] for r in rows) > MAX_TOTAL:
            raise ValueError('Invalid NVIDIA file inventory.')
        seen = set()
        for row in rows:
            path = safe_relative(row['path'])
            if not path.startswith(asset + '/') or path in seen or not isinstance(row.get('sha256'), str) or not HASH.fullmatch(row['sha256']):
                raise ValueError('Invalid NVIDIA file receipt.')
            seen.add(path); p = bridge.local(workspace, path)
            if p.stat().st_size != row['size'] or (verify and bridge.file_hash(p) != row['sha256']):
                raise ValueError('Installed NVIDIA asset bytes changed.')
        actual = {p.relative_to(workspace).as_posix() for p in folder.rglob('*') if p.is_file()}
        if seen != actual:
            raise ValueError('Unlisted or missing NVIDIA package files.')
        root = bridge.local(folder, data.get('root_usd')); audit_dependencies(root, folder)
        stage = Usd.Stage.Open(str(root))
        if not stage or stage.GetCompositionErrors() or not stage.GetDefaultPrim() or not stage.HasAuthoredMetadata('metersPerUnit') or not stage.HasAuthoredMetadata('upAxis'):
            raise ValueError('NVIDIA stage lacks an explicit root, units or up axis.')
        axis, units = str(UsdGeom.GetStageUpAxis(stage)), UsdGeom.GetStageMetersPerUnit(stage)
        if units != 1.0 or axis not in ('Y', 'Z'):
            raise ValueError('Only metre-authored Y/Z-up physical assets are admitted.')
        if any(UsdGeom.Xformable(p) and UsdGeom.Xformable(p).GetResetXformStack() for p in traversed(stage)):
            raise ValueError('Asset reset transform stacks would bypass reviewed placement.')
        metadata = stage.GetRootLayer().customLayerData.get('SimReady_Metadata', {})
        colliders = sum(p.HasAPI(UsdPhysics.CollisionAPI) for p in traversed(stage))
        result.append({'asset':asset, 'source_url':expected_url, 'revision':REVISION,
                       'license':manifest['license'], 'author':'NVIDIA', 'package_id':data['package_id'],
                       'package_sha256':bridge.receipt(folder)['sha256'], 'bytes':sum(r['size'] for r in rows),
                       'root_usd':data['root_usd'], 'up_axis':axis, 'meters_per_unit':units,
                       'authored_colliders':colliders, 'available':colliders > 0,
                       'upstream_failed_features':failures(metadata), 'physics_tested':False,
                       'status':'unqualified-library-asset'})
    return result


def validate_request(value, catalog):
    if not isinstance(value, dict) or value.get('schema') != 'brainsnn.omniverse-request.v1':
        raise ValueError('Unknown Omniverse request schema.')
    if value.get('reviewed') is not True or not all(isinstance(value.get(k), str) and HASH.fullmatch(value[k]) for k in ('scene_sha256', 'cloud_sha256')):
        raise ValueError('Review and exact source scene/cloud hashes are required.')
    placements = value.get('placements', [])
    if not isinstance(placements, list) or len(placements) > 64:
        raise ValueError('At most 64 library placements per package.')
    by_id, ids, chosen, used = {a['asset']:a for a in catalog}, set(), [], set()
    for row in placements:
        if not isinstance(row, dict) or not isinstance(row.get('id'),str) or not bridge.IDENT.fullmatch(row['id']) or row['id'] in ids:
            raise ValueError('Unique USD-safe placement IDs required.')
        ids.add(row['id']); a = by_id.get(row.get('asset'))
        if not a or not a.get('available') or row.get('package_sha256') != a['package_sha256']:
            raise ValueError('Library asset is missing, unsupported or changed since review.')
        if row.get('license_reviewed') is not True or row.get('unqualified_physics_reviewed') is not True:
            raise ValueError('License and unqualified-physics review are required for each asset.')
        if row.get('scale', 1) != 1 or type(row.get('scale',1)) not in (int,float) or row.get('collision_policy','authored') != 'authored':
            raise ValueError('Hosted packs preserve asset size and authored collision geometry.')
        chosen.append({'id':row['id'], 'asset':a, 'translation_m':bridge.vector(row.get('translation_m'),10000),
                       'rotation_xyz_deg':bridge.vector(row.get('rotation_xyz_deg',[0,0,0]),360)})
        used.add(a['asset'])
    if len(used) > 16 or sum(by_id[a]['bytes'] for a in used) > MAX_TOTAL:
        raise ValueError('Unique asset package budget exceeded.')
    return chosen


def package_scene(source, output, request, workspace):
    """Compose a separate stage; original scene files are copied byte-for-byte."""
    from pxr import Gf, Sdf, Usd, UsdGeom, UsdPhysics
    source, output, workspace = source.resolve(), output.resolve(), workspace.resolve()
    if output.is_relative_to(source) or output.is_relative_to(workspace):
        raise ValueError('Package output must be outside its source and library roots.')
    scene_path, cloud_path = (bridge.local(source, name) for name in ('scene.json', 'arena-cloud.json'))
    scene, cloud = bridge.read_json(scene_path), load_arena_cloud(cloud_path)
    if scene.get('schema') != 'brainsnn.scene.v1' or scene.get('units') != 'm' or cloud['units'] != 'm':
        raise ValueError('An existing metric BrainSNN scene is required; no invented metre scale.')
    if bridge.file_hash(scene_path) != request.get('scene_sha256') or bridge.file_hash(cloud_path) != request.get('cloud_sha256'):
        raise ValueError('Scene or cloud changed since package review.')
    # A captured-scene-only export must not depend on the optional asset cache.
    # Nonempty placements still undergo the complete inventory/hash/USD audit.
    catalog = installed_assets(workspace) if request.get('placements') else []
    placements = validate_request(request, catalog)
    usd = bridge.local(source, 'scene.usda'); audit_dependencies(usd, source)
    existing = Usd.Stage.Open(str(usd))
    if not existing or existing.GetCompositionErrors() or not existing.GetDefaultPrim() or not existing.HasAuthoredMetadata('metersPerUnit') or not existing.HasAuthoredMetadata('upAxis') or UsdGeom.GetStageMetersPerUnit(existing) != 1 or UsdGeom.GetStageUpAxis(existing) != UsdGeom.Tokens.y:
        raise ValueError('Expected a metre-authored Y-up source USD.')
    if output.exists():
        raise ValueError('Package output must be a new directory.')
    output.mkdir(parents=True)
    source_manifest = bridge.read_json(source / 'manifest.json'); entries = source_manifest.get('artifacts', [])
    copied, total = [], 0
    for entry in entries:
        name = entry.get('name','')
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,100}',name) or name.endswith('.zip'):
            continue
        p = bridge.local(source, name); total += p.stat().st_size
        if total > 256 * 1024**2:
            raise ValueError('Source export budget exceeded.')
        destination = output / 'source' / name; destination.parent.mkdir(exist_ok=True)
        shutil.copyfile(p,destination); copied.append(name)
    if not {'scene.usda','scene.json','arena-cloud.json'} <= set(copied):
        raise ValueError('Source manifest does not bind the scene, USD and cloud.')
    for name,expected in (('scene.json',request['scene_sha256']),('arena-cloud.json',request['cloud_sha256'])):
        if bridge.file_hash(output/'source'/name)!=expected:
            raise ValueError('Source scene or cloud changed during packaging.')
    copied_assets = set()
    for item in placements:
        a = item['asset']
        if a['asset'] in copied_assets:
            continue
        src = bridge.local(workspace, a['asset'], True); dst = output / 'assets' / a['asset']; shutil.copytree(src,dst)
        if bridge.receipt(dst)['sha256'] != a['package_sha256']:
            raise ValueError('Library asset changed during packaging.')
        copied_assets.add(a['asset'])
    stage = Usd.Stage.CreateNew(str(output / 'world.usda'))
    UsdGeom.SetStageMetersPerUnit(stage,1); UsdGeom.SetStageUpAxis(stage,UsdGeom.Tokens.y)
    world = UsdGeom.Xform.Define(stage,'/World'); stage.SetDefaultPrim(world.GetPrim())
    world.GetPrim().SetCustomDataByKey('brainsnn:metricVerified',False)
    world.GetPrim().SetCustomDataByKey('brainsnn:physicsReady',False)
    env = stage.DefinePrim('/World/CapturedEnvironment'); env.GetReferences().AddReference('source/scene.usda')
    env.SetCustomDataByKey('brainsnn:provenance','reconstructed-not-surveyed')
    environment_colliders = 0
    for p in Usd.PrimRange(env):
        if p.IsA(UsdGeom.Cube):
            UsdPhysics.CollisionAPI.Apply(p); environment_colliders += 1
            p.SetCustomDataByKey('brainsnn:collisionBasis','compiled-proxy-not-physically-validated')
    physics = UsdPhysics.Scene.Define(stage,'/World/Physics')
    physics.CreateGravityDirectionAttr().Set(Gf.Vec3f(0,-1,0)); physics.CreateGravityMagnitudeAttr().Set(9.81)
    physics.GetPrim().SetCustomDataByKey('brainsnn:gravityBasis','simulation-assumption')
    physics.GetPrim().CreateAttribute('physxScene:enableGPUDynamics',Sdf.ValueTypeNames.Bool).Set(False)
    labels = []
    for item in placements:
        a = item['asset']; path = '/World/LibraryAdditions/' + item['id']
        x = UsdGeom.Xform.Define(stage,path)
        x.AddTranslateOp().Set(Gf.Vec3d(*item['translation_m'])); x.AddRotateXYZOp().Set(Gf.Vec3f(*item['rotation_xyz_deg']))
        basis = UsdGeom.Xform.Define(stage,path+'/Basis')
        if a['up_axis'] == 'Z':
            basis.AddRotateXOp().Set(-90)
        p = stage.DefinePrim(path+'/Basis/Asset'); p.GetReferences().AddReference('assets/'+a['asset']+'/'+a['root_usd'])
        p.SetCustomDataByKey('brainsnn:provenance','library-asset'); p.SetCustomDataByKey('brainsnn:sourceURL',a['source_url'])
        p.SetCustomDataByKey('brainsnn:packageSha256',a['package_sha256']); p.SetCustomDataByKey('brainsnn:physicsReady',False)
        labels.append({'prim':path, 'label':a['asset'], 'instance':item['id'], 'provenance':'library-asset'})
    stage.GetRootLayer().Save(); audit_dependencies(output/'world.usda',output)
    reopened = Usd.Stage.Open(str(output/'world.usda'))
    if not reopened or reopened.GetCompositionErrors() or not reopened.GetDefaultPrim():
        raise ValueError('Pack did not reopen.')
    for item in placements:
        p = reopened.GetPrimAtPath('/World/LibraryAdditions/'+item['id']+'/Basis/Asset')
        if not p or not p.GetChildren() or not any(c.HasAPI(UsdPhysics.CollisionAPI) for c in Usd.PrimRange(p, Usd.TraverseInstanceProxies())):
            raise ValueError('Referenced library asset did not compose with its collider shapes.')
    proof = {'schema':'brainsnn.omniverse-pack.v1', 'source_scene_sha256':request['scene_sha256'],
             'source_cloud_sha256':request['cloud_sha256'], 'units':'m','up_axis':'Y',
             'usd_reopened':True, 'source_exports_unchanged':True, 'environment_collision_proxies':environment_colliders,
             'library_placements':placements, 'physics_device_requested':'cpu', 'physics_executed':False,
             'metric_verified':False, 'physics_ready':False, 'policy_executed':False,
             'warnings':['Scene scale is the source user-entered scale, not a survey.',
                         'Collision proxies and gravity are simulation assumptions.',
                         'Library assets are not observations of the captured space.',
                         'Read upstream_failed_features on every included library asset.',
                         'USD load checks do not test PhysX, rendering, materials or robot behavior.']}
    json_write(output/'pack-receipt.json',proof); json_write(output/'semantic-labels.json',labels)
    (output/'ATTRIBUTION.txt').write_text('\n'.join(f"{a['asset']} — NVIDIA — {a['license']}\n{a['source_url']}\nOriginal files retained; placement and Z-to-Y wrapper authored by BrainSNN.\n" for a in catalog if a['asset'] in copied_assets),encoding='utf-8')
    (output/'README.txt').write_text('BrainSNN Omniverse package\n\nOpen world.usda in Isaac Sim or an Omniverse USD application.\nOriginal BIM/CAD/GLB exports are under source/. Library additions do not silently change those exports.\nRun verify_pack.py before opening. Use an isolated Isaac Sim installation and run\nisaac_smoke.py with that installation\'s python.sh for a bounded CPU-physics test.\nThe package requests CPU physics; rendering still requires an Isaac Sim-supported GPU.\nNo physical accuracy, dynamics, materials or robot-policy qualification is claimed.\n',encoding='utf-8')
    templates = Path(__file__).parent / 'omniverse_templates'
    for name in ('verify_pack.py','isaac_smoke.py'):
        shutil.copyfile(templates/name,output/name)
    all_files = sorted(p for p in output.rglob('*') if p.is_file())
    if sum(p.stat().st_size for p in all_files) > MAX_TOTAL + 256*1024**2:
        raise ValueError('Assembled package budget exceeded.')
    manifest = {'schema':'brainsnn.portable-files.v1', 'files':[{'path':p.relative_to(output).as_posix(),'size':p.stat().st_size,'sha256':bridge.file_hash(p)} for p in all_files]}
    json_write(output/'pack-files.json',manifest)
    return proof


def run(request, workspace):
    if request.get('schema') != 'brainsnn.adapter.v1' or len(request.get('inputs',[])) != 1 or request['inputs'][0].get('kind') != 'cloud':
        raise ValueError('Omniverse packaging takes one source-bound cloud request.')
    source = request.get('source') or {}
    if source.get('engine') != 'scene-usd' or source.get('missing') or not source.get('path'):
        raise ValueError('Select a completed scene-usd job from this same owner.')
    path = Path(request['inputs'][0]['path']); raw = bridge.read_json(path); cloud = load_arena_cloud(path)
    source_dir = Path(source['path'])/'output'
    if cloud != load_arena_cloud(bridge.local(source_dir,'arena-cloud.json')):
        raise ValueError('Submitted cloud differs from the selected scene source.')
    options = raw.get('omniversePack')
    if not isinstance(options,dict):
        raise ValueError('Explicit source-bound Omniverse package review is required.')
    out = Path(request['output_dir']).resolve()
    if out.is_relative_to(source_dir.resolve()) or out.is_relative_to(workspace.resolve()):
        raise ValueError('Package output must be outside its source and library roots.')
    out.mkdir(parents=True,exist_ok=True)
    for name in ('scene-omniverse.zip','omniverse-receipt.json','manifest.json'):
        if (out/name).exists():
            raise ValueError('Refusing to overwrite an earlier package result.')
    with tempfile.TemporaryDirectory(prefix='omniverse-',dir=out.parent) as tmp:
        pack = Path(tmp)/'package'; proof = package_scene(source_dir,pack,options,workspace)
        with zipfile.ZipFile(out/'scene-omniverse.zip','x',compression=zipfile.ZIP_DEFLATED,compresslevel=1) as z:
            for p in sorted(pack.rglob('*')):
                if p.is_file():
                    z.write(p,p.relative_to(pack).as_posix())
        proof['archive_sha256'] = bridge.file_hash(out/'scene-omniverse.zip')
    json_write(out/'omniverse-receipt.json',proof)
    json_write(out/'manifest.json',{'artifacts':[{'name':'scene-omniverse.zip','kind':'omniverse-package'}, {'name':'omniverse-receipt.json','kind':'evidence'}]})
    return proof


def main():
    p=argparse.ArgumentParser(description=__doc__.split('\n')[0]); p.add_argument('--input-manifest',type=Path,required=True)
    p.add_argument('--workspace',type=Path,default=Path('/opt/brainsnn-simready')); a=p.parse_args()
    proof=run(bridge.read_json(a.input_manifest),a.workspace)
    print(json.dumps({'package_written':True,'placements':len(proof['library_placements']),'physics_ready':False}))


if __name__=='__main__':
    main()
