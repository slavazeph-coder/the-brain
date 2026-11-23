"""Verify simulator time alignment, rejection of changed MJCF and official LeRobot readback."""
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('episode_export', ROOT / 'scripts/world-demo/export_showroom_episodes.py')
export = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(export)


@pytest.fixture(scope='module')
def episodes():
    # Use the same WASM engine and scene generator as the browser, with short routes.
    js = """
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {runShowroomEpisode} from './brainsnn-r3f-app/public/world/showroom-episode-physics.mjs';
const require=createRequire(new URL('./brainsnn-r3f-app/package.json',import.meta.url));
const mj=await (await import(pathToFileURL(require.resolve('@mujoco/mujoco')))).default();
const scene={title:'Test room',objectId:'cart',variant:'before',provenance:'Authored fixture',bounds:[0,0,3,2],
  cartRadius:.175,cartHeight:.24,route:[[1,1],[1.3,1]],obstacles:[]};
const travel=await runShowroomEpisode(mj, scene);
const atGoal=await runShowroomEpisode(mj, {...scene,route:[[1,1],[1,1]]});
console.log(JSON.stringify([atGoal,travel]));
"""
    result = subprocess.run(['node', '--input-type=module', '-e', js], cwd=ROOT,
                            check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def test_transitions_pair_each_command_with_its_consequence(episodes):
    episode = deepcopy(episodes[1])
    export.validate(episode)
    last = len(episode['frames']) - 2
    episode['frames'][-1]['contacts'] = ['wall_east']
    episode['score']['success'] = False
    row = export.transition(episode, last)
    assert row['next.done'].item() and not row['next.success'].item()
    assert row['next.contact_count'].item() == 1
    assert row['observation.state'].tolist() == export.state(episode['frames'][last]).tolist()
    assert row['next.observation.state'].tolist() == export.state(episode['frames'][-1]).tolist()
    assert row['observation.waypoint'].tolist() == pytest.approx(episode['frames'][last]['target'])
    assert row['action'].tolist() == pytest.approx(episode['frames'][last]['action'])


def test_reject_changed_time_or_terminal_command(episodes):
    episode = deepcopy(episodes[1])
    episode['frames'][1]['time'] += .003
    with pytest.raises(ValueError, match='time grid'):
        export.validate(episode)
    episode = deepcopy(episodes[1])
    episode['frames'][-1]['action'] = [0., 0.]
    with pytest.raises(ValueError, match='terminal state'):
        export.validate(episode)


def test_reject_changed_geometry_and_external_files(episodes):
    episode = deepcopy(episodes[1])
    raw = json.dumps(episode).encode()
    assert export.checked_model(raw) == episode['modelXML']
    episode['modelXML'] = '<mujoco><include file="external-model.xml"/></mujoco>'
    with pytest.raises(ValueError, match='model'):
        export.checked_model(json.dumps(episode).encode())
    episode = deepcopy(episodes[1])
    episode['scene']['title'] = 'Changed scene'
    with pytest.raises(ValueError, match='digest'):
        export.checked_model(json.dumps(episode).encode())


def test_official_dataset_reader_including_no_action_recordings(episodes, tmp_path):
    pytest.importorskip('lerobot.datasets.lerobot_dataset')
    inputs = []
    for index, episode in enumerate(episodes):
        path = tmp_path / f'saved-{index}.json'
        path.write_text(json.dumps(episode))
        inputs.append(path)
    path = tmp_path / 'converted'
    result = export.convert(inputs, path)
    assert result['verifiedRows'] == len(episodes[1]['frames']) - 1
    assert result['datasetEpisodes'] == 1 and result['camera'] is None
    assert [(x['index'], x['rows']) for x in result['episodes']] == [(None, 0), (0, result['verifiedRows'])]
    assert json.loads((path / 'meta/info.json').read_text())['codebase_version'] == 'v3.0'
    assert json.loads((path / 'meta/brainsnn-episodes.json').read_text()) == result
    with pytest.raises(ValueError, match='already exists'):
        export.convert(inputs, path)
    with pytest.raises(ValueError, match='no actions'):
        export.convert(inputs[:1], tmp_path / 'empty')
    assert not (tmp_path / 'empty').exists()



def test_native_camera_reads_every_preaction_frame_and_detects_changed_state(episodes, tmp_path):
    pytest.importorskip('lerobot.datasets.lerobot_dataset')
    pytest.importorskip('mujoco')
    episode = deepcopy(episodes[1])
    path = tmp_path / 'short-route.json'
    path.write_text(json.dumps(episode))
    manifest = export.convert([path], tmp_path / 'rgb', rgb=True)
    assert 'overhead' in manifest['camera']
    assert len(manifest['episodes'][0]['cameraSequenceSha256']) == 64

    # Keep the original scene and model intact but change a numeric state after one control interval.
    episode['frames'][1]['position'][0] += .02
    path.write_text(json.dumps(episode))
    with pytest.raises(ValueError, match='disagree at frame 1'):
        export.convert([path], tmp_path / 'altered', rgb=True)
    assert not (tmp_path / 'altered').exists()
