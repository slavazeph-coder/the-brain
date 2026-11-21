import importlib.util
from pathlib import Path
from base64 import b64decode
import numpy as np
import pytest

path = Path(__file__).resolve().parents[2] / 'scripts/world-demo/prepare_showroom_depth.py'
spec = importlib.util.spec_from_file_location('walk_depth',path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_source_calibration_and_closest_depth_scale_into_room_units():
    room = {'frames':[{'id':'a','width':3,'height':3,'camera':[1,3]}]}
    camera = {'image':'a','width':6,'height':6,'parameters':[6,3,3],
              'world_to_camera':np.c_[np.eye(3),np.zeros(3)].tolist()}
    transform = {'fromSource':np.c_[2*np.eye(3),[1,2,3]].tolist(),'floorEstimate':{'y':1}}
    points = np.array([[0,0,2.0],[0,0,1.1],[0,0,-1.0],[90,0,1]])
    coverage = module.prepare(room,[camera],transform,points,3)
    frame = room['frames'][0]
    assert frame['pose']['eye'] == [1.,1.,3.]
    assert frame['pose']['intrinsics'] == [3.,3.,1.5,1.5]
    assert coverage == [1/9]
    assert list(np.frombuffer(b64decode(frame['depth']['millimeters']),dtype='<u2')) == [0,0,0,0,2200,0,0,0,0]
    transform['fromSource'][0][0] = 5
    with pytest.raises(ValueError,match='uniform scale'):
        module.prepare(room,[camera],transform,points,3)
