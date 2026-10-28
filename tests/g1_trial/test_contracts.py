import copy
import json
import math
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from robotics.g1_trial.contracts import validate, y_to_z, outcome, read_json, verify_locked
from robotics.g1_trial.runtime import preflight


def spec():
    return {'schema':'brainsnn.g1-trial.v1','reviewed':True,'source_kind':'synthetic',
        'source_sha256':{k:'a'*64 for k in ('scene.json','arena-cloud.json','scene.usda')},
        'collision_prims':['/World/Floor','/World/Threshold'],'reviewed_bounds_xz_m':[0,0,6,4],
        'start_ground_y_up_m':[1.2,0,2],'goal_ground_y_up_m':[4.8,0,2],
        'yaw_rad':0,'duration_s':20,'speed_m_s':.3,'goal_tolerance_m':.2,
        'friction':{'static':1.,'dynamic':.8,'basis':'simulation-assumption'}}


class Contracts(unittest.TestCase):
    def test_synthetic_source_label_must_match(self):
        s=spec();c={'units':'m','coordinateFrame':'right-handed-y-up','provenance':{'synthetic':True}}
        validate(s,c);c['provenance']['synthetic']=False
        with self.assertRaises(ValueError):validate(s,c)

    def test_metres_are_not_measurement_evidence(self):
        s=spec();s['source_kind']='captured'
        with self.assertRaisesRegex(ValueError,'withheld'):
            validate(s,{'units':'m','coordinateFrame':'right-handed-y-up','provenance':{}})

    def test_nonfinite_limits_and_booleans_rejected(self):
        for key,value in [('speed_m_s',True),('duration_s',31),('yaw_rad',float('nan')),('goal_tolerance_m',1)]:
            with self.subTest(key=key):
                s=spec();s[key]=value
                with self.assertRaises(ValueError):validate(s)

    def test_outside_start_and_goal_at_spawn_rejected(self):
        s=spec();s['start_ground_y_up_m']=[-1,0,2]
        with self.assertRaises(ValueError):validate(s)
        s=spec();s['goal_ground_y_up_m']=s['start_ground_y_up_m']
        with self.assertRaises(ValueError):validate(s)

    def test_coordinate_transform_preserves_distance_and_handedness(self):
        self.assertEqual(y_to_z([1,2,3]),[1,-3,2])
        self.assertEqual(math.dist(y_to_z([1,2,3]),y_to_z([4,5,6])),math.sqrt(27))

    def test_fall_and_contact_override_goal(self):
        s=spec()
        self.assertEqual(outcome([4.8,.78,2],0,False,s),'goal_reached')
        self.assertEqual(outcome([4.8,.78,2],.7,False,s),'fallen_or_body_contact')
        self.assertEqual(outcome([4.8,.78,2],0,True,s),'fallen_or_body_contact')
        self.assertEqual(outcome([1.2,.78,2],0,False,s),None)
        self.assertEqual(outcome([7,.78,2],0,False,s),'left_reviewed_bounds')

    def test_duplicate_and_nonfinite_json_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'input.json'
            for text in ('{"reviewed":true,"reviewed":false}','{"x":NaN}'):
                p.write_text(text)
                with self.assertRaises(ValueError):read_json(p)

    def test_unknown_model_rejected_before_loading(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'model.pt';p.write_bytes(b'not a model')
            with self.assertRaises(ValueError):verify_locked(p,'demo/model_10000.pt')

    def test_gpu_preflight_blocks_absence(self):
        with patch('robotics.g1_trial.runtime.subprocess.check_output',side_effect=FileNotFoundError):
            r=preflight()
        self.assertEqual(r['status'],'blocked');self.assertFalse(r['physics_executed'])
        self.assertIn('A queryable NVIDIA GPU is not available',r['blockers'])

    def test_calibration_is_not_a_withheld_check(self):
        s=spec();s['source_kind']='captured';points=[[0,0,0],[1,0,0],[0,0,1],[1,0,1],[0,1,0]]
        cloud={'units':'m','coordinateFrame':'right-handed-y-up','points':points,'provenance':{}}
        def row(pair,role='withheld'):
            return {'point_indices':pair,'role':role,'distance_m':math.dist(points[pair[0]],points[pair[1]]),
                'tolerance_m':.01,'method':'synthetic tape fixture','independently_measured':True}
        s['measurements']=[row([0,1],'calibration'),row([0,2]),row([0,4]),row([1,3])]
        validate(s,cloud)
        s['measurements'][-1]=row([1,0])
        with self.assertRaisesRegex(ValueError,'reused'):validate(s,cloud)

    def test_failed_dimension_is_not_hidden(self):
        s=spec();s['source_kind']='captured';s['measurements']=[{'role':'calibration','point_indices':[0,1],'distance_m':2,
          'tolerance_m':.01,'method':'fixture','independently_measured':True}]+[{'role':'withheld'}]*3
        with self.assertRaisesRegex(ValueError,'check failed'):
            validate(s,{'units':'m','coordinateFrame':'right-handed-y-up','points':[[0,0,0],[1,0,0]]})

if __name__=='__main__':unittest.main()
