"""Convert World Builder rolling-pin trials to a local LeRobot v3 gripper dataset."""
import argparse
from contextlib import contextmanager
from functools import lru_cache
import json
import math
from pathlib import Path
import subprocess

import numpy as np

from export_showroom_episodes import DatasetFormat, FPS, ROOT, convert, require

CAMERA = 'observation.images.side'
JOINTS = ['carriage', 'elevator', 'left_slide', 'right_slide']
CONTACTS = ['left', 'right', 'tray']
QPOS = ['pin_x_m', 'pin_y_m', 'pin_z_m', 'pin_qw', 'pin_qx', 'pin_qy', 'pin_qz'] + [j + '_m' for j in JOINTS]
QVEL = ['pin_vx_m_s', 'pin_vy_m_s', 'pin_vz_m_s', 'pin_wx_rad_s', 'pin_wy_rad_s', 'pin_wz_rad_s'] + [
    j + '_m_s' for j in JOINTS]
ACTIONS = ['slide_across_m', 'lift_m', 'close_left_m', 'close_right_m']
ACTION_RANGES = [(-.04, .42), (-.13, .03), (0, .052), (0, .052)]


def numeric_vector(value, size):
    return isinstance(value, list) and len(value) == size and all(
        type(v) in (int, float) and math.isfinite(v) and abs(v) < 1e4 for v in value)


def validate(episode):
    require(episode.get('schema') == 'brainsnn.kitchen-pin.v1', 'Expected a kitchen rolling-pin recording.')
    require(episode['controller'] in ('grip', 'open') and episode['engine']['name'] == 'MuJoCo',
            'Expected a simulated gripper trial.')
    require(episode['sampleIntervalSeconds'] == 1 / FPS and episode['timestepSeconds'] == .002,
            'Expected a 20 Hz recording of a 500 Hz simulation.')
    frames = episode['frames']
    require(isinstance(frames, list) and len(frames) == 121, 'Expected the complete six-second trial.')
    score = episode['score']
    require(type(score['success']) is bool and score['reason'] in ('placed', 'no-gripped-lift', 'pin-not-resting-in-tray')
            and score['success'] == (score['reason'] == 'placed'), 'Invalid placement score.')
    for index, frame in enumerate(frames):
        require(math.isclose(frame['time'], index / FPS, rel_tol=0, abs_tol=1e-7), 'Frame falls outside the 20 Hz clock.')
        require(numeric_vector(frame['position'], len(QPOS)) and numeric_vector(frame['velocity'], len(QVEL)),
                'Unexpected gripper or free-body state vector.')
        require(all(type(frame['contacts'].get(k)) is bool for k in CONTACTS), 'Missing sampled pin contact.')
        if index == len(frames) - 1:
            require(frame['action'] is None, 'The terminal observation must have no action.')
        else:
            command = frame['action']
            require(numeric_vector(command, 4) and all(lo <= x <= hi for x, (lo, hi) in zip(command, ACTION_RANGES)),
                    'Expected four bounded actuator position targets.')


def state(frame):
    return np.array(frame['position'] + frame['velocity'], dtype=np.float32)


def contacts(frame):
    return np.array([frame['contacts'][k] for k in CONTACTS], dtype=bool)


def transition(episode, index):
    current, following = episode['frames'][index:index + 2]
    done = following['action'] is None
    return {
        'observation.state': state(current), 'observation.contacts': contacts(current),
        'action': np.array(current['action'], dtype=np.float32),
        'next.observation.state': state(following), 'next.contacts': contacts(following),
        'next.done': np.array([done], dtype=bool),
        'next.success': np.array([done and episode['score']['success']], dtype=bool),
    }


def features(rgb):
    out = {}
    for name, names, dtype in [
            ('observation.state', QPOS + QVEL, 'float32'), ('next.observation.state', QPOS + QVEL, 'float32'),
            ('observation.contacts', CONTACTS, 'bool'), ('next.contacts', CONTACTS, 'bool'),
            ('action', ACTIONS, 'float32'), ('next.done', None, 'bool'), ('next.success', None, 'bool')]:
        out[name] = {'dtype': dtype, 'shape': (len(names) if names else 1,), 'names': names}
    if rgb:
        out[CAMERA] = {'dtype': 'image', 'shape': (128, 128, 3), 'names': ['height', 'width', 'channel']}
    return out


@lru_cache(maxsize=1)
def trusted_kitchen_xml():
    return subprocess.check_output(['node', '--input-type=module', '-e',
        "import {KITCHEN_PIN_MJCF} from './brainsnn-r3f-app/public/world/kitchen-pin-physics.mjs';"
        "process.stdout.write(KITCHEN_PIN_MJCF);"], cwd=ROOT, text=True, timeout=15)


def checked_model(raw):
    xml = trusted_kitchen_xml()
    require(json.loads(raw)['modelXML'] == xml, 'Recording differs from the built-in kitchen model.')
    return xml


@contextmanager
def replay_rgb(episode, xml):
    import mujoco

    require(episode['engine']['version'] == mujoco.__version__, 'Native MuJoCo must match the recorded engine version.')
    model = mujoco.MjModel.from_xml_string(xml)
    data = mujoco.MjData(model)
    mujoco.mj_forward(model, data)
    pin_geoms = {model.geom(n).id for n in ('pin_barrel', 'pin_handles')}
    other_geoms = {model.geom(n).id: key for n, key in zip(('left_pad', 'right_pad', 'tray_base'), CONTACTS)}
    with mujoco.Renderer(model, height=128, width=128) as renderer:
        def images():
            for index, frame in enumerate(episode['frames']):
                # Contacts refer to the preceding native physics step; refresh the poses used by the camera.
                observed = dict.fromkeys(CONTACTS, False)
                for contact in data.contact:
                    if contact.efc_address >= 0:
                        a, b = contact.geom1, contact.geom2
                        other = b if a in pin_geoms else a if b in pin_geoms else None
                        if other in other_geoms:
                            observed[other_geoms[other]] = True
                require(observed == frame['contacts'], f'Native pin contacts differ at frame {index}.')
                require(np.allclose(data.qpos, frame['position'], atol=1e-5, rtol=0) and
                        np.allclose(data.qvel, frame['velocity'], atol=1e-5, rtol=0),
                        f'Native gripper state differs at frame {index}.')
                if frame['action'] is None:
                    break
                mujoco.mj_kinematics(model, data)
                renderer.update_scene(data, camera='kitchen_side')
                yield renderer.render()
                data.ctrl[:] = frame['action']
                mujoco.mj_step(model, data, nstep=25)
        yield images()


KITCHEN = DatasetFormat('brainsnn/kitchen-pin', 'brainsnn_simulated_cartesian_gripper',
                        'Place the rolling pin in the baking tray.', CAMERA, 'MuJoCo kitchen_side, 128x128 RGB',
                        'brainsnn.kitchen-lerobot.v1', validate, features, transition, checked_model, replay_rgb,
                        lambda episode: {'controller': episode['controller']})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('episodes', nargs='+', type=Path)
    parser.add_argument('--output', required=True, type=Path, help='New output directory.')
    parser.add_argument('--rgb', action='store_true', help='Replay the native kitchen camera and verify contacts.')
    args = parser.parse_args()
    receipt = convert(args.episodes, args.output, args.rgb, fmt=KITCHEN)
    print(f'Verified {receipt["verifiedRows"]} gripper commands in {receipt["datasetEpisodes"]} episodes.')


if __name__ == '__main__':
    main()
