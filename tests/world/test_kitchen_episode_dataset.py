"""Verify gripper and free-body transitions, camera readback and score preservation."""
import json
from pathlib import Path
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope='module')
def recordings(tmp_path_factory):
    folder = tmp_path_factory.mktemp('kitchen-demos')
    js = """
import {writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {runKitchenPin} from './brainsnn-r3f-app/public/world/kitchen-pin-physics.mjs';
const req=createRequire(new URL('./brainsnn-r3f-app/package.json',import.meta.url));
const mj=await (await import(pathToFileURL(req.resolve('@mujoco/mujoco')))).default();
for (const controller of ['grip','open']) {
    writeFileSync(process.argv[1]+'/'+controller+'.json',JSON.stringify(runKitchenPin(mj,controller)));
}
"""
    subprocess.run(['node', '--input-type=module', '-e', js, str(folder)], cwd=ROOT, check=True)
    return [folder / 'grip.json', folder / 'open.json']


@pytest.fixture
def kitchen(monkeypatch):
    monkeypatch.syspath_prepend(str(ROOT / 'scripts/world-demo'))
    import export_kitchen_episodes
    return export_kitchen_episodes


def test_gripper_frames_and_trusted_model(kitchen, recordings):
    trial = json.loads(recordings[0].read_text())
    kitchen.validate(trial)
    frame = kitchen.transition(trial, 119)
    assert frame['observation.state'].shape == (21,)
    assert frame['action'].shape == (4,)
    assert frame['next.success'].item() and frame['next.done'].item()
    assert frame['next.observation.state'][0] == pytest.approx(trial['frames'][-1]['pin'][0])
    trial['modelXML'] = '<mujoco><include file="external.xml"/></mujoco>'
    with pytest.raises(ValueError, match='built-in kitchen model'):
        kitchen.checked_model(json.dumps(trial).encode())
    trial['frames'][10]['time'] += .01
    with pytest.raises(ValueError, match='clock'):
        kitchen.validate(trial)


def test_official_reader_restores_grip_and_open_and_native_rgb(kitchen, recordings, tmp_path):
    sdk = pytest.importorskip('lerobot.datasets.lerobot_dataset')
    pytest.importorskip('mujoco')
    out = tmp_path / 'gripper'
    receipt = kitchen.convert(recordings, out, rgb=True, fmt=kitchen.KITCHEN)
    assert receipt['datasetEpisodes'] == 2 and receipt['verifiedRows'] == 240
    assert [(r['controller'], r['score']['success']) for r in receipt['episodes']] == [('grip', True), ('open', False)]
    reader = sdk.LeRobotDataset(kitchen.KITCHEN.repo_id, root=out, download_videos=False)
    assert bool(reader[119]['next.success']) and not bool(reader[239]['next.success'])
    assert reader[0][kitchen.CAMERA].shape == (3, 128, 128)
    trial = json.loads(recordings[0].read_text())
    trial['frames'][1]['contacts']['tray'] = not trial['frames'][1]['contacts']['tray']
    altered = tmp_path / 'altered.json'
    altered.write_text(json.dumps(trial))
    with pytest.raises(ValueError, match='Native pin contacts differ'):
        kitchen.convert([altered], tmp_path / 'mismatch', rgb=True, fmt=kitchen.KITCHEN)
    assert not (tmp_path / 'mismatch').exists()
