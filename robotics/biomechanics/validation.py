"""Pure-Python admission checks; never load native objects before validating inputs."""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import re
import stat
import xml.etree.ElementTree as ET

from defusedxml import ElementTree as SafeET

MAX_MODEL_BYTES = 8 * 1024**2
MAX_MOTION_BYTES = 8 * 1024**2
MAX_OPTIONS_BYTES = 32 * 1024
MAX_LOADS_BYTES = 8 * 1024**2
MAX_FRAMES = 1800
MAX_BODIES = 128
MAX_COORDINATES = 128
MAX_MUSCLES = 256
NUMBER = re.compile(r'^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$')
NAME = re.compile(r'^[A-Za-z_][A-Za-z0-9_.-]{0,127}$')
JOINTS = {'PinJoint', 'SliderJoint', 'WeldJoint', 'BallJoint', 'FreeJoint', 'CustomJoint',
          'EllipsoidJoint', 'ScapulothoracicJoint', 'PlanarJoint', 'UniversalJoint', 'GimbalJoint'}
MUSCLES = {'Thelen2003Muscle', 'Millard2012EquilibriumMuscle', 'DeGrooteFregly2016Muscle',
           'RigidTendonMuscle', 'Millard2012AccelerationMuscle',
           'Schutte1993Muscle_Deprecated', 'Delp1990Muscle_Deprecated'}


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def read_regular(path: Path, limit: int) -> bytes:
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= limit:
        raise ValueError('Expected a nonempty regular file within its size limit.')
    with path.open('rb') as stream:
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise ValueError('Input grew beyond its size limit.')
    return raw


def strict_json(raw: bytes):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('Duplicate JSON key.')
            result[key] = value
        return result
    def constant(_):
        raise ValueError('Nonfinite JSON number.')
    try:
        return json.loads(raw.decode('utf-8'), object_pairs_hook=pairs, parse_constant=constant)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as error:
        raise ValueError('Invalid bounded UTF-8 JSON.') from error


def bounded_number(value, limit=1e8):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or abs(value) > limit:
        raise ValueError('Expected a finite bounded numeric value.')
    return float(value)


def name(value):
    if not isinstance(value, str) or not NAME.fullmatch(value) or '..' in value:
        raise ValueError('Use short, unique OpenSim component names without paths.')
    return value


