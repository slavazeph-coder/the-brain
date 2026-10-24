"""A BIM-only edit preserves prior source-bound naming without a new model call."""
import copy
import hashlib
import json
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'robotics/world_worker'))
import scene_usd as su
from tests.scene_compiler.test_scene_usd import handoff


def previous(tmp_path):
    out = tmp_path / 'earlier/output'
    out.mkdir(parents=True)
    cloud = handoff()
    names = {'schema': 'brainsnn.object-names.v1', 'model': 'recorded-model',
             'prompt_version': 'recorded-prompt', 'objects': []}
    (out / 'arena-cloud.json').write_text(json.dumps(cloud))
    (out / 'object-names.json').write_text(json.dumps(names))
    return cloud, out, {'source': {'job': 'a' * 32, 'engine': 'scene-usd', 'path': str(out.parent)}}


def test_same_geometry_reuses_exact_names_and_original_provenance(tmp_path):
    cloud, out, request = previous(tmp_path)
    cloud['nameObjects'] = True
    original = copy.deepcopy(cloud)
    path, evidence = su.name_step(cloud, request, tmp_path / 'next', client=object())
    assert path.read_bytes() == (out / 'object-names.json').read_bytes()
    assert evidence['status'] == 'reused' and evidence['model_executed'] is False
    assert evidence['model'] == 'recorded-model' and evidence['prompt_version'] == 'recorded-prompt'
    assert evidence['source_sha256'] == hashlib.sha256(path.read_bytes()).hexdigest()
    assert cloud == original


def test_changed_points_or_scale_cannot_reuse_old_names(tmp_path):
    cloud, _out, request = previous(tmp_path)
    cloud['points'][0][0] += .01
    with pytest.raises(ValueError, match='different geometry or scale'):
        su.name_step(cloud, request, tmp_path / 'next')
    cloud, _out, request = previous(tmp_path / 'other')
    cloud['scale']['distance'] += .1
    with pytest.raises(ValueError, match='different geometry or scale'):
        su.name_step(cloud, request, tmp_path / 'other-next')


def test_no_prior_names_does_not_invent_them(tmp_path):
    cloud, out, request = previous(tmp_path)
    (out / 'object-names.json').unlink()
    assert su.name_step(cloud, request, tmp_path / 'next') == (None, None)
