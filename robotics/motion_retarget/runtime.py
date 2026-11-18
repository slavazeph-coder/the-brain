"""Run the real pinned SOMA/Newton solver and export synchronized articulated poses."""
from __future__ import annotations

import importlib.metadata
import json
import os
from pathlib import Path
import sys
import time

from . import TARGET, UPSTREAM_COMMIT, UPSTREAM_VERSION
from .setup_runtime import G1, ZERO, REQUIRED_DISTRIBUTIONS
from .validation import MAX_BVH_BYTES, parse_bvh, read_regular, sha256, strict_json, validate_source


def verify_runtime(root: Path) -> dict:
    receipt = strict_json(read_regular(root / 'brainsnn-runtime.json', 256 * 1024))
    if receipt.get('schema') != 'brainsnn.soma-runtime.v1' or receipt.get('commit') != UPSTREAM_COMMIT or receipt.get('target') != TARGET:
        raise RuntimeError('Install the pinned SOMA runtime with robotics.motion_retarget.setup_runtime.')
    files = receipt.get('files')
    if not isinstance(files, dict) or not 20 <= len(files) <= 1000 or ZERO not in files:
        raise RuntimeError('Incomplete SOMA runtime manifest.')
    for name, digest in files.items():
        path = root / name
        if (not isinstance(name, str) or Path(name).is_absolute() or '..' in Path(name).parts
                or path.is_symlink() or not path.resolve().is_relative_to(root.resolve())):
            raise RuntimeError('Unsafe path in SOMA runtime manifest.')
        # Empty __init__.py files are valid pinned package assets.
        if not path.is_file() or path.stat().st_size > 32 * 1024**2 or sha256(path.read_bytes()) != digest:
            raise RuntimeError(f'SOMA runtime file changed: {name}')
    expected = {'newton': '1.3.0', 'warp-lang': '1.14.0', 'numpy': '2.4.3', 'scipy': '1.17.1',
                'tqdm': '4.67.3', 'trimesh': '4.10.1', 'pycollada': '0.9.2', 'usd-core': '26.3', 'defusedxml': '0.7.1'}
    for name, version in expected.items():
        if importlib.metadata.version(name) != version or receipt['dependencies'].get(name) != version:
            raise RuntimeError(f'SOMA dependency mismatch: {name}; expected {version}.')
    return receipt


def y_up(positions):
    """Newton (X,Y,Z-up) -> BrainSNN (X,Z,-Y), preserving handedness and metres."""
    return positions[..., [0, 2, 1]] * [1, 1, -1]


def joint_diagnostics(model, raw, joint_names):
    import numpy as np
    import newton
    joint_type = model.joint_type.numpy()
    qs, qds = model.joint_q_start.numpy(), model.joint_qd_start.numpy()
    lower, upper = model.joint_limit_lower.numpy(), model.joint_limit_upper.numpy()
    entries, order, values = [], [], []
    for i, kind in enumerate(joint_type):
        if kind != newton.JointType.REVOLUTE:
            continue
        name = model.joint_label[i].split('/')[-1]
        lo, hi, column = float(lower[qds[i]]), float(upper[qds[i]]), int(qs[i])
        vals = raw[:, column]
        if not np.isfinite([lo, hi]).all() or lo > hi:
            raise ValueError('Robot joint limit contract is invalid.')
        violation = np.maximum(np.maximum(lo - vals, vals - hi), 0)
        entries.append({'name': name, 'lower_rad': lo, 'upper_rad': hi,
                        'observed_min_rad': float(vals.min()), 'observed_max_rad': float(vals.max()),
                        'max_violation_rad': float(violation.max()),
                        'frames_at_limit': int(((abs(vals - lo) < 1e-5) | (abs(vals - hi) < 1e-5)).sum())})
        values.append(vals); order.append(name)
    if order != joint_names or len(order) != 29:
        raise ValueError('G1 model joint order differs from the qualified 29-DOF CSV contract.')
    if any(e['max_violation_rad'] > 1e-5 for e in entries):
        raise ValueError('Retargeted output violates a declared robot joint limit.')
    return {'checked_after_upstream_clamping': True, 'violating_frames': 0, 'joints': entries}, np.stack(values, axis=1)


