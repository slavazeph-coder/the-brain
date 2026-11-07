"""Stdlib-only regression tests: synthetic geometry and explicit non-claims."""
import dataclasses
import unittest
from robotics.world_worker.fleet_learning import (
    GridScene, Robot, Episode, validate_episode, retrieve,
    plan_transfer, sample_scenario,
)


class FleetLearningTests(unittest.TestCase):
    def setUp(self):
        self.scene, self.teacher, self.follower, self.result = sample_scenario()

    def test_teacher_uses_narrow_door_and_follower_detours(self):
        self.assertEqual([(x,y) for x,y in self.teacher.path if x in (12,13)],[(12,10),(13,10)])
        self.assertEqual([(x,y) for x,y in self.result['path_cells'] if x in (12,13)],[(12,3),(13,3)])
        self.assertGreater(len(self.result['path_cells']), len(self.teacher.path))
        self.assertTrue(all(self.scene.clear(*point,self.follower.footprint_radius_m) for point in self.result['path_cells']))
        self.assertFalse(self.result['policy_finetuned'])
        self.assertFalse(self.result['physical_robot_validated'])

    def test_unknown_and_occupied_are_never_free(self):
        self.assertFalse(self.scene.clear(22,15,0.2))
        self.assertFalse(self.scene.clear(12,7,0.2))
        self.assertFalse(self.scene.clear(0,5,0.2))

    def test_no_failed_episode_in_training_memory(self):
        failed=dataclasses.replace(self.teacher,succeeded=False)
        self.assertEqual(retrieve(self.scene,self.teacher.task,[failed,self.teacher],(22,10)),self.teacher)
        with self.assertRaisesRegex(ValueError,'No reviewed'):
            retrieve(self.scene,self.teacher.task,[failed],(22,10))

    def test_unreviewed_success_excluded(self):
        unreviewed=dataclasses.replace(self.teacher,outcome_reviewed=False)
        with self.assertRaisesRegex(ValueError,'No reviewed'):
            retrieve(self.scene,self.teacher.task,[unreviewed],(22,10))

    def test_scene_mismatch_rejected(self):
        another=dataclasses.replace(self.teacher,scene_sha256='0'*64)
        with self.assertRaisesRegex(ValueError,'Scene fingerprint mismatch'):
            plan_transfer(self.scene,another,self.follower,(3,10),(22,10))

    def test_different_task_rejected(self):
        with self.assertRaisesRegex(ValueError,'No reviewed'):
            retrieve(self.scene,'paint ceiling',[self.teacher],(22,10))

    def test_illegal_trajectory_rejected(self):
        invalid=dataclasses.replace(self.teacher,path=((3,10),(13,10)))
        with self.assertRaisesRegex(ValueError,'non-adjacent'):
            validate_episode(self.scene,invalid)

    def test_nonfinite_footprints_rejected(self):
        with self.assertRaises(ValueError):
            Robot('invalid',float('nan'),0.1)
        with self.assertRaises(ValueError):
            Robot('invalid',0.3,float('inf'))

    def test_path_can_be_blocked_for_larger_robot(self):
        giant=Robot('too-wide',1.1,0.1)
        with self.assertRaisesRegex(ValueError,'clearance-safe|No footprint-safe'):
            plan_transfer(self.scene,self.teacher,giant,(3,10),(22,10))

    def test_boundary_and_unknown_rejected_as_start_or_goal(self):
        with self.assertRaisesRegex(ValueError,'not clearance-safe'):
            plan_transfer(self.scene,self.teacher,self.follower,(1,2),(22,10))

    def test_deterministic_result(self):
        self.assertEqual(plan_transfer(self.scene,self.teacher,self.follower,(3,10),(22,10)),self.result)


if __name__=='__main__':unittest.main()
