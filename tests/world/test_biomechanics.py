"""Admission boundaries and genuine native OpenSim mechanics, without sample datasets."""
import json
import os
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from robotics.biomechanics.validation import parse_model, parse_motion, parse_options, parse_loads, sha256
from robotics.world_worker.biomechanics import validate_inputs, validate_upload

MODEL = b'''<OpenSimDocument Version="40500"><Model name="authored">
<gravity>0 -9.80665 0</gravity><length_units>meters</length_units>
<BodySet><objects><Body name="rod"><mass>2</mass></Body></objects></BodySet>
<JointSet><objects><PinJoint name="pin"><coordinates><Coordinate name="angle"><default_value>0</default_value></Coordinate></coordinates></PinJoint></objects></JointSet>
<ForceSet><objects/></ForceSet></Model></OpenSimDocument>'''
MOTION = b'authored\nnRows=5\nnColumns=2\ninDegrees=no\nendheader\ntime angle\n0 0\n.1 .1\n.2 .2\n.3 .3\n.4 .4\n'
OPTIONS = {'schema': 'brainsnn.biomechanics-options.v1', 'analysis': 'kinematics', 'model_up_axis': 'Y', 'length_units': 'm'}
NATIVE = os.environ.get('WORLD_BIOMECHANICS_TEST_PYTHON')


def encoded(value):
    return json.dumps(value).encode()


def checked():
    sanitized, model = parse_model(MODEL)
    return {'biomech-model': {**model, 'sanitized': sanitized}, 'biomech-motion': parse_motion(MOTION),
            'biomech-options': parse_options(encoded(OPTIONS))}


def test_pure_admission_accepts_extensionless_worker_uploads(tmp_path):
    path = tmp_path / '0123456789'
    path.write_bytes(MODEL)
    result = validate_upload(path, 'biomech-model')
    assert result['body_names'] == ['rod'] and result['coordinate_names'] == ['angle']
    assert validate_inputs(checked()) == {'frame_count': 5, 'analysis': 'kinematics'}
    assert 'opensim' not in sys.modules


@pytest.mark.parametrize('addition', [
    b'<!DOCTYPE OpenSimDocument [<!ENTITY secret SYSTEM "file:///etc/passwd">]>',
    b'<!DOCTYPE OpenSimDocument [<!ENTITY secret "hello">]>',
])
def test_entities_and_dtd_rejected(addition):
    with pytest.raises(ValueError, match='DTD'):
        parse_model(addition + MODEL)


@pytest.mark.parametrize('content', [
    b'<external_loads_file>/etc/passwd</external_loads_file>',
    b'<object_file>https://example.invalid/model</object_file>',
    b'<plugin_library>arbitrary.so</plugin_library>',
    b'<ExternalForce name="force"/>',
    b'<FunctionBasedPath name="path"/>',
    b'<Body file="outside.xml"/>',
    b'<ControllerSet><objects><PrescribedController name="controller"/></objects></ControllerSet>',
    b'<AnalysisSet><objects><MuscleAnalysis name="writer"/></objects></AnalysisSet>',
    b'<mass>NaN</mass>',
    b'<coefficients>1 1e100</coefficients>',
    b'<force_units>pounds</force_units>',
    b'<force_units>N</force_units><force_units>pounds</force_units>',
])
def test_external_native_resources_and_unsafe_numbers_rejected(content):
    with pytest.raises(ValueError):
        parse_model(MODEL.replace(b'</Model>', content + b'</Model>'))


def test_unused_display_meshes_are_omitted_before_native_parse():
    raw = MODEL.replace(b'<mass>2</mass>', b'<mass>2</mass><attached_geometry><Mesh name="display"><mesh_file>../../secret.obj</mesh_file></Mesh></attached_geometry>')
    safe, info = parse_model(raw)
    assert b'secret.obj' not in safe and b'Mesh' not in safe
    assert info['display_meshes_omitted'] == 1 and raw != safe


