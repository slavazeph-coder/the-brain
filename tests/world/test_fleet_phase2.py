"""Fleet Phase 2 requires exact sources, conservative geometry and honest negatives."""
import copy
import json
import shutil
from pathlib import Path
import tempfile
import unittest

from robotics.world_worker.fleet_campaign import (sample_fixture,evaluate_campaign,
    goal_only_astar,generate_heldout_starts)
from robotics.world_worker.fleet_nav2 import (load_nav2_map,import_reviewed_episode,
    world_point_clear,digest,MapBundle,csv_pose_samples,json_strict)
from robotics.world_worker.fleet_learning import GridScene,Robot,Episode,sample_scenario


class FleetPhase2Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixtures=tempfile.TemporaryDirectory()
        cls.fixture_root=Path(cls.fixtures.name)/'sample'
        cls.fixture_report=sample_fixture(cls.fixture_root)

    @classmethod
    def tearDownClass(cls):
        cls.fixtures.cleanup()

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)/'sample'
        shutil.copytree(self.fixture_root,self.root)
        self.report=copy.deepcopy(self.fixture_report)
        self.map=load_nav2_map(self.root/'candidate-map')
        self.reference=load_nav2_map(self.root/'reference-map')
        self.csv=(self.root/'robot-poses.csv').read_bytes()
        self.manifest=json.loads((self.root/'telemetry-manifest.json').read_text())
        self.episode,self.receipt=import_reviewed_episode(self.map,self.manifest,self.csv)

    def import_with(self,**overrides):
        data={**self.manifest,**overrides}
        return import_reviewed_episode(self.map,data,self.csv)

    def test_deterministic_replay_and_report(self):
        self.assertEqual(self.report,evaluate_campaign(self.map,self.reference,self.episode,
                                                        Robot('Follower B | wide',.54,.35)))
        self.assertEqual(self.report['summary']['heldout_case_count'],24)
        self.assertEqual(self.report['summary']['baseline']['reference_clear'],21)
        self.assertEqual(self.report['summary']['transfer']['reference_clear'],17)
        self.assertEqual(self.report['summary']['false_free_coordinates'],[[8,11]])
        self.assertEqual(self.report['summary']['mean_transfer_minus_baseline_m'],0)
        self.assertFalse(any(self.report['claims'].values()))
        self.assertIn('same-scene held-out',self.report['scope'])

    def test_heldout_starts_exclude_source_path(self):
        starts=generate_heldout_starts(self.map.scene,Robot('wide',.54,.35),self.episode)
        self.assertEqual(len(set(starts)),24)
        self.assertFalse(set(starts)&set(self.episode.path))

    def test_source_receipt_distinguishes_reported_from_verified(self):
        self.assertEqual(self.receipt['source_type'],'authored-synthetic')
        self.assertFalse(self.receipt['recording_authenticity_independently_verified'])
        self.assertFalse(self.receipt['physical_robot_validated'])
        self.assertEqual(self.receipt['raw_sample_count'],20)
        self.assertEqual(self.receipt['source_sha256'],digest(self.csv))
        self.assertEqual(self.receipt['scale_basis'],'authored-synthetic-meters')

    def test_source_frame_is_explicitly_map(self):
        with self.assertRaisesRegex(ValueError,'Map-frame ENU'):
            self.import_with(pose_frame_id='odom')
        with self.assertRaisesRegex(ValueError,'Map-frame ENU'):
            self.import_with(coordinate_convention='ROS-REP-105')

    def test_consent_review_and_success_required(self):
        for key,value in [('learning_consent',False),('reviewed',False),('outcome','failure')]:
            with self.subTest(key=key),self.assertRaisesRegex(ValueError,'Successful operator-reviewed'):
                self.import_with(**{key:value})

    def test_source_hash_and_revision_must_match(self):
        for key in ('csv_sha256','map_revision_sha256','pgm_sha256'):
            with self.subTest(key=key),self.assertRaises(ValueError):
                self.import_with(**{key:'0'*64})

    def test_mutated_pgm_rejected_even_if_manifest_present(self):
        pgm=self.root/'candidate-map'/'nav2-map.pgm'
        data=bytearray(pgm.read_bytes());data[-16]=0 if data[-16]!=0 else 254;pgm.write_bytes(data)
        with self.assertRaisesRegex(ValueError,'checksum'):
            load_nav2_map(pgm.parent)

    def test_changed_nav2_manifest_invalidates_telemetry(self):
        p=self.root/'candidate-map'/'nav2-map.json';data=json.loads(p.read_text());data['scale']['source']='operator-typed-new-scale'
        p.write_text(json.dumps(data))
        changed=load_nav2_map(p.parent)
        with self.assertRaisesRegex(ValueError,'Map revision'):
            import_reviewed_episode(changed,self.manifest,self.csv)

    def test_map_rejects_unknown_pgm(self):
        pgm=self.root/'candidate-map'/'nav2-map.pgm';data=bytearray(pgm.read_bytes());data[-1]=128;pgm.write_bytes(data)
        with self.assertRaisesRegex(ValueError,'checksum'):
            load_nav2_map(pgm.parent)

    def test_realistic_boundary_point_near_obstacle_refused(self):
        # Cell centre is clear; its extreme left side is within the disc radius of obstacle.
        s=self.map.scene.cell_size_m;cx,cy=self.map.centre(11,7)
        self.assertTrue(self.map.scene.clear(11,7,.20))
        self.assertFalse(world_point_clear(self.map,cx+s*.49,cy,.20))

    def test_pose_interpolation_crossing_obstacle_fails(self):
        # Deliberately teleport across a wall; speed gate rejects before learning.
        text=self.csv.decode().splitlines();parts=text[1].split(',');parts[1]='9.4';text[1]=','.join(parts)
        new='\n'.join(text)+'\n';raw=new.encode()
        m={**self.manifest,'csv_sha256':digest(raw)}
        with self.assertRaisesRegex(ValueError,'Source sample|Unphysical|Pose segment'):
            import_reviewed_episode(self.map,m,raw)

    def test_bad_frame_in_sample_line(self):
        lines=self.csv.decode().splitlines();lines[1]=lines[1].replace(',map',',odom');raw=('\n'.join(lines)+'\n').encode()
        with self.assertRaisesRegex(ValueError,'frame'):
            import_reviewed_episode(self.map,{**self.manifest,'csv_sha256':digest(raw)},raw)

    def test_nonmonotonic_timestamp(self):
        lines=self.csv.decode().splitlines();parts=lines[3].split(',');parts[0]='1000000000';lines[3]=','.join(parts)
        raw=('\n'.join(lines)+'\n').encode()
        with self.assertRaisesRegex(ValueError,'reversed|gap'):
            import_reviewed_episode(self.map,{**self.manifest,'csv_sha256':digest(raw)},raw)

    def test_large_pose_gap(self):
        lines=self.csv.decode().splitlines()
        for i in range(2,len(lines)):
            parts=lines[i].split(',');parts[0]=str(int(parts[0])+4_000_000_000);lines[i]=','.join(parts)
        raw=('\n'.join(lines)+'\n').encode()
        with self.assertRaisesRegex(ValueError,'gap'):
            import_reviewed_episode(self.map,{**self.manifest,'csv_sha256':digest(raw)},raw)

    def test_high_std_rejected(self):
        lines=self.csv.decode().splitlines();parts=lines[1].split(',');parts[6]='0.5';lines[1]=','.join(parts)
        with self.assertRaisesRegex(ValueError,'localization uncertainty'):
            csv_pose_samples(('\n'.join(lines)+'\n').encode())

    def test_nan_pose_rejected(self):
        lines=self.csv.decode().splitlines();parts=lines[1].split(',');parts[2]='NaN';lines[1]=','.join(parts)
        with self.assertRaisesRegex(ValueError,'Nonfinite'):
            csv_pose_samples(('\n'.join(lines)+'\n').encode())

    def test_duplicate_json_properties_rejected(self):
        with self.assertRaisesRegex(ValueError,'Duplicate JSON'):
            json_strict(b'{"schema":"a","schema":"b"}')

    def test_reference_alignment_required(self):
        altered=MapBundle(self.reference.scene,(0,100),self.reference.revision_sha256,
                          self.reference.pgm_sha256,self.reference.source_scene_sha256,None,
                          self.reference.basis)
        with self.assertRaisesRegex(ValueError,'same frame'):
            evaluate_campaign(self.map,altered,self.episode,Robot('wide',.54,.35))

    def test_both_arms_use_same_goal_and_source_heldout(self):
        for case in self.report['cases']:
            self.assertEqual(case['goal'],list(self.episode.path[-1]))
            self.assertNotEqual(case['start'],list(self.episode.path[0]))
            self.assertEqual(case['baseline']['status'],'planned')
            self.assertEqual(case['transfer']['status'],'planned')
            self.assertLessEqual(case['baseline']['route_m'],case['transfer']['route_m']+0.00001)

    def test_no_access_to_physical_actuation(self):
        self.assertEqual(self.report['status'],'offline-static-grid-evaluation')
        self.assertFalse(self.report['claims']['real_robot_executed'])
        self.assertFalse(self.report['claims']['fleet_policy_trained'])
        self.assertFalse(self.report['claims']['independent_survey_verified'])
        self.assertEqual(self.report['reference_basis'],'authored-synthetic-meters')

    def test_invalid_campaign_size_fails_closed(self):
        with self.assertRaisesRegex(ValueError,'20..50'):
            generate_heldout_starts(self.map.scene,Robot('wide',.54,.35),self.episode,4)

    def test_no_empty_raster_false_free_division(self):
        rows=('????','????','????','????')
        mapb=MapBundle(GridScene(rows,.4,'test'),(0,1.6),'a'*64,'b'*64,'c'*64,None,'authored-synthetic')
        self.assertEqual(mapb.scene.width,4)
        with self.assertRaises(ValueError):
            goal_only_astar(mapb.scene,Robot('a',.2,.2),(1,1),(2,2))


if __name__=='__main__':unittest.main()
