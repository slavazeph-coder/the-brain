"""Synthetic observation contracts. These tests do not validate robot locomotion."""
import copy
import json
import math
from pathlib import Path
import subprocess
import sys
import unittest
from robotics.world_worker import foothold_perception as f
from robotics.world_worker import fpm_bridge as model


def cloud_fixture():
    pts=[]
    for iy in range(21):
        for ix in range(33):
            x,z=-.8+ix*.05,.5-iy*.05
            # Two different observations in each 5 cm cell, not duplicated points.
            h=.1 if ix>=19 else 0.
            pts.extend([[x,h,z,100,100,100],[x+.001,h,z-.001,100,100,100]])
    return {'units':'m','coordinateFrame':'right-handed-y-up','points':pts}


def query():
    return {'schema':'brainsnn.foothold-query.v1','base_position_brainsnn_m':[0,.8,0],
            'yaw_rad':0,'footholds_base_xy_m':[[0,.1],[0,-.1]],'min_points':2,'max_spread_m':.03}


class FootholdTests(unittest.TestCase):
    def test_layout_and_input_count(self):
        scan=[i/1000 for i in range(693)];r=f.sample_patches(scan,[[0,.1],[.1,-.1]])
        self.assertEqual(len(r['observation_raw']),102)
        self.assertEqual(r['observation_raw'][:2],[0,.1]);self.assertEqual(r['observation_raw'][51:53],[.1,-.1])
        self.assertEqual(r['patches'][0]['indices'][:7],[310,343,376,409,442,475,508])
    def test_empty_cell_withholds_entire_observation(self):
        scan=[.2]*693;scan[310]=None;r=f.sample_patches(scan,[[0,.1],[0,-.1]])
        self.assertIsNone(r['observation_raw']);self.assertIsNone(r['observation_clipped'])
        self.assertEqual(r['patches'][0]['known_count'],48)
    def test_boundary_does_not_clamp_and_duplicate_ground(self):
        r=f.sample_patches([0.]*693,[[.8,.5],[0,0]])
        self.assertEqual(r['patches'][0]['known_count'],16)
        self.assertIn('outside-map',r['patches'][0]['status']);self.assertFalse(r['sample_complete'])
    def test_distinct_base_and_sensor_coordinates(self):
        r=f.sample_patches([.1]*693,[[.1,.2],[.2,-.1]],[[0,0],[0,0]])
        self.assertEqual(r['observation_raw'][:2],[.1,.2]);self.assertEqual(r['patches'][0]['anchor_xy'],[16,10])
    def test_clipping_matches_actor_bounds_without_changing_raw(self):
        r=f.sample_patches([2.]*693,[[0,0],[0,0]])
        self.assertEqual(r['observation_raw'][2],2);self.assertEqual(r['observation_clipped'][2],1)
    def test_rejects_bad_inputs(self):
        for scan in ([0.]*692,[True]*693,[float('nan')]*693,['0']*693):
            with self.subTest(scan_type=type(scan[0])),self.assertRaises(ValueError):f.sample_patches(scan,[[0,0],[0,0]])
        for feet in ([],[[0,0]],[[False,0],[0,0]],[[float('inf'),0],[0,0]]):
            with self.assertRaises(ValueError):f.sample_patches([0.]*693,feet)
    def test_point_binning_records_evidence_without_mutation(self):
        cloud=cloud_fixture();before=copy.deepcopy(cloud);r=f.inspect_cloud(cloud,query())
        self.assertTrue(r['sample_complete']);self.assertEqual(cloud,before)
        self.assertEqual(r['foothold_basis'],'operator-query-not-model-prediction')
        for k in ('metric_verified','checkpoint_compatible','physics_executed','robot_control_enabled'):self.assertFalse(r[k])
    def test_mixed_heights_are_unknown_not_averaged_into_a_ramp(self):
        cloud=cloud_fixture();cloud['points'].append([0,.2,0])
        grid=f.cloud_grid(cloud,[0,.8,0]);self.assertEqual(grid['cell_status'][346],'mixed-height');self.assertIsNone(grid['height_scan'][346])
    def test_no_interpolation_into_missing_cells(self):
        cloud=cloud_fixture();cloud['points']=[p for p in cloud['points'] if abs(p[0])>.02 or abs(p[2])>.02]
        grid=f.cloud_grid(cloud,[0,.8,0]);self.assertEqual(grid['cell_status'][346],'unobserved')
    def test_insufficient_points(self):
        cloud={'units':'m','coordinateFrame':'right-handed-y-up','points':[[0,0,0]]}
        self.assertEqual(f.cloud_grid(cloud,[0,.8,0])['cell_status'][346],'insufficient-points')
    def test_yaw_and_y_up_conversion(self):
        cloud={'units':'m','coordinateFrame':'right-handed-y-up','points':[[1,2,2.8],[1.001,2,2.799]]}
        grid=f.cloud_grid(cloud,[1,2.8,3],math.pi/2)
        self.assertAlmostEqual(grid['height_scan'][10*33+20],.3)
    def test_metric_and_frame_required(self):
        for key,value in [('units','arbitrary'),('coordinateFrame','right-handed-z-up')]:
            cloud=cloud_fixture();cloud[key]=value
            with self.assertRaises(ValueError):f.inspect_cloud(cloud,query())
    def test_bounds_and_nonfinite_points(self):
        for points in ([],[[float('nan'),0,0]],[[10001,0,0]],[[1,2]],[[True,0,0]]):
            with self.assertRaises(ValueError):f.cloud_grid({'units':'m','coordinateFrame':'right-handed-y-up','points':points},[0,.8,0])
    def test_thresholds_bounded(self):
        for kw in ({'min_points':True},{'min_points':0},{'min_points':1.5},{'max_spread_m':0},{'max_spread_m':1}):
            with self.assertRaises(ValueError):f.cloud_grid(cloud_fixture(),[0,.8,0],**kw)
    def test_javascript_and_python_agree(self):
        script="import {inspectCloud} from './brainsnn-r3f-app/public/world/foothold-focus.mjs';let s='';for await(const c of process.stdin)s+=c;const x=JSON.parse(s);console.log(JSON.stringify(inspectCloud(x.cloud,x.query)));"
        for yaw in (0,.3,math.pi/2):
            q=query();q['yaw_rad']=yaw;c=cloud_fixture();expected=f.inspect_cloud(c,q)
            actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',script],input=json.dumps({'cloud':c,'query':q}).encode()))
            self.assertEqual(actual['validity_mask'],expected['validity_mask'])
            for ap,ep in zip(actual['patches'],expected['patches']):
                self.assertEqual(ap['indices'],ep['indices'])
                for a,e in zip(ap['heights'],ep['heights']):
                    if e is None:self.assertIsNone(a)
                    else:self.assertAlmostEqual(a,e,places=12)


