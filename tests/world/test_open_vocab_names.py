"""The open-vocabulary namer: a per-site list of phrases names separated objects with the same rules as the COCO
detector, records which snapshot and vocabulary ran, and never downloads a model."""
from pathlib import Path
import json
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'robotics' / 'world_worker'))
sys.path.insert(0, str(ROOT / 'tests' / 'world'))
import open_vocab_names as ov  # noqa: E402
import scene_usd as su  # noqa: E402
from test_object_names import cloud, detections_on_the_objects, views  # noqa: E402,F401


def fake_detect(detections, vocabulary=None):
    detect = lambda path: detections[path]
    detect.vocabulary = ov.parse_vocabulary(vocabulary)
    detect.model = {**ov.MODEL, 'path': '/models/owlv2', 'snapshot_digest': 'f' * 64, 'min_score': ov.MIN_SCORE, 'device': 'cpu'}
    return detect


def test_a_vocabulary_is_plain_phrases_or_labelled_terms_and_nothing_reserved():
    assert ov.parse_vocabulary(None)['golf cart'] == ('golf cart', 'vehicle')
    terms = ov.parse_vocabulary(['Golf Cart', {'prompt': 'stack of tires', 'label': 'tire stack', 'category': 'storage'}])
    assert terms == {'golf cart': ('Golf Cart', 'other'), 'stack of tires': ('tire stack', 'storage')}
    for bad in ([], ['x' * 61], [{'prompt': 'sofa', 'category': 'sofa-things'}], ['unknown'], [1], ['a'] * (ov.MAX_TERMS + 1)):
        with pytest.raises(ValueError):
            ov.parse_vocabulary(bad)


def test_rules_match_the_coco_detector_over_the_site_vocabulary():
    def item(box, *frames): return {'id': '1', 'picks': [{'view': {'name': f, 'path': f}, 'box': box} for f in frames]}
    def name(frames, detections, box=(100, 100, 200, 200), vocabulary=None):
        return ov.answer([item(box, *frames)], fake_detect(detections, vocabulary))[0]['1']
    cart = ('golf cart', .5, (95, 95, 205, 210))
    assert name(['a', 'b'], {'a': [cart], 'b': [cart]}) == {'label': 'golf cart', 'category': 'vehicle', 'confidence': 'high',
                                                            'reason': "'golf cart' detected in 2 of 2 views"}
    assert name(['a'], {'a': [cart]})['confidence'] == 'medium'
    weak = ('golf cart', .22, (120, 120, 230, 230))
    assert name(['a'], {'a': [weak]})['confidence'] == 'low'
    assert name(['a'], {'a': [cart, ('stack of tires', .5, (100, 100, 195, 200))]})['label'] == 'tire stack and golf cart'
    assert name(['a'], {'a': [('golf cart', .9, (0, 0, 900, 900))]})['label'] == 'unknown', 'a detection far larger than the object'
    assert name(['a'], {'a': [('person', .9, (95, 95, 205, 210))]})['label'] == 'unknown', 'a phrase outside the vocabulary never names'
    # a site vocabulary replaces the default one entirely
    assert name(['a'], {'a': [cart]}, vocabulary=['pallet rack'])['label'] == 'unknown'
    assert name(['a'], {'a': [('pallet rack', .5, (95, 95, 205, 210))]}, vocabulary=['pallet rack'])['label'] == 'pallet rack'


def test_the_scene_step_records_the_snapshot_and_vocabulary_that_named(views, tmp_path, monkeypatch):
    monkeypatch.delenv('ANTHROPIC_API_KEY', raising=False)
    plain = detections_on_the_objects(views, lambda n, height: 'refrigerator' if height == 0.9 else 'person')
    detect = (lambda path: plain(path)); detect.vocabulary = ov.parse_vocabulary(None)
    detect.model = {**ov.MODEL, 'path': '/models/owlv2', 'snapshot_digest': 'f' * 64, 'min_score': ov.MIN_SCORE, 'device': 'cpu'}
    request = {'source': {'job': 'a' * 32, 'path': str(tmp_path)}}
    path, evidence = su.name_step(cloud(), request, tmp_path, views=views, detect=detect)
    assert evidence['status'] == 'named' and evidence['provider'] == 'on-worker detector' and evidence['crops_sent'] == 0
    assert evidence['requested_model'] == 'f' * 64 and evidence['prompt_version'] == ov.RULES_VERSION
    assert evidence['model']['provider'] == ov.PROVIDER and 'golf cart' in evidence['model']['vocabulary']
    by_label = {o['label']: o for o in json.loads(path.read_text())['objects']}
    assert by_label['refrigerator']['category'] == 'appliance' and by_label['unknown']['confidence'] == 'low'


def test_the_namer_loads_only_a_local_owlv2_snapshot(tmp_path):
    with pytest.raises(ValueError, match='never downloads'):
        ov.load(tmp_path)
    (tmp_path / 'config.json').write_text(json.dumps({'model_type': 'efficientdet'}))
    with pytest.raises(ValueError, match='not an OWLv2'):
        ov.load(tmp_path)
    (tmp_path / 'config.json').write_text(json.dumps({'model_type': 'owlv2'}))
    with pytest.raises(ValueError):
        ov.load(tmp_path, ['unknown'])   # the vocabulary is checked before any weights load
    assert ov.snapshot_digest(tmp_path) == ov.snapshot_digest(tmp_path) and len(ov.snapshot_digest(tmp_path)) == 64
