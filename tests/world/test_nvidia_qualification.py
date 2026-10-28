"""Offline regressions for pinned-byte verification and actual portable USD composition."""
import hashlib
import json
from pathlib import Path

import pytest

from robotics.world_worker import nvidia_pack as pack, qualify_simready as qualification


def package_fixture(tmp_path, monkeypatch):
    pytest.importorskip('pxr')
    from pxr import Gf, Sdf, Usd, UsdGeom, UsdPhysics
    folder = tmp_path / 'IV_pole_a01'
    (folder / '.metadata').mkdir(parents=True)
    (folder / 'simready_usd').mkdir()
    stage = Usd.Stage.CreateNew(str(folder / 'simready_usd/root.usda'))
    UsdGeom.SetStageMetersPerUnit(stage, 1)
    UsdGeom.SetStageUpAxis(stage, 'Z')
    root = UsdGeom.Xform.Define(stage, '/Root')
    root.AddTranslateOp().Set(Gf.Vec3d(.1, .2, .3))
    stage.SetDefaultPrim(root.GetPrim())
    cube = UsdGeom.Cube.Define(stage, '/Root/Body')
    cube.AddTranslateOp().Set(Gf.Vec3d(.2, .3, .4))
    UsdPhysics.CollisionAPI.Apply(cube.GetPrim())
    UsdPhysics.RigidBodyAPI.Apply(cube.GetPrim())
    cube.GetPrim().CreateAttribute('texture', Sdf.ValueTypeNames.Asset).Set(Sdf.AssetPath('../texture.bin'))
    stage.GetRootLayer().Save()
    (folder / 'texture.bin').write_bytes(b'offline texture fixture')
    (folder / '.metadata/LICENSE.txt').write_text('Offline fixture; no NVIDIA payload.')
    manifest = {'license': 'CC-BY-4.0', 'package_id': 'simready.hf.nvidia.simready-assets.IV_pole_a01.fixture'}
    (folder / 'com.nvidia.simready.packaging.json').write_text(json.dumps(manifest))
    profile = {'profile': 'Package-Candidate', 'profile_version': '1.0.0', 'assets': [
        {'asset': 'simready_usd/root.usda', 'features': [{'TEST_FEATURE': {'passed': True, 'failing_requirements': []}}]}]}
    (folder / '.metadata/com.nvidia.simready.conformance.Package-Candidate@1.0.0.json').write_text(json.dumps(profile))
    rows = []
    for path in folder.rglob('*'):
        if path.is_file():
            data = path.read_bytes()
            rows.append({'type': 'file', 'path': path.relative_to(tmp_path).as_posix(), 'size': len(data),
                         'oid': hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest()})
    # Deliberately include an LFS file too, so both upstream hash algorithms are exercised.
    texture = next(row for row in rows if row['path'].endswith('/texture.bin'))
    texture['lfs'] = {'oid': hashlib.sha256((folder / 'texture.bin').read_bytes()).hexdigest()}
    monkeypatch.setattr(pack, 'listing', lambda asset, opener: rows)
    return folder


def test_cache_reverified_against_source_tree_not_local_receipt(tmp_path, monkeypatch):
    folder = package_fixture(tmp_path, monkeypatch)
    result = pack.verify_download('IV_pole_a01', tmp_path)
    assert result['source_tree_rechecked'] and len(result['files']) == 5
    data = bytearray((folder / 'texture.bin').read_bytes()); data[-1] ^= 1
    (folder / 'texture.bin').write_bytes(data)
    (tmp_path / 'IV_pole_a01.receipt.json').write_text(json.dumps({'files': [{'sha256': hashlib.sha256(data).hexdigest()}]}))
    with pytest.raises(ValueError, match='hash differs'):
        pack.verify_download('IV_pole_a01', tmp_path)


def test_cache_rejects_additional_files_and_symlinks(tmp_path, monkeypatch):
    folder = package_fixture(tmp_path, monkeypatch)
    extra = folder / 'unexpected'; extra.write_text('not in source')
    with pytest.raises(ValueError, match='file set'):
        pack.verify_download('IV_pole_a01', tmp_path)
    extra.unlink(); extra.symlink_to(folder / 'texture.bin')
    with pytest.raises(ValueError, match='non-regular'):
        pack.verify_download('IV_pole_a01', tmp_path)