@pytest.mark.parametrize('raw', [
    MOTION.replace(b'inDegrees=no', b''),
    MOTION.replace(b'inDegrees=no', b'inDegrees=yes\ninDegrees=no'),
    MOTION.replace(b'nRows=5', b'nRows=99'),
    MOTION.replace(b'.2 .2', b'.1 .2'),
    MOTION.replace(b'.2 .2', b'.2 NaN'),
    MOTION.replace(b'.4 .4', b'61 .4'),
    MOTION.replace(b'time angle', b'time angle angle'),
    MOTION.replace(b'time angle', b'time /jointset/pin/angle/speed'),
])
def test_motion_rejects_ambiguous_units_shape_and_timing(raw):
    with pytest.raises(ValueError): parse_motion(raw)


def test_opensim_coordinate_value_paths_are_accepted_and_deduplicated():
    parsed = parse_motion(MOTION.replace(b'time angle', b'time /jointset/pin/angle/value'))
    assert parsed['coordinate_names'] == ['angle']


def test_model_motion_must_match_exactly():
    data = checked(); data['biomech-motion']['coordinate_names'] = ['other']
    with pytest.raises(ValueError, match='all model coordinates'): validate_inputs(data)


def test_inverse_dynamics_requires_explicit_force_contract():
    data = {**OPTIONS, 'analysis': 'inverse-dynamics'}
    with pytest.raises(ValueError, match='requires'): parse_options(encoded(data))
    with pytest.raises(ValueError, match='Explain'): parse_options(encoded({**data, 'external_loads': 'none-declared'}))
    data.update(external_loads='none-declared', no_external_loads_reason='Authored pendulum with gravity and no contacts.')
    assert parse_options(encoded(data))['external_loads'] == 'none-declared'
    with pytest.raises(ValueError): parse_options(encoded({**OPTIONS, 'external_loads': 'none-declared'}))
    with pytest.raises(ValueError): parse_options(b'{"schema":"brainsnn.biomechanics-options.v1","schema":"again"}')


def loads():
    return {'schema': 'brainsnn.biomechanics-loads.v1', 'coordinate_frame': 'ground',
            'time_s': [0, .1, .2, .3, .4], 'loads': [{'body': 'rod', 'force_N': [[0, 1, 0]] * 5,
                                                   'point_m': [[0, 0, 0]] * 5, 'torque_Nm': [[0, 0, 0]] * 5}]}


@pytest.mark.parametrize('mutation', ['time', 'body', 'missing', 'extra'])
def test_supplied_loads_bind_to_model_timeline_and_mode(mutation):
    data = checked()
    data['biomech-options'] = parse_options(encoded({**OPTIONS, 'analysis': 'inverse-dynamics', 'external_loads': 'supplied'}))
    data['biomech-loads'] = parse_loads(encoded(loads()))
    validate_inputs(data)
    if mutation == 'time': data['biomech-loads']['time_s'][1] += .001
    if mutation == 'body': data['biomech-loads']['loads'][0]['body'] = 'other'
    if mutation == 'missing': data.pop('biomech-loads')
    if mutation == 'extra': data['biomech-options'] = OPTIONS
    with pytest.raises(ValueError): validate_inputs(data)


def test_supplied_load_vectors_cannot_omit_samples_or_units():
    data = loads(); data['loads'][0]['force_N'].pop()
    with pytest.raises(ValueError): parse_loads(encoded(data))
    data = loads(); data['coordinate_frame'] = 'camera'
    with pytest.raises(ValueError): parse_loads(encoded(data))


@pytest.mark.skipif(not NATIVE, reason='Set WORLD_BIOMECHANICS_TEST_PYTHON to the installed native runtime.')
def test_native_analytic_qualification(tmp_path):
    subprocess.run([NATIVE, '-m', 'robotics.biomechanics.qualify', '--out', str(tmp_path / 'qualified')],
                   cwd=ROOT, check=True, capture_output=True, text=True, timeout=90)
    receipt = json.loads((tmp_path / 'qualified/qualification.json').read_text())
    assert receipt['passed'] and receipt['max_inverse_torque_error_Nm'] < 1e-6
    assert receipt['max_supplied_load_effect_error_Nm'] < 1e-9
    assert receipt['max_moment_arm_error_m'] < 1e-10
    assert not receipt['medical_validated'] and not receipt['ground_reaction_forces_estimated']


