"""Convert World Builder's 20 Hz simulated delivery recordings to a local LeRobot v3 dataset."""
import argparse
from collections.abc import Callable
from contextlib import contextmanager, nullcontext
from hashlib import sha256
import json
import math
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from typing import NamedTuple

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
REPO_ID = 'brainsnn/showroom-delivery'
FPS = 20
CAMERA = 'observation.images.overhead'
STATE_NAMES = ['x_m', 'z_m', 'vx_m_s', 'vz_m_s']
ACTION_NAMES = ['target_vx_m_s', 'target_vz_m_s']
TASK = 'Drive the delivery cart to the end of the saved route.'
NATIVE_CHECK = """
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {makeShowroomEpisodeMJCF} from './brainsnn-r3f-app/public/world/showroom-episode-physics.mjs';
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const hash = createHash('sha256').update(JSON.stringify(input.scene)).digest('hex');
if (hash !== input.sceneSha256) throw Error('Scene hash mismatch.');
const expected = makeShowroomEpisodeMJCF(input.scene);
if (expected !== input.modelXML) throw Error('Saved model differs from the model built from the scene.');
process.stdout.write(expected);
"""


def require(condition, message):
    if not condition:
        raise ValueError(message)


def vector(value, name):
    require(isinstance(value, list) and len(value) == 2 and
            all(type(v) in (float, int) and math.isfinite(v) and abs(v) <= 1e6 for v in value),
            f'Invalid {name} vector.')
    return value


def validate(episode):
    require(episode.get('schema') == 'brainsnn.showroom-episode.v1', 'Unexpected episode schema.')
    require(episode['engine']['name'] == 'MuJoCo', 'Expected a simulated MuJoCo delivery episode.')
    require(episode['sampleIntervalSeconds'] == 1 / FPS and episode['timestepSeconds'] == 0.005,
            'Expected 20 Hz observations from a 200 Hz simulation.')
    frames = episode['frames']
    require(isinstance(frames, list) and 1 <= len(frames) <= 9001, 'Expected up to 450 seconds at 20 Hz, including the terminal state.')
    require(type(episode['score']['success']) is bool, 'Expected a scored episode.')
    require(episode['scene']['variant'] in ('before', 'after'), 'Unknown room version.')
    require(isinstance(episode['scene']['route'], list) and len(episode['scene']['route']) >= 2,
            'A route needs at least two points.')
    for index, frame in enumerate(frames):
        t = frame['time']
        require(type(t) in (int, float) and math.isclose(t, index / FPS, abs_tol=1e-6, rel_tol=0),
                f'Frame {index} is off the 20 Hz time grid.')
        vector(frame['position'], 'position')
        vector(frame['velocity'], 'velocity')
        vector(frame['target'], 'waypoint')
        if index == len(frames) - 1:
            require(frame['action'] is None, 'The terminal state must have no action.')
        else:
            vector(frame['action'], 'action')
        require(isinstance(frame['contacts'], list) and all(isinstance(x, str) for x in frame['contacts']),
                'Invalid simulator contact names.')


def state(frame):
    return np.array(frame['position'] + frame['velocity'], dtype=np.float32)


def transition(episode, index):
    frames = episode['frames']
    current, following = frames[index:index + 2]
    terminal = index == len(frames) - 2
    return {
        'observation.state': state(current),
        'observation.goal': np.array(episode['scene']['route'][-1], dtype=np.float32),
        'observation.waypoint': np.array(current['target'], dtype=np.float32),
        'action': np.array(current['action'], dtype=np.float32),
        'next.observation.state': state(following),
        'next.done': np.array([terminal], dtype=bool),
        'next.success': np.array([terminal and episode['score']['success']], dtype=bool),
        'next.contact_count': np.array([len(following['contacts'])], dtype=np.int32),
    }


