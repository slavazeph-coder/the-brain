"""Stand-in placement rules (no Blender): which named objects get a real-size model, which are refused and why, and
what a catalog must declare."""
from pathlib import Path
import json
import sys

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'robotics' / 'world_worker'))
import stand_ins as si  # noqa: E402

CATALOG = ROOT / 'robotics' / 'world_worker' / 'catalog'


def obj(label, size, confidence='high', kind='separated'):
    return {'name': 'object_1', 'label': label, 'kind': kind, 'size': size, 'centre': [0, 0, 0], 'yaw_degrees': 0, 'labelConfidence': confidence}


def test_the_shipped_catalog_declares_licence_source_and_real_size_for_every_model():
    assets = si.load_catalog(CATALOG)
    assert {'golf cart', 'tire stack', 'tire'} <= set(assets)
    for a in assets.values():
        assert a['license'].startswith('CC0') and a['source'].startswith('https://') and a['path'].is_file()
        assert 0.1 < a['length_m'] < 10 and 0.1 < a['height_m'] < 5
    assert assets['stack of tires']['file'] == 'tire-stack.glb', 'aliases resolve to the same model'


def test_a_named_object_of_about_the_right_size_gets_its_model_and_everything_else_is_refused_with_a_reason():
    assets = si.load_catalog(CATALOG)
    asset, reason = si.decide(obj('golf cart', [2.9, 1.8, 1.5]), assets)
    assert asset['file'] == 'golf-cart.glb' and reason is None
    asset, reason = si.decide(obj('golf cart', [5.5, 1.8, 3.5]), assets)
    assert asset is None and reason.startswith('cluster:'), 'a row of carts is not one cart'
    asset, reason = si.decide(obj('golf cart', [0.4, 0.3, 0.3]), assets)
    assert asset is None and 'too small' in reason
    asset, reason = si.decide(obj('golf cart', [2.6, 1.8, 1.3], confidence='low'), assets)
    assert asset is None and 'below medium' in reason
    asset, reason = si.decide(obj('television', [0.3, 0.2, 0.1]), assets)
    assert asset is None and reason == 'no catalog model for this label'
    assert si.decide(obj('object', [1, 1, 1]), assets) == (None, None), 'unnamed objects are not even reported'
    assert si.decide({**obj('golf cart', [2.6, 1.8, 1.3]), 'kind': 'detected'}, assets) == (None, None)
    asset, _ = si.decide(obj('Stack of tires', [0.8, 1.0, 0.8], confidence='medium'), assets)
    assert asset['file'] == 'tire-stack.glb', 'labels match case-insensitively through aliases'


def test_a_catalog_must_be_complete_and_local(tmp_path):
    (tmp_path / 'catalog.json').write_text(json.dumps({'schema': 'other'}))
    with pytest.raises(ValueError, match='not a brainsnn.stand-in-catalog.v1'):
        si.load_catalog(tmp_path)
    (tmp_path / 'catalog.json').write_text(json.dumps({'schema': 'brainsnn.stand-in-catalog.v1', 'assets': [{'label': 'x', 'file': 'x.glb', 'license': 'CC0', 'source': 's', 'length_m': 1, 'width_m': 1}]}))
    with pytest.raises(ValueError, match='missing height_m'):
        si.load_catalog(tmp_path)
    (tmp_path / 'catalog.json').write_text(json.dumps({'schema': 'brainsnn.stand-in-catalog.v1', 'assets': [{'label': 'x', 'file': 'x.glb', 'license': 'CC0', 'source': 's', 'length_m': 1, 'width_m': 1, 'height_m': 1}]}))
    with pytest.raises(ValueError, match='not a .glb file in the catalog directory'):
        si.load_catalog(tmp_path)
