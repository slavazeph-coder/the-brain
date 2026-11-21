import hashlib
import importlib.util
import json
from pathlib import Path

import numpy as np
from PIL import Image
import pytest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('walk_evaluation', ROOT / 'scripts/world-demo/evaluate_showroom_walk.py')
walk = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(walk)


def write(path, value):
    path.write_text(json.dumps(value))
    return path


def image(path, color):
    Image.new('RGB', (16, 12), color).save(path)
    return path


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture
def inputs(tmp_path):
    p = tmp_path
    images = p/'sources'
    images.mkdir()
    cameras = []
    for i, name in enumerate(['first.png','last.png']):
        image(images/name, (i*100,0,0))
        cameras.append(dict(image=name, parameters=[16,8,6], width=16,height=12,
                            world_to_camera=[[1,0,0,-i],[0,1,0,0],[0,0,1,0]]))
    return dict(cameras=write(p/'cameras.json',{'cameras':cameras}), images=images,
                times=write(p/'times.json', {'first.png':{'timeSeconds':0},'last.png':{'timeSeconds':2}}),
                holdout_times=write(p/'times-held.json', {'withheld.png':{'timeSeconds':1}}), out=p/'pack')


def test_preparation_excludes_held_pixels_and_interpolates_camera(inputs):
    walk.prepare(**inputs)
    pack = inputs['out']
    assert {x.name for x in (pack/'images').iterdir()} == {'first.png','last.png'}
    target, = walk.load(pack/'requests.json')['targets']
    assert target['center'] == [0.5,0,0]
    assert target['worldToCamera'][0][3] == -.5
    assert target['bracketingInputs'] == ['first.png','last.png']
    with pytest.raises(ValueError, match='new output'):
        walk.prepare(**inputs)


def test_heldout_source_collision_aborts_before_creating_pack(inputs):
    write(inputs['holdout_times'], {'first.png':{'timeSeconds':1}})
    with pytest.raises(ValueError, match='separate'):
        walk.prepare(**inputs)
    assert not inputs['out'].exists()


def test_prediction_binding_geometry_coverage_and_matched_support(inputs,tmp_path):
    walk.prepare(**inputs)
    pack = inputs['out']
    p = tmp_path
    ref = image(p/'withheld.png',(50,50,50))
    candidate = image(p/'candidate.png',(60,60,60))
    mask = Image.new('L',(16,12),0)
    mask.putpixel((8,6),255)
    mask.save(p/'mask.png')
    np.savez(p/'cloud.npz',xyz=[[.5,0,2],[.5,0,1]],rgb=np.uint8([[255,0,0],[50,50,50]]))
    pred = {'schema':'brainsnn.walk-predictions.v1','method':'fixture',
            'requestSha256':sha(pack/'requests.json'),'targets':[{'id':ref.name,'image':candidate.name,
                'sha256':sha(candidate),'mask':'mask.png','maskSha256':sha(p/'mask.png')}]}
    kwargs = dict(pack=pack,references=p,cloud=p/'cloud.npz',out=p/'scores',width=16,
                  cloud_inputs=write(p/'cloud-inputs.json',{'images':['first.png','last.png']}),
                  predictions=write(p/'pred.json',pred))
    report = walk.score(**kwargs)
    row, = report['frames']
    assert row['geometryCoverage'] == round(1/192,6)
    assert row['coveredRgbMae']['geometryWithNearestFill'] == 0
    assert row['rgbMae']['submitted'] == 10
    assert row['submittedSupport']['pixels'] == 1
    assert row['submittedSupport']['rgbMae']['nearest'] == 50
    assert report['submittedSupport']['pixelWeightedRgbMae']['submitted'] == 10
    assert report['cloudInputProvenance']['declaredInputsDisjointFromTargets']
    pred['requestSha256'] = '0'*64
    write(p/'pred.json',pred)
    with pytest.raises(ValueError, match='digest'):
        walk.score(**{**kwargs,'out':p/'wrong'})
    assert not (p/'wrong').exists()


def test_metric_rejects_cloud_leakage_and_missing_targets(inputs,tmp_path):
    walk.prepare(**inputs)
    kwargs = dict(pack=inputs['out'],references=tmp_path,cloud=tmp_path/'unused',out=tmp_path/'scores')
    with pytest.raises(ValueError, match='outside'):
        walk.score(**kwargs,cloud_inputs=write(tmp_path/'receipt.json',{'images':['withheld.png']}))
    with pytest.raises(ValueError, match='exactly one'):
        walk.prediction_files(write(tmp_path/'pred.json',{
            'schema':'brainsnn.walk-predictions.v1','requestSha256':'x','targets':[],'method':'fixture'}),
            'x',[{'id':'withheld.png'}])


def test_mask_rejects_gray_values(tmp_path):
    pred = image(tmp_path/'candidate.png', (40,40,40))
    mask = image(tmp_path/'mask.png',(1,1,1))
    with pytest.raises(ValueError, match='black/white'):
        walk.load_support(mask,pred,(16,12))


def test_rounded_portrait_prediction_preserves_requested_framing(tmp_path):
    camera = {'width':720, 'height':1560}
    path = tmp_path/'portrait.png'
    Image.new('RGB',(103,224)).save(path)
    assert walk.raster(path,camera,(144,312),exact=False).shape == (312,144,3)
    Image.new('RGB',(109,224)).save(path)
    with pytest.raises(ValueError, match='framing'):
        walk.raster(path,camera,(144,312),exact=False)
