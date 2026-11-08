"""Reproducible real NVIDIA package composition qualification, without a physics claim.

Rechecks every cached byte against the pinned upstream tree, runs the production
bridge, relocates its portable output, and compares instance-proxy colliders,
rigid bodies, joints, dependencies and placement transforms after reopening.
No vendor code, renderer or simulator is executed.
"""
from __future__ import annotations
import argparse
import json
import math
from pathlib import Path
import resource
import sys
import time

from . import nvidia_pack, simready_bridge as bridge


def reported_profile(folder: Path, root_usd: str) -> dict:
    path = folder / '.metadata/com.nvidia.simready.conformance.Package-Candidate@1.0.0.json'
    profile = bridge.read_json(path)
    if profile.get('profile') != 'Package-Candidate' or profile.get('profile_version') != '1.0.0':
        raise ValueError('Expected the pinned Package-Candidate profile.')
    entries = [row for row in profile.get('assets', []) if row.get('asset') == root_usd]
    if len(entries) != 1:
        raise ValueError('Upstream profile does not cover this root USD.')
    features = [item for group in entries[0].get('features', []) for item in group.items()]
    failed = [name for name, result in features if result.get('passed') is not True or result.get('failing_requirements')]
    if not features or failed:
        raise ValueError('Upstream Package-Candidate profile is absent or failing.')
    return {'profile': 'Package-Candidate@1.0.0', 'passed': True, 'failed_features': [],
            'reported_features': [name for name, _ in features], 'report_sha256': bridge.file_hash(path),
            'reexecuted': False, 'scope': 'upstream package conformance, not physical simulation'}


def inventory(prim, package_root: Path) -> dict:
    from pxr import Usd, UsdGeom, UsdPhysics
    dependencies = bridge.audit_asset_dependencies(prim, package_root)
    colliders, bodies, joints = {}, {}, {}
    variants = {name: prim.GetVariantSet(name).GetVariantSelection() for name in prim.GetVariantSets().GetNames()}
    prims = list(Usd.PrimRange(prim, Usd.TraverseInstanceProxies()))
    for child in prims:
        key = str(child.GetPath().MakeRelativePath(prim.GetPath()))
        if child.HasAPI(UsdPhysics.CollisionAPI):
            collision = UsdPhysics.CollisionAPI(child)
            colliders[key] = {'type': child.GetTypeName(), 'enabled': collision.GetCollisionEnabledAttr().Get(),
                              'instance_proxy': child.IsInstanceProxy(),
                              'approximation': UsdPhysics.MeshCollisionAPI(child).GetApproximationAttr().Get()}
        if child.HasAPI(UsdPhysics.RigidBodyAPI):
            body = UsdPhysics.RigidBodyAPI(child)
            bodies[key] = {'enabled': body.GetRigidBodyEnabledAttr().Get(), 'kinematic': body.GetKinematicEnabledAttr().Get()}
        if child.IsA(UsdPhysics.Joint):
            joint = UsdPhysics.Joint(child)
            targets = [*joint.GetBody0Rel().GetTargets(), *joint.GetBody1Rel().GetTargets()]
            if any(not p.HasPrefix(prim.GetPath()) for p in targets):
                raise ValueError('Physics joint targets a body outside its placed asset.')
            joints[key] = {'type': child.GetTypeName(), 'targets': [str(p.MakeRelativePath(prim.GetPath())) for p in targets]}
    bounds = UsdGeom.BBoxCache(Usd.TimeCode.Default(), ['default', 'render', 'proxy']).ComputeWorldBound(prim).ComputeAlignedRange()
    extent = [float(v) for v in bounds.GetSize()]
    if not all(math.isfinite(v) and v > 0 for v in extent):
        raise ValueError('Placed NVIDIA asset has empty or nonfinite bounds.')
    return {'prims_including_proxies': len(prims), 'colliders': colliders, 'rigid_bodies': bodies, 'joints': joints,
            'variants': variants, 'world_extent_m': extent, 'dependencies': dependencies}