class ModelContractTests(unittest.TestCase):
    def test_download_requires_explicit_license_review(self):
        with self.assertRaises(ValueError):model.download('/never-created')
    def test_state_contract_is_not_an_actor_observation(self):
        for payload in ({},{'layout':'actor','joint_order_reviewed':True,'states':[[0]*70]},
                        {'layout':model.LAYOUT,'joint_order_reviewed':True,'states':[[0]*69]},
                        {'layout':model.LAYOUT,'joint_order_reviewed':True,'states':[[True]*70]},
                        {'layout':model.LAYOUT,'joint_order_reviewed':True,'states':[[float('nan')]*70]}):
            with self.assertRaises(ValueError):model.predict('/not-used',payload)
    def test_upright_snapshot_adapter_connects_predictions_to_terrain(self):
        from unittest.mock import patch
        state=[0.]*70;state[8]=-1
        payload={'layout':model.LAYOUT,'joint_order_reviewed':True,'states':[state]}
        with patch.object(model,'predict',return_value={'footholds_base_xy_m':[[[0,.1],[0,-.1]]],'prediction_executed':True}):
            report=model.observe('/not-used',payload,cloud_fixture(),query())
        self.assertEqual(report['foothold_basis'],'pinned-pretrained-fpm')
        self.assertEqual(len(report['observation_raw']),102)
        self.assertFalse(report['checkpoint_compatible'])
    def test_tilted_state_is_not_silently_treated_as_upright(self):
        state=[0.]*70;state[6]=.5;state[8]=-.86
        with self.assertRaisesRegex(ValueError,'upright'):
            model.observe('/not-used',{'states':[state]},cloud_fixture(),query())
    def test_unknown_model_bytes_never_deserialized(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'foot_model_10002.pt';p.write_bytes(b'0'*121778)
            with self.assertRaisesRegex(ValueError,'pinned upstream'):
                model.predict(d,{'layout':model.LAYOUT,'joint_order_reviewed':True,'states':[[0]*70]})


if __name__=='__main__':unittest.main()