def test_two_placements_reopen_after_relocation_with_exact_physics_and_transform(tmp_path, monkeypatch):
    package_fixture(tmp_path, monkeypatch)
    result = qualification.qualify(tmp_path, tmp_path / 'qualification', license_reviewed=True, placement_reviewed=True)
    assert result['portable_reopened'] and result['package_copies'] == 1
    assert len(result['placements']) == 2
    assert result['source_inventory']['colliders']['Body']['enabled'] is True
    for placement in result['placements']:
        assert placement['transform_check']['request_placement_checked'] is True
        assert placement['transform_check']['placement_matrix_abs_error'] < 1e-6
        assert placement['transform_check']['basis_matrix_abs_error'] < 1e-6
        assert placement['transform_check']['collider_transforms_checked'] == 1
        assert placement['transform_check']['max_matrix_abs_error'] < 1e-6
        assert placement['inventory']['dependencies']['unique_files'] == 1
    assert result['physics_ready'] is False and result['physics_tested'] is False
    assert (tmp_path / 'qualification/portable-assembly/ATTRIBUTION.md').is_file()
    assert not (tmp_path / 'qualification/assembly').exists()


def test_qualification_requires_explicit_reviews_before_network_or_output(tmp_path, monkeypatch):
    monkeypatch.setattr(pack, 'verify_download', lambda *args, **kwargs: pytest.fail('No source read before reviews'))
    with pytest.raises(ValueError, match='Review'):
        qualification.qualify(tmp_path, tmp_path / 'out')
    assert not (tmp_path / 'out').exists()


def test_reported_profile_is_root_bound_and_never_overrides_failure(tmp_path):
    folder = tmp_path / 'asset'; (folder / '.metadata').mkdir(parents=True)
    path = folder / '.metadata/com.nvidia.simready.conformance.Package-Candidate@1.0.0.json'
    profile = {'profile': 'Package-Candidate', 'profile_version': '1.0.0', 'assets': [
        {'asset': 'root.usda', 'features': [{'FEATURE': {'passed': False, 'failing_requirements': ['missing']}}]}]}
    path.write_text(json.dumps(profile))
    with pytest.raises(ValueError, match='failing'):
        qualification.reported_profile(folder, 'root.usda')
    with pytest.raises(ValueError, match='cover'):
        qualification.reported_profile(folder, 'other.usda')


@pytest.mark.parametrize('relative', ['qualification', 'nested/qualification'])
def test_qualification_output_inside_package_is_rejected_before_any_write(tmp_path, monkeypatch, relative):
    folder = package_fixture(tmp_path, monkeypatch)
    before = {path.relative_to(folder).as_posix(): path.read_bytes() for path in folder.rglob('*') if path.is_file()}
    monkeypatch.setattr(pack, 'verify_download', lambda *args, **kwargs: pytest.fail('Containment must precede source verification'))
    output = folder / relative
    with pytest.raises(ValueError, match='outside the source package'):
        qualification.qualify(tmp_path, output, license_reviewed=True, placement_reviewed=True)
    assert not output.exists()
    assert not (folder / relative.split('/')[0]).exists()
    after = {path.relative_to(folder).as_posix(): path.read_bytes() for path in folder.rglob('*') if path.is_file()}
    assert after == before, 'A refused output path must not contaminate the source cache'


@pytest.mark.parametrize('mutation', ['translation', 'rotation', 'basis', 'units', 'up-axis'])
def test_serialized_placement_must_match_request_not_its_own_changed_wrapper(tmp_path, monkeypatch, mutation):
    package_fixture(tmp_path, monkeypatch)
    from pxr import Gf, Usd, UsdGeom
    compose = qualification.bridge.compose
    def altered_output(plan, workspace, out):
        report = compose(plan, workspace, out)
        stage = Usd.Stage.Open(str(out / 'simready-additions.usda'))
        wrapper = stage.GetPrimAtPath('/SimReadyAdditions/iv_pole_1')
        if mutation == 'translation':
            wrapper.GetAttribute('xformOp:translate').Set(Gf.Vec3d(999, 0, 0))
        elif mutation == 'rotation':
            wrapper.GetAttribute('xformOp:rotateXYZ').Set(Gf.Vec3f(10, 20, 30))
        elif mutation == 'basis':
            stage.GetPrimAtPath('/SimReadyAdditions/iv_pole_1/Basis').GetAttribute('xformOp:rotateX').Set(0)
        elif mutation == 'units':
            UsdGeom.SetStageMetersPerUnit(stage, .01)
        else:
            UsdGeom.SetStageUpAxis(stage, 'Z')
        stage.GetRootLayer().Save()
        return report
    monkeypatch.setattr(qualification.bridge, 'compose', altered_output)
    with pytest.raises(ValueError, match='placement/basis|units/basis'):
        qualification.qualify(tmp_path, tmp_path / 'out', license_reviewed=True, placement_reviewed=True)
    assert not (tmp_path / 'out/qualification.json').exists(), 'Changed output must never receive a successful qualification'