def dataset_features(rgb):
    features = {}
    for key, names in [('observation.state', STATE_NAMES), ('action', ACTION_NAMES),
                       ('next.observation.state', STATE_NAMES), ('observation.goal', ['x_m', 'z_m']),
                       ('observation.waypoint', ['x_m', 'z_m'])]:
        features[key] = {'dtype': 'float32', 'shape': (len(names),), 'names': names}
    for key, dtype in [('next.done', 'bool'), ('next.success', 'bool'), ('next.contact_count', 'int32')]:
        features[key] = {'dtype': dtype, 'shape': (1,), 'names': None}
    if rgb:
        features[CAMERA] = {'dtype': 'image', 'shape': (128, 128, 3), 'names': ['height', 'width', 'channel']}
    return features


def checked_model(raw):
    # Rebuild from bounded primitives in the trusted repository module. The recorder's XML is never compiled.
    result = subprocess.run(['node', '--input-type=module', '-e', NATIVE_CHECK], cwd=ROOT, input=raw,
                            capture_output=True, timeout=30)
    if result.returncode:
        raise ValueError('Scene digest or regenerated showroom model did not match the recording. ' +
                         result.stderr.decode(errors='replace')[:400])
    return result.stdout.decode()


@contextmanager
def replay_rgb(episode, xml):
    import mujoco

    require(str(episode['engine']['version']).lstrip('v') == mujoco.__version__,
            f'Install the matching native MuJoCo version ({episode["engine"]["version"]}).')
    model = mujoco.MjModel.from_xml_string(xml)
    data = mujoco.MjData(model)
    origin = np.array(episode['scene']['route'][0], dtype=float)
    mujoco.mj_forward(model, data)
    require(model.nq == model.nv == model.nu == 2 and math.isclose(model.opt.timestep, .005),
            'Unexpected delivery cart model.')
    with mujoco.Renderer(model, height=128, width=128) as renderer:
        def images():
            for index, frame in enumerate(episode['frames']):
                expected = np.array(frame['position'] + frame['velocity'])
                actual = np.concatenate((origin + data.qpos, data.qvel))
                require(np.allclose(actual, expected, atol=1e-5, rtol=0),
                        f'Native replay and recorded state disagree at frame {index}.')
                if frame['action'] is None:
                    break
                # Update visual transforms at the post-integration qpos without modifying live dynamics.
                mujoco.mj_kinematics(model, data)
                renderer.update_scene(data, camera='episode_overhead')
                yield renderer.render()
                data.ctrl[:] = frame['action']
                mujoco.mj_step(model, data, nstep=10)
        yield images()


def image_hash(image):
    return sha256(np.ascontiguousarray(image, dtype=np.uint8)).hexdigest()


class DatasetFormat(NamedTuple):
    repo_id: str
    robot: str
    task: str
    camera_key: str
    camera: str
    receipt_schema: str
    validate: Callable
    features: Callable
    transition: Callable
    checked_model: Callable
    replay_rgb: Callable
    metadata: Callable


def delivery_metadata(episode):
    scene = episode['scene']
    return {'sceneSha256': episode['sceneSha256'], 'room': scene['title'],
            'objectId': scene['objectId'], 'variant': scene['variant']}


DELIVERY = DatasetFormat(REPO_ID, 'brainsnn_simulated_planar_delivery_cart', TASK, CAMERA,
                         'MuJoCo episode_overhead, 128x128 RGB', 'brainsnn.showroom-lerobot.v1',
                         validate, dataset_features, transition, checked_model, replay_rgb, delivery_metadata)


def read_recording(path, fmt):
    raw = path.read_bytes()
    episode = json.loads(raw)
    fmt.validate(episode)
    return raw, episode


def read_back(dataset, sources, recordings, rgb, fmt):
    offset = 0
    for source, receipt in zip(sources, recordings):
        raw, episode = read_recording(source, fmt)
        require(sha256(raw).hexdigest() == receipt['sourceSha256'], 'Source changed during conversion.')
        for index in range(len(episode['frames']) - 1):
            item = dataset[offset]
            expected = fmt.transition(episode, index)
            for key, value in expected.items():
                actual = np.asarray(item[key]).reshape(value.shape)
                require(np.array_equal(value, actual), f'Changed {key} at row {offset}.')
            require(int(item['frame_index']) == index and int(item['episode_index']) == receipt['index'] and
                    math.isclose(float(item['timestamp']), episode['frames'][index]['time'], abs_tol=1e-5) and
                    item['task'] == fmt.task, f'Changed episode alignment at row {offset}.')
            if rgb:
                image = np.asarray(item[fmt.camera_key]).transpose(1, 2, 0)
                if image.dtype != np.uint8:
                    image = np.rint(image * 255).astype(np.uint8)
                require(image_hash(image) == receipt['imageHashes'][index],
                        f'Changed simulator image at row {offset}.')
            offset += 1
    require(len(dataset) == offset, 'Unexpected number of rows on readback.')


