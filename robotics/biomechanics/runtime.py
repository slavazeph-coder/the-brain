"""Actual OpenSim positions, muscle geometry and explicitly loaded inverse dynamics."""
from __future__ import annotations

import csv
import json
from pathlib import Path
import time

from .setup_runtime import receipt_path, verify_runtime
from .validation import sha256


def analyze(checked: dict, output: Path, bindings: dict) -> dict:
    import numpy as np
    from scipy.interpolate import CubicSpline
    receipt = verify_runtime()
    import opensim as osim
    osim.Logger.removeFileSink()

    started = time.monotonic()
    output.mkdir(parents=True, exist_ok=True)
    model_info, motion, options = (checked[key] for key in ('biomech-model', 'biomech-motion', 'biomech-options'))
    model_path = output / 'analysis-model.osim'
    model_path.write_bytes(model_info['sanitized'])
    model = osim.Model(str(model_path))
    model.setUseVisualizer(False)
    model.setAllControllersEnabled(False)
    state = model.initSystem()
    coordinates = [model.getCoordinateSet().get(i) for i in range(model.getCoordinateSet().getSize())]
    names = [coordinate.getName() for coordinate in coordinates]
    if set(names) != set(motion['coordinate_names']) or len(names) != len(motion['coordinate_names']):
        raise ValueError('Motion must provide every native model coordinate exactly once, with no extras.')
    if len(names) != model_info['coordinate_count']:
        raise ValueError('Native model coordinates differ from validated XML.')
    units = []
    for coordinate in coordinates:
        kind = coordinate.getMotionType()
        if kind not in (osim.Coordinate.Rotational, osim.Coordinate.Translational):
            raise ValueError('A coordinate has unspecified/coupled physical units.')
        units.append('rad' if kind == osim.Coordinate.Rotational else 'm')
        if coordinate.isPrescribed(state):
            raise ValueError('Prescribed coordinates are unsupported; provide explicit motion without a hidden function.')
    values = np.asarray(motion['values'], dtype=float)[:, [motion['coordinate_names'].index(n) for n in names]]
    if motion['in_degrees']:
        values[:, np.asarray(units) == 'rad'] *= np.pi / 180
    times = np.asarray(motion['time_s'], dtype=float)
    bodies = [model.getBodySet().get(i) for i in range(model.getBodySet().getSize())]
    joints = [model.getJointSet().get(i) for i in range(model.getJointSet().getSize())]
    body_by_name = {body.getName(): body for body in bodies}
    parent_names = {}
    for joint in joints:
        child = joint.getChildFrame().findBaseFrame().getName()
        parent = joint.getParentFrame().findBaseFrame().getName()
        if child not in body_by_name or parent not in (*body_by_name, 'ground') or child in parent_names:
            raise ValueError('Use a body tree with exactly one parent joint per body.')
        parent_names[child] = parent
    ordered = []
    while len(ordered) < len(bodies):
        available = [name for name in body_by_name if name not in ordered and parent_names.get(name) in ('ground', *ordered)]
        if not available:
            raise ValueError('Disconnected or cyclic body graph is unsupported.')
        ordered.extend(available)
    bodies = [body_by_name[name] for name in ordered]
    body_index = {name: i for i, name in enumerate(ordered)}
    muscles = [model.getMuscles().get(i) for i in range(model.getMuscles().getSize())]
    if len(muscles) != model_info['muscle_count']:
        raise ValueError('Native muscles differ from validated built-in muscle types.')
    selected = options.get('moment_arm_coordinates') or [name for name, unit in zip(names, units) if unit == 'rad'][:4]
    if any(name not in names or units[names.index(name)] != 'rad' for name in selected):
        raise ValueError('Moment arms require selected rotational model coordinates.')
    frame_count = len(times)
    if len(bodies) * frame_count > 100000 or len(muscles) * frame_count * max(1, len(selected)) > 500000:
        raise ValueError('Model × frames × moment-arm selection exceeds the bounded analysis budget.')
    mass = float(model.getTotalMass(state))
    if not np.isfinite(mass) or not 0 < mass <= 10000:
        raise ValueError('Model mass must be positive and at most 10,000 kg.')
    if any(not np.isfinite(body.getMass()) or not 0 <= body.getMass() <= 10000 for body in bodies):
        raise ValueError('Invalid body mass.')
    gravity = np.asarray([model.getGravity().get(i) for i in range(3)])
    if not np.isfinite(gravity).all() or np.max(abs(gravity)) > 100 or abs(gravity[0]) > 1e-10 or abs(gravity[2]) > 1e-10 or gravity[1] > 0:
        raise ValueError('Declared Y-up model must have downward Y gravity (or zero gravity).')
    dynamics = options['analysis'] == 'inverse-dynamics'
    if dynamics and (frame_count < 5 or model.getConstraintSet().getSize() or any(c.getLocked(state) for c in coordinates)):
        raise ValueError('Inverse dynamics needs at least five frames and no locked coordinates or explicit constraints.')
    if dynamics and state.getNQ() != len(coordinates):
        raise ValueError('Inverse dynamics currently requires explicit non-quaternion model coordinates.')
    load_data = checked.get('biomech-loads')
    if load_data and any(load['body'] not in body_by_name for load in load_data['loads']):
        raise ValueError('External loads refer to a body absent from this model.')
    positions, rotations, centers, joint_positions, com, lengths, arms, qs = [], [], [], [], [], [], [], []

    def vector(value):
        return [float(value.get(i)) for i in range(3)]

    def set_frame(index):
        state.setTime(float(times[index]))
        for coordinate, value in zip(coordinates, values[index]):
            if coordinate.getLocked(state) and abs(coordinate.getDefaultValue() - value) > 1e-8:
                raise ValueError('Motion changes a locked coordinate.')
            coordinate.setValue(state, float(value), False)
        # Constraint assembly may be needed for supported model geometry, but a
        # projection changing uploaded coordinates is never silently accepted.
        model.assemble(state)
        if any(abs(c.getValue(state) - value) > 1e-7 for c, value in zip(coordinates, values[index])):
            raise ValueError('Model assembly/clamping would alter the supplied coordinates.')
        model.realizePosition(state)

    for frame in range(frame_count):
        set_frame(frame)
        positions.append([vector(body.getTransformInGround(state).p()) for body in bodies])
        frame_rotations = []
        for body in bodies:
            quaternion = body.getTransformInGround(state).R().convertRotationToQuaternion()
            frame_rotations.append([float(quaternion.get(i)) for i in (1, 2, 3, 0)])
        rotations.append(frame_rotations)
        centers.append([vector(body.findStationLocationInGround(state, body.getMassCenter())) for body in bodies])
        joint_positions.append([vector(joint.getChildFrame().getTransformInGround(state).p()) for joint in joints])
        com.append(vector(model.calcMassCenterPosition(state)))
        lengths.append([float(muscle.getLength(state)) for muscle in muscles])
        arms.append([[float(muscle.computeMomentArm(state, coordinates[names.index(name)])) for name in selected] for muscle in muscles])
        qs.append([state.getQ().get(i) for i in range(state.getNQ())])
    for data in (positions, rotations, centers, joint_positions, com, lengths, arms, qs):
        array = np.asarray(data, dtype=float)
        if not np.isfinite(array).all() or (array.size and np.max(abs(array)) > 1e6):
            raise ValueError('Native analysis produced nonfinite or unbounded values.')
    if lengths and np.any(np.asarray(lengths) < 0):
        raise ValueError('Native muscle path has a negative length.')
    bindings = {**bindings, 'analysis_model_sha256': sha256(model_path.read_bytes()),
                'runtime_manifest_sha256': sha256(receipt_path().read_bytes())}
    preview = {'schema': 'brainsnn.biomechanics-preview.v1', 'analysis': options['analysis'],
               'bindings': bindings, 'runtime': {key: receipt[key] for key in ('version', 'native_build', 'wheel_sha256')},
               'coordinate_frame': 'right-handed-y-up', 'time_s': times.tolist(),
               'body_names': ordered, 'body_parents': [-1 if parent_names[name] == 'ground' else body_index[parent_names[name]] for name in ordered],
               'body_positions_m': positions, 'body_rotations_xyzw': rotations, 'body_com_positions_m': centers,
               'joint_names': [joint.getName() for joint in joints],
               'joint_parent_bodies': [-1 if joint.getParentFrame().findBaseFrame().getName() == 'ground' else body_index[joint.getParentFrame().findBaseFrame().getName()] for joint in joints],
               'joint_child_bodies': [body_index[joint.getChildFrame().findBaseFrame().getName()] for joint in joints],
               'joint_positions_m': joint_positions, 'coordinate_names': names, 'coordinate_units': units,
               'coordinate_values': values.tolist(), 'com_positions_m': com, 'mass_kg': mass,
               'muscle_names': [muscle.getName() for muscle in muscles], 'muscle_lengths_m': lengths,
               'moment_arm_coordinate_names': selected, 'moment_arms_m': arms,
               'medical_validated': False, 'muscle_activations_estimated': False,
               'ground_reaction_forces_estimated': False, 'forward_dynamics_executed': False}
    if dynamics:
        matter = model.getMatterSubsystem()
        native_names = model.getCoordinateNamesInMultibodyTreeOrder()
        native_order = [native_names.getElt(i) for i in range(native_names.size())]
        q_values = np.asarray(qs)
        if len(native_order) != state.getNQ() or set(native_order) != set(names) or not np.allclose(q_values, values[:, [names.index(n) for n in native_order]], atol=1e-8, rtol=0):
            raise ValueError('Native generalized-coordinate order does not match explicit input coordinates.')
        # Native N(q) handles qdot != u, including coupled angular mobilizers.
        # No smoothing is hidden here: derivative quality depends on the input.
        spline = CubicSpline(times, q_values, axis=0)
        qdot, qddot = spline(times, 1), spline(times, 2)
        solver = osim.InverseDynamicsSolver(model)
        forces = []
        def sim_vector(values):
            result = osim.Vector(len(values), 0)
            for i, value in enumerate(values): result.set(i, float(value))
            return result
        for frame in range(frame_count):
            set_frame(frame)
            speeds = osim.Vector(state.getNU(), 0)
            matter.multiplyByNInv(state, False, sim_vector(qdot[frame]), speeds)
            state.setU(speeds)
            model.realizeVelocity(state)
            ndot = osim.Vector(state.getNQ(), 0)
            matter.multiplyByNDot(state, False, speeds, ndot)
            accelerations = osim.Vector(state.getNU(), 0)
            matter.multiplyByNInv(state, False, sim_vector(qddot[frame] - np.asarray([ndot.get(i) for i in range(state.getNQ())])), accelerations)
            applied = osim.VectorOfSpatialVec(model.getGravityBodyForces(state))
            for load in (load_data['loads'] if load_data else []):
                body = body_by_name[load['body']]
                force, point, torque = (np.asarray(load[key][frame], dtype=float) for key in ('force_N', 'point_m', 'torque_Nm'))
                origin = np.asarray(vector(body.getTransformInGround(state).p()))
                moment = torque + np.cross(point - origin, force)
                index = int(body.getMobilizedBodyIndex())
                old = applied.get(index)
                spatial = osim.SpatialVec(); spatial.setToZero()
                spatial.set(0, osim.Vec3(*(np.asarray(vector(old.get(0))) + moment)))
                spatial.set(1, osim.Vec3(*(np.asarray(vector(old.get(1))) + force)))
                applied.set(index, spatial)
            tau = solver.solve(state, accelerations, osim.Vector(state.getNU(), 0), applied)
            coordinate_tau = osim.Vector(state.getNQ(), 0)
            matter.multiplyByNInv(state, True, tau, coordinate_tau)
            forces.append([float(coordinate_tau.get(native_order.index(name))) for name in names])
        if not np.isfinite(forces).all() or np.max(np.abs(forces)) > 1e8:
            raise ValueError('Native inverse dynamics produced nonfinite or unbounded generalized forces.')
        preview['inverse_dynamics'] = {'coordinate_names': names, 'units': ['N m' if unit == 'rad' else 'N' for unit in units],
                                      'generalized_forces': forces, 'external_loads_mode': options['external_loads'],
                                      'differentiation': 'cubic spline, no filtering'}
    report = {'schema': 'brainsnn.biomechanics-report.v1', 'analysis': options['analysis'], 'bindings': bindings,
              'runtime': preview['runtime'], 'frame_count': frame_count, 'duration_s': float(times[-1] - times[0]),
              'body_count': len(bodies), 'coordinate_count': len(coordinates), 'muscle_count': len(muscles),
              'mass_kg': mass, 'gravity_m_s2': gravity.tolist(), 'display_meshes_omitted': model_info['display_meshes_omitted'],
              'inverse_dynamics_executed': dynamics, 'forward_dynamics_executed': False,
              'external_loads_mode': options.get('external_loads'), 'external_loads_reason': options.get('no_external_loads_reason'),
              'external_loads_physically_verified': False, 'subject_anatomy_verified': False,
              'source_is_video': False, 'markerless_capture_executed': False, 'enable_executed': False,
              'medical_validated': False, 'muscle_activations_estimated': False, 'ground_reaction_forces_estimated': False,
              'model_internal_forces_excluded_from_inverse_dynamics': [model.getForceSet().get(i).getName() for i in range(model.getForceSet().getSize())] if dynamics else [],
              'method': 'Native OpenSim model geometry; inverse dynamics uses gravity and only explicitly declared body loads.',
              'limitations': ['Model mass, anatomy and external forces are supplied assumptions, not validated measurements.',
                              'Muscle path length and moment arm do not establish muscle activation or force.',
                              'Generalized joint forces are model net loads, not bone-on-bone contact forces.',
                              'Cubic interpolation derivatives have no filtering; noisy or under-sampled motion can distort dynamics.']}
    raw_preview = json.dumps(preview, separators=(',', ':'), allow_nan=False).encode()
    if len(raw_preview) > 48 * 1024**2:
        raise ValueError('Native preview exceeds the 48 MiB output limit.')
    (output / 'biomechanics-preview.json').write_bytes(raw_preview)
    report['preview_sha256'] = sha256(raw_preview)
    report['elapsed_seconds'] = round(time.monotonic() - started, 3)
    (output / 'biomechanics-report.json').write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
    def write_csv(filename, columns, rows):
        with (output / filename).open('w', newline='') as stream:
            writer = csv.writer(stream); writer.writerow(['time_s', *columns])
            writer.writerows([float(t), *row] for t, row in zip(times, rows))
    write_csv('biomechanics-coordinates.csv', [f'{name} [{unit}]' for name, unit in zip(names, units)], values)
    if muscles:
        write_csv('biomechanics-muscles.csv', [f'{muscle.getName()} [m]' for muscle in muscles], lengths)
    if dynamics:
        write_csv('biomechanics-inverse-dynamics.csv', [f'{name} [{unit}]' for name, unit in zip(names, preview['inverse_dynamics']['units'])], forces)
    return report