def parse_model(raw: bytes) -> tuple[bytes, dict]:
    if not 0 < len(raw) <= MAX_MODEL_BYTES:
        raise ValueError('OpenSim model exceeds the 8 MiB limit.')
    try:
        root = SafeET.fromstring(raw, forbid_dtd=True, forbid_entities=True, forbid_external=True)
    except Exception as error:
        raise ValueError('Invalid model XML; DTDs, entities and external XML are prohibited.') from error
    if root.tag != 'OpenSimDocument' or not str(root.get('Version', '')).isdigit() or not 40000 <= int(root.get('Version')) < 50000:
        raise ValueError('Use a self-contained OpenSim 4 model document.')
    if len(root) != 1 or root[0].tag != 'Model':
        raise ValueError('Expected exactly one OpenSim Model, not a tool/setup file.')
    nodes = list(root.iter())
    if len(nodes) > 30000:
        raise ValueError('Model XML has too many elements.')
    pending = [(root, 0)]
    while pending:
        node, depth = pending.pop()
        if depth > 48 or not isinstance(node.tag, str) or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', node.tag):
            raise ValueError('Unsupported XML depth, namespace or tag.')
        pending.extend((child, depth + 1) for child in node)
        if len(node.text or '') > 65536:
            raise ValueError('Model property is too long.')
        for key, value in node.attrib.items():
            if key not in ('name', 'Version'):
                raise ValueError('External object/file attributes are not supported.')
            if key == 'name' and value:
                name(value)
        siblings = {}
        for child in node:
            siblings.setdefault(child.tag, []).append(child)
        for group in siblings.values():
            if len(group) > 1:
                labels = [child.get('name') for child in group]
                if any(not label for label in labels) or len(set(labels)) != len(labels):
                    raise ValueError('Duplicate or ambiguous model XML properties.')
    # Display geometry is not needed for actual model kinematics. Remove it
    # BEFORE passing XML to OpenSim, so missing meshes and arbitrary mesh paths
    # cannot cause file/network access. Original XML is retained as an artifact.
    removed = 0
    for node in nodes:
        for child in list(node):
            if child.tag in ('attached_geometry', 'frame_geometry', 'VisibleObject', 'Appearance'):
                removed += sum(1 for item in child.iter() if item.tag in ('Mesh', 'DisplayGeometry'))
                node.remove(child)
    remaining = list(root.iter())
    for node in remaining:
        key = node.tag.lower()
        tokens = (node.text or '').split()
        # Catch nonfinite values and absurd numeric properties before native
        # construction, including function coefficients and muscle parameters.
        if tokens and (all(NUMBER.fullmatch(token) for token in tokens) or
                       any(token.lower() in ('nan', 'inf', '-inf', '+inf', 'infinity', '-infinity', '+infinity') for token in tokens)):
            if len(tokens) > 4096:
                raise ValueError('A model numeric property is too large.')
            for token in tokens:
                if not NUMBER.fullmatch(token):
                    raise ValueError('Nonfinite model numeric property.')
                bounded_number(float(token))
        if re.search(r'file|document|plugin|library|script|url|uri', key) and key != 'opensimdocument':
            raise ValueError(f'External file, plugin or script property is prohibited: {node.tag}.')
        if node.tag in ('ExternalForce', 'ExternalLoads', 'FunctionBasedPath'):
            raise ValueError('External force/path data must use the explicit bounded upload contract.')
        if node.tag in ('ControllerSet', 'ProbeSet', 'AnalysisSet', 'ComponentSet') and node.find('objects') is not None and len(node.find('objects')):
            raise ValueError('Remove controllers, probes, analyses and extra components from the analysis model.')
    model = root[0]
    bodies = list(model.findall('./BodySet/objects/*'))
    joints = list(model.findall('./JointSet/objects/*'))
    coordinates = list(model.findall('.//Coordinate'))
    muscles = [node for node in model.findall('./ForceSet/objects/*') if node.tag in MUSCLES]
    if not 1 <= len(bodies) <= MAX_BODIES or any(body.tag != 'Body' for body in bodies):
        raise ValueError('Use 1–128 native OpenSim bodies.')
    if not 1 <= len(joints) <= MAX_BODIES or any(joint.tag not in JOINTS for joint in joints):
        raise ValueError('Unsupported or excessive native joints.')
    if not 1 <= len(coordinates) <= MAX_COORDINATES or len(muscles) > MAX_MUSCLES:
        raise ValueError('Use 1–128 coordinates and at most 256 muscles.')
    for collection in (bodies, joints, coordinates, muscles):
        names = [name(item.get('name')) for item in collection]
        if len(set(names)) != len(names):
            raise ValueError('Model component names must be unique within each set.')
    if len(model.findall('.//PathPoint')) + len(model.findall('.//MovingPathPoint')) + len(model.findall('.//ConditionalPathPoint')) > 8000:
        raise ValueError('Too many muscle path points.')
    if len(model.findall('.//WrapObjectSet/objects/*')) > 1024:
        raise ValueError('Too many wrapping objects.')
    if (model.findtext('length_units') or 'meters').strip() not in ('meters', 'm'):
        raise ValueError('The model must use meters.')
    if (model.findtext('force_units') or 'N').strip() != 'N':
        raise ValueError('The model must declare forces in N (SI newtons).')
    return ET.tostring(root, encoding='utf-8', xml_declaration=True), {
        'body_count': len(bodies), 'coordinate_count': len(coordinates), 'muscle_count': len(muscles),
        'display_meshes_omitted': removed,
        'coordinate_names': [item.get('name') for item in coordinates],
        'body_names': [item.get('name') for item in bodies],
    }


def parse_motion(raw: bytes) -> dict:
    if not 0 < len(raw) <= MAX_MOTION_BYTES:
        raise ValueError('Motion exceeds the 8 MiB limit.')
    try:
        text = raw.decode('utf-8-sig')
    except UnicodeError as error:
        raise ValueError('Motion must be UTF-8 text.') from error
    match = re.search(r'^[ \t]*endheader[ \t]*$', text, re.M | re.I)
    if not match:
        raise ValueError('Motion header must end with endheader.')
    header = text[:match.start()]
    degrees = re.findall(r'^\s*inDegrees\s*(?:=\s*|\s+)(yes|no)\s*$', header, re.M | re.I)
    if len(degrees) != 1:
        raise ValueError('Declare angular units once as inDegrees=yes or inDegrees=no.')
    rows = [line.split() for line in text[match.end():].splitlines() if line.strip()]
    if len(rows) < 3 or len(rows) > MAX_FRAMES + 1:
        raise ValueError('Use 2–1800 motion frames.')
    columns, rows = rows[0], rows[1:]
    if columns[0] != 'time' or not 2 <= len(columns) <= MAX_COORDINATES + 1:
        raise ValueError('Motion needs a first time column and 1–128 coordinate columns.')
    canonical = []
    for column in columns[1:]:
        if column.startswith('/jointset/') and column.endswith('/value'):
            column = column.split('/')[-2]
        canonical.append(name(column))
    if len(set(canonical)) != len(canonical):
        raise ValueError('Motion contains ambiguous duplicate coordinates.')
    values = []
    for row in rows:
        if len(row) != len(columns) or any(not NUMBER.fullmatch(item) for item in row):
            raise ValueError('Malformed numeric motion row.')
        values.append([bounded_number(float(item)) for item in row])
    times = [row[0] for row in values]
    if any(b <= a or b - a < 1e-6 for a, b in zip(times, times[1:])) or times[-1] - times[0] > 60:
        raise ValueError('Times must increase strictly, with at most 60 seconds of motion.')
    for label, actual in [('nRows|datarows', len(rows)), ('nColumns|datacolumns', len(columns))]:
        counts = re.findall(rf'^\s*(?:{label})\s*(?:=\s*|\s+)(\S+)\s*$', header, re.M | re.I)
        if any(not count.isdigit() or int(count) != actual for count in counts):
            raise ValueError('Motion table dimensions do not match its header.')
    return {'time_s': times, 'coordinate_names': canonical, 'values': [row[1:] for row in values],
            'in_degrees': degrees[0].lower() == 'yes'}