@pytest.fixture
def native_inputs(tmp_path):
    if not NATIVE: pytest.skip('Native OpenSim runtime not configured.')
    subprocess.run([NATIVE, '-m', 'robotics.biomechanics.authored_fixture', '--out', str(tmp_path / 'inputs')],
                   cwd=ROOT, check=True, capture_output=True, text=True, timeout=30)
    return tmp_path / 'inputs'


def native_request(tmp_path, inputs, options='kinematics-options.json'):
    return {'schema': 'brainsnn.adapter.v1', 'output_dir': str(tmp_path / 'result'), 'inputs': [
        {'kind': 'biomech-model', 'path': str(inputs / 'authored-pendulum.osim')},
        {'kind': 'biomech-motion', 'path': str(inputs / 'authored-motion.mot')},
        {'kind': 'biomech-options', 'path': str(inputs / options)}]}


def execute_cli(tmp_path, request):
    manifest = tmp_path / 'request.json'; manifest.write_text(json.dumps(request))
    env = dict(os.environ); env.pop('PYTHONPATH', None)
    return subprocess.run([NATIVE, str(ROOT / 'robotics/world_worker/biomechanics.py'), '--input-manifest', str(manifest)],
                          cwd=tmp_path, env=env, capture_output=True, text=True, timeout=90)


def test_native_cli_private_cwd_original_bytes_and_hash_bindings(tmp_path, native_inputs):
    request = native_request(tmp_path, native_inputs)
    for i, item in enumerate(request['inputs']):
        raw = Path(item['path']).read_bytes(); path = tmp_path / f'uuid-{i}'; path.write_bytes(raw)
        item.update(path=str(path), sha256=sha256(raw))
    completed = execute_cli(tmp_path, request)
    assert completed.returncode == 0, completed.stderr + completed.stdout
    result = tmp_path / 'result'
    preview = json.loads((result / 'biomechanics-preview.json').read_text())
    report = json.loads((result / 'biomechanics-report.json').read_text())
    assert preview['bindings'] == report['bindings']
    assert report['preview_sha256'] == sha256((result / 'biomechanics-preview.json').read_bytes())
    for index, name, binding in [(0, 'original-model.osim', 'model_sha256'), (1, 'original-motion.mot', 'motion_sha256'), (2, 'biomechanics-options.json', 'options_sha256')]:
        assert (result / name).read_bytes() == (tmp_path / f'uuid-{index}').read_bytes()
        assert preview['bindings'][binding] == sha256((result / name).read_bytes())
    assert len(preview['time_s']) == 31 and preview['body_parents'] == [-1, 0]
    assert 'inverse_dynamics' not in preview


@pytest.mark.parametrize('mutation', ['changed-hash', 'locked', 'clamped', 'missing-coordinate'])
def test_native_rejects_changed_or_inconsistent_inputs(tmp_path, native_inputs, mutation):
    request = native_request(tmp_path, native_inputs)
    path = native_inputs / 'authored-pendulum.osim'
    raw = path.read_text()
    if mutation == 'changed-hash': request['inputs'][0]['sha256'] = '0' * 64
    if mutation in ('locked', 'clamped'):
        tree = ET.fromstring(raw)
        coordinate = tree.find('.//Coordinate')
        property_node = coordinate.find(mutation)
        if property_node is None: property_node = ET.SubElement(coordinate, mutation)
        property_node.text = 'true'
        if mutation == 'clamped': coordinate.find('range').text = '-0.1 0.1'
        path.write_bytes(ET.tostring(tree))
        assert path.read_text() != raw and tree.find(f'.//Coordinate/{mutation}').text == 'true'
    if mutation == 'missing-coordinate':
        motion = native_inputs / 'authored-motion.mot'; motion.write_text(motion.read_text().replace('knee_angle_r', 'missing'))
    completed = execute_cli(tmp_path, request)
    assert completed.returncode != 0
    assert not (tmp_path / 'result/manifest.json').exists()