def convert(sources, output, rgb=False, *, fmt=DELIVERY):
    os.environ.setdefault('HF_HUB_OFFLINE', '1')
    os.environ.setdefault('HF_DATASETS_OFFLINE', '1')
    from lerobot.datasets.lerobot_dataset import LeRobotDataset

    require(bool(sources), 'Provide one or more saved episode files.')
    output = Path(output).resolve()
    require(not output.exists(), 'The dataset output directory already exists.')
    output.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=output.parent, prefix='.showroom-lerobot-') as temp:
        stage = Path(temp) / 'dataset'
        dataset = LeRobotDataset.create(fmt.repo_id, FPS, root=stage, features=fmt.features(rgb),
                                        robot_type=fmt.robot,
                                        use_videos=False)
        recordings = []
        saved = 0
        seen = set()
        try:
            for source in sources:
                raw, episode = read_recording(source, fmt)
                digest = sha256(raw).hexdigest()
                require(digest not in seen, 'Repeated episode input.')
                seen.add(digest)
                xml = fmt.checked_model(raw)
                receipt = {**fmt.metadata(episode), 'sourceSha256': digest,
                           'modelSha256': sha256(xml.encode()).hexdigest(), 'engine': episode['engine'],
                           'index': None, 'provenance': episode['provenance'], 'score': episode['score'],
                           'rows': len(episode['frames']) - 1}
                if rgb:
                    receipt['imageHashes'] = []
                with fmt.replay_rgb(episode, xml) if rgb else nullcontext(None) as images:
                    for index in range(receipt['rows']):
                        row = fmt.transition(episode, index)
                        row['task'] = fmt.task
                        if rgb:
                            img = next(images)
                            row[fmt.camera_key] = img
                            receipt['imageHashes'].append(image_hash(img))
                        dataset.add_frame(row)
                    if rgb:
                        require(next(images, None) is None, 'Missing terminal replay state.')
                if receipt['rows']:
                    dataset.save_episode()
                    receipt['index'] = saved
                    saved += 1
                recordings.append(receipt)
            require(saved > 0, 'The inputs contain only terminal states. There are no actions to export.')
        finally:
            dataset.finalize()
        reader = LeRobotDataset(fmt.repo_id, root=stage, download_videos=False, return_uint8=True)
        read_back(reader, sources, recordings, rgb, fmt)
        for record in recordings:
            if rgb:
                hashes = record.pop('imageHashes')
                record['cameraSequenceSha256'] = sha256(''.join(hashes).encode('ascii')).hexdigest()
        receipt = {'schema': fmt.receipt_schema, 'format': 'LeRobot v3', 'fps': FPS,
                   'camera': fmt.camera if rgb else None,
                   'verifiedRows': len(reader), 'datasetEpisodes': saved, 'episodes': recordings}
        (stage / 'meta/brainsnn-episodes.json').write_text(json.dumps(receipt, indent=2, allow_nan=False) + '\n')
        # Atomically reserve the destination before the same-filesystem directory rename.
        output.mkdir()
        try:
            stage.replace(output)
        except OSError:
            output.rmdir()
            raise
        return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('episodes', nargs='+', type=Path, help='Saved World Builder episode JSON files.')
    parser.add_argument('--output', type=Path, required=True, help='New local dataset directory.')
    parser.add_argument('--rgb', action='store_true', help='Replay the native model and include overhead RGB observations.')
    args = parser.parse_args()
    result = convert(args.episodes, args.output, args.rgb)
    print(f'Verified {result["verifiedRows"]} rows in {result["datasetEpisodes"]} dataset episodes at {args.output}')


if __name__ == '__main__':
    main()