def parse_options(raw: bytes) -> dict:
    if not 0 < len(raw) <= MAX_OPTIONS_BYTES:
        raise ValueError('Options exceed 32 KiB.')
    data = strict_json(raw)
    allowed = {'schema', 'analysis', 'model_up_axis', 'length_units', 'moment_arm_coordinates',
               'external_loads', 'no_external_loads_reason'}
    if not isinstance(data, dict) or set(data) - allowed or data.get('schema') != 'brainsnn.biomechanics-options.v1':
        raise ValueError('Unsupported biomechanics options schema or properties.')
    if data.get('analysis') not in ('kinematics', 'inverse-dynamics') or data.get('model_up_axis') != 'Y' or data.get('length_units') != 'm':
        raise ValueError('Declare kinematics or inverse-dynamics, Y up, and meter model units.')
    selected = data.get('moment_arm_coordinates', [])
    if not isinstance(selected, list) or len(selected) > 4 or len(set(map(str, selected))) != len(selected):
        raise ValueError('Select at most four unique moment-arm coordinates.')
    for coordinate in selected:
        name(coordinate)
    if data['analysis'] == 'inverse-dynamics':
        if data.get('external_loads') not in ('supplied', 'none-declared'):
            raise ValueError('Inverse dynamics requires supplied loads or an explicit no-external-load declaration.')
        if data['external_loads'] == 'none-declared':
            reason = data.get('no_external_loads_reason')
            if not isinstance(reason, str) or not 20 <= len(reason.strip()) <= 500:
                raise ValueError('Explain why this model has no contacts/applied forces except gravity.')
        elif 'no_external_loads_reason' in data:
            raise ValueError('A no-load declaration conflicts with supplied forces.')
    elif 'external_loads' in data or 'no_external_loads_reason' in data:
        raise ValueError('Kinematics does not consume force assumptions.')
    return data


def parse_loads(raw: bytes) -> dict:
    if not 0 < len(raw) <= MAX_LOADS_BYTES:
        raise ValueError('External loads exceed 8 MiB.')
    data = strict_json(raw)
    if not isinstance(data, dict) or set(data) != {'schema', 'coordinate_frame', 'time_s', 'loads'} or data['schema'] != 'brainsnn.biomechanics-loads.v1' or data['coordinate_frame'] != 'ground':
        raise ValueError('Use the explicit biomechanics ground-frame loads schema.')
    times, loads = data['time_s'], data['loads']
    if not isinstance(times, list) or not 5 <= len(times) <= MAX_FRAMES or not isinstance(loads, list) or not 1 <= len(loads) <= 32:
        raise ValueError('Use 5–1800 load samples and 1–32 body loads.')
    for value in times:
        bounded_number(value)
    if any(b <= a for a, b in zip(times, times[1:])):
        raise ValueError('Load times must increase.')
    for load in loads:
        if not isinstance(load, dict) or set(load) != {'body', 'force_N', 'point_m', 'torque_Nm'}:
            raise ValueError('Each body load needs force, application point and torque.')
        name(load['body'])
        for key, bound in [('force_N', 1e6), ('point_m', 1e4), ('torque_Nm', 1e6)]:
            vectors = load[key]
            if not isinstance(vectors, list) or len(vectors) != len(times):
                raise ValueError('Loads must explicitly cover every motion frame without resampling.')
            for vector in vectors:
                if not isinstance(vector, list) or len(vector) != 3:
                    raise ValueError('Load samples must be three-component vectors.')
                for value in vector:
                    bounded_number(value, bound)
    return data