def compare_placement(source, placed, basis, source_inventory, placed_inventory, *, request):
    """Check reference composition retains authored physics and the requested outer transform."""
    from pxr import Gf, Usd, UsdGeom
    import numpy as np
    source_stage, placed_stage = source.GetStage(), placed.GetStage()
    source_up = str(UsdGeom.GetStageUpAxis(source_stage))
    if source_up not in ('Y', 'Z') or not math.isclose(UsdGeom.GetStageMetersPerUnit(source_stage), 1, rel_tol=0, abs_tol=1e-12):
        raise ValueError('Source units/basis no longer match the reviewed metre profile.')
    if not all(placed_stage.HasAuthoredMetadata(key) for key in ('metersPerUnit', 'upAxis')) or \
            not math.isclose(UsdGeom.GetStageMetersPerUnit(placed_stage), 1, rel_tol=0, abs_tol=1e-12) or str(UsdGeom.GetStageUpAxis(placed_stage)) != 'Y':
        raise ValueError('Placed stage units/basis must remain explicitly metre Y-up.')
    # Construct the expected matrices from the request and source metadata, never from the output.
    # Gf uses row vectors: rotate X, Y, Z, then translate; source Z-up needs a preceding -90 X rotation.
    translation = bridge.vector(request['translation_m'], 10000)
    rotation = bridge.vector(request.get('rotation_xyz_deg', [0, 0, 0]), 360)
    expected_placement = Gf.Matrix4d(1)
    for axis, angle in zip(((1, 0, 0), (0, 1, 0), (0, 0, 1)), rotation):
        expected_placement *= Gf.Matrix4d().SetRotate(Gf.Rotation(Gf.Vec3d(*axis), angle))
    expected_placement *= Gf.Matrix4d().SetTranslate(Gf.Vec3d(*translation))
    expected_basis = Gf.Matrix4d().SetRotate(Gf.Rotation(Gf.Vec3d(1, 0, 0), -90 if source_up == 'Z' else 0))
    actual_placement = UsdGeom.Xformable(basis.GetParent()).ComputeLocalToWorldTransform(Usd.TimeCode.Default())
    actual_basis = UsdGeom.Xformable(basis).GetLocalTransformation()
    placement_error = float(np.max(np.abs(np.array(actual_placement) - np.array(expected_placement))))
    basis_error = float(np.max(np.abs(np.array(actual_basis) - np.array(expected_basis))))
    if not all(math.isfinite(v) and v <= 1e-6 for v in (placement_error, basis_error)):
        raise ValueError('Serialized placement/basis differs from the requested transform.')
    outer = expected_basis * expected_placement
    for key in ('colliders', 'rigid_bodies', 'joints', 'variants'):
        if source_inventory[key] != placed_inventory[key]:
            raise ValueError('Placed asset changed its authored ' + key + '.')
    worst = 0.0
    for relative in source_inventory['colliders']:
        a = source.GetStage().GetPrimAtPath(source.GetPath().AppendPath(relative))
        b = placed.GetStage().GetPrimAtPath(placed.GetPath().AppendPath(relative))
        expected = UsdGeom.Xformable(a).ComputeLocalToWorldTransform(Usd.TimeCode.Default()) * outer
        actual = UsdGeom.Xformable(b).ComputeLocalToWorldTransform(Usd.TimeCode.Default())
        error = float(np.max(np.abs(np.array(actual) - np.array(expected))))
        worst = max(worst, error)
        if not math.isfinite(error) or error > 1e-6:
            raise ValueError('Placed collider did not inherit the requested transform.')
    return {'request_placement_checked': True, 'placement_matrix_abs_error': placement_error,
            'basis_matrix_abs_error': basis_error, 'collider_transforms_checked': len(source_inventory['colliders']),
            'max_matrix_abs_error': worst,
            'tolerance': 1e-6, 'basis': 'serialization/composition arithmetic; not physical accuracy'}