def retarget(raw: bytes, options: dict, output: Path, *, runtime_dir: Path, device='cpu') -> dict:
    """No fallback poses: missing/changed runtime, native errors or invalid output fail the job."""
    started = time.monotonic()
    runtime_dir = runtime_dir.resolve()
    receipt = verify_runtime(runtime_dir)
    reference = parse_bvh(read_regular(runtime_dir / ZERO, MAX_BVH_BYTES), qualification_reference=True)
    source = validate_source(raw, options, reference)
    if device not in ('cpu', 'cuda:0'):
        raise ValueError('Operator device must be cpu or cuda:0.')
    # This path is operator configured and verified; upload JSON cannot choose code,
    # solver options, model files, paths, commands or a device.
    sys.path.insert(0, str(runtime_dir))
    import numpy as np
    import warp as wp
    import newton
    import soma_retargeter
    from soma_retargeter.io import bvh as bvh_io, csv as csv_io
    from soma_retargeter.pipelines.soma_retargeting_pipeline import SomaRetargetingPipeline
    from soma_retargeter.utils import newton_utils, pose_utils
    from soma_retargeter.utils.space_conversion_utils import SpaceConverter, get_facing_direction_type_from_str
    if Path(soma_retargeter.__file__).resolve().parent != runtime_dir / 'soma_retargeter':
        raise RuntimeError('Imported SOMA module is not from the verified runtime.')
    output.mkdir(parents=True, exist_ok=True)
    normalized = output / 'normalized-soma.bvh'
    normalized.write_bytes(source.canonical_bytes(options['source_units']))
    wp.init()
    if not wp.get_device(device).is_cpu and not wp.is_cuda_available():
        raise RuntimeError('Requested CUDA device is unavailable; no hidden CPU substitution.')
    with wp.ScopedDevice(device):
        skeleton, animation = bvh_io.load_bvh(str(normalized))
        if animation.num_frames != len(source.frames) or not np.isclose(animation.sample_rate, source.fps):
            raise ValueError('Upstream parser changed the motion frame/time contract.')
        # Preserve original poses before upstream initialization mutates the skeleton
        # reference array. Animation local transforms and frame timing stay unchanged.
        converter = SpaceConverter(get_facing_direction_type_from_str(options['source_facing']))
        offset = converter.transform(wp.transform_identity())
        human = pose_utils.compute_global_poses_batch(skeleton, animation.local_transforms, offset)
        pipeline = SomaRetargetingPipeline(skeleton, 'soma', TARGET)
        names = newton_utils.get_filtered_joint_names(pipeline.robot_builder, [newton.JointType.REVOLUTE])
        pipeline.add_input_motions([animation], [offset], True)
        result = pipeline.execute()[0]
        data = np.asarray(result.data)
        if data.shape != (len(source.frames), 36) or not np.isfinite(data).all() or np.max(abs(data)) > 10000:
            raise ValueError('SOMA returned malformed, nonfinite or unbounded robot coordinates.')
        norms = np.linalg.norm(data[:, 3:7], axis=1)
        if not np.allclose(norms, 1, atol=1e-4):
            raise ValueError('SOMA returned invalid root orientation quaternions.')
        model = pipeline.ik_model
        limits, angles = joint_diagnostics(model, data, names)
        state = model.state()
        robot_frames = []
        for row in data:
            q = wp.array(row, dtype=wp.float32)
            newton.eval_fk(model, q, model.joint_qd, state)
            robot_frames.append(state.body_q.numpy()[:, :3])
        robot = np.asarray(robot_frames)
        parents = [-1] * model.body_count
        for parent, child in zip(model.joint_parent.numpy(), model.joint_child.numpy()):
            if child >= 0:
                parents[int(child)] = int(parent)
        robot_names = [label.split('/')[-1] for label in model.body_label]
        if not np.isfinite(human).all() or not np.isfinite(robot).all():
            raise ValueError('Nonfinite articulated preview transforms.')
        contacts = pipeline.contact_results[0] if pipeline.contact_results else None
        contact_report = {'method': 'upstream velocity/jerk heuristic on source feet',
                          'measured_contact': False, 'channels': list(pipeline._contact_joint_names),
                          'weights': contacts.contacts.tolist() if contacts is not None else [],
                          'max_source_speed_m_s': float(np.max(contacts.speed)) if contacts is not None and contacts.speed is not None else None}
        csv_io.save_csv(str(output / 'robot-reference.csv'), names, result)
    n, fps = len(source.frames), source.fps
    preview = {'schema': 'brainsnn.motion-preview.v1', 'role': 'motion-reference',
               'units': 'm', 'coordinate_frame': 'right-handed-y-up', 'source_sha256': sha256(raw),
               'runtime_commit': UPSTREAM_COMMIT,
               'model_sha256': receipt['files'][G1 + '/desc/mjcf/g1_29dof_rev_1_0.xml'],
               'configuration_sha256': receipt['files'][G1 + '/configs/soma_to_g1_retargeter_config.json'],
               'csv_sha256': sha256((output / 'robot-reference.csv').read_bytes()),
               'fps': fps, 'frame_count': n, 'duration_seconds': (n - 1) / fps,
               'frame_times_seconds': [i / fps for i in range(n)],
               'human': {'joint_names': list(skeleton.joint_names), 'parents': skeleton.parent_indices.tolist(),
                         'positions': y_up(human[:, :, :3]).round(7).tolist()},
               'robot': {'target': TARGET, 'joint_names': robot_names, 'parents': parents,
                         'positions': y_up(robot).round(7).tolist()},
               'joint_order': names, 'joint_angles_rad': angles.round(8).tolist(),
               'robot_control_enabled': False, 'physics_executed': False}
    (output / 'motion-preview.json').write_text(json.dumps(preview, separators=(',', ':'), allow_nan=False) + '\n')
    (output / 'original-motion.bvh').write_bytes(raw)
    files = {name: {'sha256': sha256((output / name).read_bytes()), 'bytes': (output / name).stat().st_size}
             for name in ('original-motion.bvh', 'normalized-soma.bvh', 'robot-reference.csv', 'motion-preview.json')}
    g1_hashes = {name: digest for name, digest in receipt['files'].items() if name.startswith(G1 + '/')}
    model_path = G1 + '/desc/mjcf/g1_29dof_rev_1_0.xml'
    report = {'schema': 'brainsnn.motion-reference.v1', 'role': 'motion-reference', 'source_sha256': sha256(raw),
              'options': options, 'frame_count': n, 'fps': fps, 'frame_time_seconds': source.frame_time,
              'duration_seconds': (n - 1) / fps, 'frame_rate_preserved': True,
              'source_coordinate_frame': 'right-handed-y-up', 'source_units': options['source_units'],
              'csv': {'translation_units': 'cm', 'angle_units': 'degrees', 'coordinate_frame': 'right-handed-z-up',
                      'root_rotation_convention': 'extrinsic XYZ Euler', 'contains_fps': False, 'joint_order': names},
              'target': TARGET, 'model_sha256': receipt['files'][model_path],
              'robot_asset_tree_sha256': sha256(json.dumps(g1_hashes, sort_keys=True).encode()),
              'configuration_sha256': receipt['files'][G1 + '/configs/soma_to_g1_retargeter_config.json'],
              'runtime': {'name': 'NVIDIA SOMA Retargeter', 'version': UPSTREAM_VERSION, 'commit': UPSTREAM_COMMIT,
                          'device': device, 'dependencies': receipt['dependencies'],
                          'manifest_sha256': sha256((runtime_dir / 'brainsnn-runtime.json').read_bytes())},
              'diagnostics': {'joint_limits': limits, 'contact': contact_report,
                              'balance_evaluated': False, 'collision_evaluated': False, 'actuator_dynamics_evaluated': False},
              'artifacts': files, 'elapsed_seconds': round(time.monotonic() - started, 3),
              'robot_control_enabled': False, 'physics_executed': False, 'policy_trained': False,
              'warnings': ['Kinematic reference motion, not a trained controller or physical robot qualification.',
                           'Foot contact is a source-motion heuristic, not measured support or guaranteed balance.',
                           'Source units and facing are declared by the uploader; no metric accuracy is inferred.',
                           'CSV omits timing; retain this receipt and motion-preview.json with it.']}
    (output / 'motion-reference.json').write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
    return report