def qualify(workspace: Path, out: Path, *, asset='IV_pole_a01', license_reviewed=False, placement_reviewed=False):
    from pxr import Sdf, Usd
    if license_reviewed is not True or placement_reviewed is not True:
        raise ValueError('Review the NVIDIA license and these two isolated test placements explicitly.')
    if out.exists():
        raise ValueError('Qualification output must be a fresh directory.')
    if asset != 'IV_pole_a01':
        raise ValueError('This reviewed qualification profile covers only IV_pole_a01.')
    # Reject before source verification or writing receipts: qualification output must never
    # contaminate the exact package bytes subsequently checked by the bridge.
    folder = bridge.local(workspace, asset, directory=True)
    if out.resolve().is_relative_to(folder.resolve()):
        raise ValueError('Qualification output must be outside the source package.')
    started = time.monotonic()
    verified = nvidia_pack.verify_download(asset, workspace)
    validation = reported_profile(folder, verified['root_usd'])
    library = {'assets': [{'asset_name': asset, 'source_url': verified['source_url'], 'license': verified['license'],
                          'package': {'repo_id': verified['repo'], 'commit': verified['revision'], 'package_id': verified['package_id']},
                          'files': {'directory': asset, 'root_usd': asset + '/' + verified['root_usd']}, 'validation': validation}]}
    records = bridge.inspect(library, workspace)
    digest = records[0]['receipt']['sha256']
    request = {'schema': 'brainsnn.simready-placements.v1', 'placements': [
        {'id': name, 'source_url': verified['source_url'], 'translation_m': translation, 'rotation_xyz_deg': rotation,
         'approval': {'license_reviewed': True, 'placement_reviewed': True, 'license': verified['license'], 'package_sha256': digest}}
        for name, translation, rotation in [('iv_pole_1', [1, 0, 2], [0, 0, 0]), ('iv_pole_2', [-2, .25, -1], [0, 35, 0])]]}
    plan = bridge.plan(records, request)
    out.mkdir(parents=True)
    for name, value in [('source-verification.json', verified), ('library.json', library), ('placements.json', request)]:
        (out / name).write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')
    bridge.compose(plan, workspace, out / 'assembly')
    (out / 'assembly').rename(out / 'portable-assembly')
    portable = out / 'portable-assembly'
    (portable / 'ATTRIBUTION.md').write_text(
        f'# NVIDIA SimReady asset attribution\n\nIV_pole_a01 by NVIDIA, licensed CC-BY-4.0.\n\n'
        f'Source: {verified["source_url"]}\n\nLicense: https://creativecommons.org/licenses/by/4.0/\n'
        f'Original license text: assets/{digest}/.metadata/LICENSE.txt\n\n'
        'Package bytes are unchanged. BrainSNN adds two test placement transforms and converts the outer basis from Z-up to Y-up. '
        'No NVIDIA endorsement or physical-simulation qualification is implied.\n')
    source_stage = Usd.Stage.Open(str(folder / verified['root_usd']))
    source = source_stage.GetDefaultPrim()
    source_inventory = inventory(source, folder)
    if not source_inventory['colliders'] or not all(c['enabled'] is True for c in source_inventory['colliders'].values()):
        raise ValueError('Expected enabled authored colliders in the reviewed asset.')
    placed_stage = Usd.Stage.Open(str(portable / 'simready-additions.usda'))
    if not placed_stage or placed_stage.GetCompositionErrors():
        raise ValueError('Relocated additions did not reopen cleanly.')
    for layer in placed_stage.GetUsedLayers():
        if not layer.anonymous and not Path(layer.realPath).resolve().is_relative_to(portable.resolve()):
            raise ValueError('Relocated USD still depends on files outside the portable assembly.')
    placements = []
    for item in request['placements']:
        base = '/SimReadyAdditions/' + item['id'] + '/Basis'
        placed = placed_stage.GetPrimAtPath(base + '/Asset')
        current = inventory(placed, portable / 'assets' / digest)
        transform_check = compare_placement(source, placed, placed_stage.GetPrimAtPath(base), source_inventory, current, request=item)
        placements.append({'id': item['id'], 'translation_m': item['translation_m'], 'rotation_xyz_deg': item['rotation_xyz_deg'],
                           'inventory': current, 'transform_check': transform_check})
    # A readable root-layer snapshot is evidence only; the full portable assembly carries its dependencies.
    Sdf.Layer.FindOrOpen(str(folder / verified['root_usd'])).Export(str(out / 'vendor-root.usda'))
    result = {'schema': 'brainsnn.simready-qualification.v1', 'asset': asset, 'revision': verified['revision'],
              'package_receipt': records[0]['receipt'], 'source_tree_rechecked': True, 'reported_validation': validation,
              'source_inventory': source_inventory, 'placements': placements, 'portable_reopened': True,
              'package_copies': len(list((portable / 'assets').iterdir())), 'usd_version': '.'.join(map(str, Usd.GetVersion())),
              'elapsed_seconds': time.monotonic() - started,
              'process_peak_rss_mib': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024**2 if sys.platform == 'darwin' else 1024),
              'memory_scope': 'this CPU qualification process high-water mark; not GPU or Isaac memory',
              'physics_ready': False, 'physics_tested': False, 'metric_verified': False,
              'limitations': ['No Isaac Sim, PhysX execution, contact/dynamics/stress test or robot task was run.',
                              'Dependencies and active variants were inspected; shader/MDL code was not executed.',
                              'Packaging conformance is upstream-reported, not independently rerun.',
                              'This library geometry is not captured or surveyed scene evidence.']}
    (out / 'qualification.json').write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--workspace', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--license-reviewed', action='store_true')
    parser.add_argument('--placement-reviewed', action='store_true')
    args = parser.parse_args()
    result = qualify(args.workspace.resolve(), args.out.resolve(), license_reviewed=args.license_reviewed, placement_reviewed=args.placement_reviewed)
    print(json.dumps({'asset': result['asset'], 'portable_reopened': result['portable_reopened'],
                      'source_colliders': len(result['source_inventory']['colliders']),
                      'placed_colliders': sum(len(p['inventory']['colliders']) for p in result['placements']),
                      'elapsed_seconds': result['elapsed_seconds'], 'process_peak_rss_mib': result['process_peak_rss_mib'],
                      'physics_tested': False}))


if __name__ == '__main__':
    main()
