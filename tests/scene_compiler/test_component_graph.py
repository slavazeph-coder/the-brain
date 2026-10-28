"""Identity/edit contracts on authored geometry, not physical capture validation."""
import copy
import hashlib
import json
import math
from pathlib import Path
import sys
import tempfile
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'robotics/scene_compiler'))
from component_graph import (EDIT_SCHEMA, attach_component_ids, apply_edits, derive_id,
                             ensure_component_ids, scene_sha256, source_sha256)
from opening_geometry import door_parts, wall_parts


def fixture():
    wall = {'name': 'wall_1', 'label': 'wall', 'provenance': 'observed',
            'centre': [2, 1.5, 0], 'size': [4, 3, .2], 'yaw_degrees': 0}
    return {'schema': 'brainsnn.scene.v1', 'source': 'authored-test.ply', 'units': 'm', 'floor_y': 0,
        'scale': {'distance': 4, 'metresPerUnit': 1, 'verified': False, 'selfReported': True},
        'provenance': {'floorAligned': True, 'note': 'Authored software fixture, not a phone capture'},
        'walls': [wall],
        'objects': [{'name': 'floor_observed', 'label': 'floor', 'provenance': 'observed',
                     'centre': [2, -.01, 2], 'size': [4, .02, 4], 'min': [0, -.02, 0], 'max': [4, 0, 4]},
                    {'name': 'object_1', 'label': 'chair', 'provenance': 'observed',
                     'centre': [2, .5, 2], 'size': [.5, 1, .5], 'yaw_degrees': 0},
                    {'name': 'object_2', 'label': 'unknown detection', 'provenance': 'detected-unplaced'}],
        'openings': [{'id': 'entry', 'hostWall': 'wall_1', 'kind': 'door', 'reviewed': True,
                      'offsetMeters': .5, 'widthMeters': .9, 'heightMeters': 2.1, 'sillMeters': 0,
                      'host': copy.deepcopy({key: wall[key] for key in ('centre', 'size', 'yaw_degrees')})},
                     {'id': 'window', 'hostWall': 'wall_1', 'kind': 'opening', 'reviewed': True,
                      'offsetMeters': 2, 'widthMeters': 1, 'heightMeters': 1, 'sillMeters': 1.2,
                      'host': copy.deepcopy({key: wall[key] for key in ('centre', 'size', 'yaw_degrees')})}],
        'unknown': [[3, 3, .5]], 'fit': {'old': 'fit receipt'}, 'ifc': {'written': True},
        'cad': {'old': 'CAD receipt'}, 'measurements': {'status': 'no-held-out'},
        'route': {'old': 'route receipt'}, 'navigation': {'old': 'navigation receipt'},
        'naming': {'model': 'test-model', 'named': 1}, 'scaleReviewed': True, 'mapReviewed': True,
        'bimReview': {'metricVerified': False, 'clearanceVerified': False, 'authority': 'operator-declared-review'}}


class ComponentGraph(unittest.TestCase):
    def setUp(self):
        self.original = fixture()
        self.scene = attach_component_ids(self.original, 'a' * 64)
        self.wall_id = self.scene['walls'][0]['componentId']
        self.door_id = self.scene['openings'][0]['componentId']

    def contract(self, edits, scene=None):
        scene = self.scene if scene is None else scene
        return {'schema': EDIT_SCHEMA, 'sourceSha256': scene['componentGraph']['sourceSha256'],
                'sceneSha256': scene_sha256(scene), 'revision': scene['componentGraph']['revision'], 'edits': edits}

    def test_deterministic_ids_are_source_scoped_and_leave_source_unchanged(self):
        before = copy.deepcopy(self.original)
        first = attach_component_ids(self.original, 'a' * 64)
        same = attach_component_ids(self.original, 'a' * 64)
        other = attach_component_ids(self.original, 'b' * 64)
        self.assertEqual(first, same)
        self.assertEqual(self.original, before)
        ids = [row['componentId'] for row in first['componentGraph']['components']]
        ids += [first['openings'][0]['doorComponentId']]
        self.assertEqual(len(ids), len(set(ids)))
        for identifier in ids:
            self.assertEqual(uuid.UUID(identifier).version, 5)
        self.assertTrue(set(ids).isdisjoint(row['componentId'] for row in other['componentGraph']['components']))
        self.assertEqual(first['openings'][0]['hostComponentId'], first['walls'][0]['componentId'])
        self.assertNotEqual(first['openings'][0]['componentId'], first['openings'][0]['doorComponentId'])
        self.assertEqual(ensure_component_ids(first), first)
        self.assertIsNot(ensure_component_ids(first), first)

    def test_legacy_namespace_excludes_semantic_names_and_export_receipts(self):
        first = fixture()
        second = fixture()
        second['walls'][0]['name'] = 'different_internal_wall_name'
        second['walls'][0]['label'] = 'North wall'
        second['objects'][1].update(name='different_object_name', label='Reviewed seat')
        for opening in second['openings']:
            opening['hostWall'] = 'different_internal_wall_name'
        second.update(ifc={'different': True}, cad={'different': True}, fit={'new': 1})
        self.assertEqual(source_sha256(first), source_sha256(second))
        a, b = ensure_component_ids(first), ensure_component_ids(second)
        self.assertEqual(a['walls'][0]['componentId'], b['walls'][0]['componentId'])
        self.assertEqual(a['componentGraph']['namespaceBasis'], 'legacy-scene-geometry-sha256')
        second['walls'][0]['centre'][0] += 1
        self.assertNotEqual(source_sha256(first), source_sha256(second))
        second = fixture(); second['source'] = 'another-capture.ply'
        self.assertNotEqual(source_sha256(first), source_sha256(second))

    def test_known_cloud_namespace_is_used_and_cannot_be_rebound(self):
        scene = fixture(); scene['cloudPointsSha256'] = 'c' * 64
        identified = ensure_component_ids(scene)
        self.assertEqual(source_sha256(identified), 'c' * 64)
        self.assertEqual(identified['componentGraph']['namespaceBasis'], 'supplied-source-sha256')
        with self.assertRaises(ValueError):
            attach_component_ids(scene, 'b' * 64)
        with self.assertRaises(ValueError):
            attach_component_ids(identified, 'a' * 64)

    def test_component_or_geometry_tampering_requires_controlled_edit(self):
        for mutate in (lambda s: s['walls'][0].update(componentId=str(uuid.uuid4())),
                       lambda s: s['walls'][0]['centre'].__setitem__(0, 9),
                       lambda s: s['openings'][0].update(hostComponentId=str(uuid.uuid4())),
                       lambda s: s['openings'][0].update(doorComponentId=str(uuid.uuid4())),
                       lambda s: s['componentGraph']['components'][1].update(componentId=self.wall_id)):
            bad = copy.deepcopy(self.scene); mutate(bad)
            with self.assertRaises(ValueError):
                ensure_component_ids(bad)
        partial = fixture(); partial['walls'][0]['componentId'] = str(uuid.uuid4())
        with self.assertRaises(ValueError):
            ensure_component_ids(partial)

    def test_export_receipts_can_change_without_rekeying_components(self):
        scene = copy.deepcopy(self.scene); scene['ifc'] = {'new': 'receipt'}; scene['fit'] = {'new': 'fit'}
        self.assertEqual(ensure_component_ids(scene)['walls'][0]['componentId'], self.wall_id)
        self.assertNotEqual(scene_sha256(scene), scene_sha256(self.scene))

    def test_wall_translation_and_rotation_move_hosted_door_in_local_coordinates(self):
        before = copy.deepcopy(self.scene)
        edit = self.contract([{'op': 'wall', 'componentId': self.wall_id,
                               'translationMeters': [1, .2, -2], 'yawDegrees': 90}])
        edited = apply_edits(self.scene, edit)
        self.assertEqual(self.scene, before)
        self.assertEqual(edited['walls'][0]['centre'], [3, 1.7, -2])
        hole = edited['openings'][0]
        self.assertEqual(hole['offsetMeters'], .5)
        self.assertEqual(hole['componentId'], self.door_id)
        self.assertEqual(hole['host'], {'centre': [3, 1.7, -2], 'size': [4, 3, .2], 'yaw_degrees': 90})
        door = door_parts(edited['walls'], edited['openings'])[0]
        self.assertAlmostEqual(door['centre'][0], 3)
        self.assertAlmostEqual(door['centre'][1], .2 + 2.1 / 2)
        self.assertAlmostEqual(door['centre'][2], -2 + .5 + .9 / 2 - 2)
        self.assertEqual(hole['reviewed'], True)
        self.assertTrue(hole['physicalReviewRequired'])

    def test_a_wall_edit_drops_the_compilers_face_placement(self):
        # The compiled box stood behind the face the camera saw; once an operator moves it, that face no longer bounds it
        # and a scorer reading faceCentre would measure the old position.
        original = fixture()
        original['walls'][0].update(faceCentre=[2, 1.5, .1], thicknessBasis='assumed 0.1 m: one face seen',
                                    thicknessMeasured=False, thicknessCandidate=True,
                                    wallEvidence={'schema': 'brainsnn.wall-evidence.v1', 'status': 'two-surface-candidate', 'thickness_m': .1})
        scene = attach_component_ids(original, 'a' * 64)
        edited = apply_edits(scene, self.contract([{'op': 'wall', 'componentId': self.wall_id,
                                                     'translationMeters': [0, 0, .3]}], scene))
        wall = edited['walls'][0]
        self.assertEqual(wall['centre'], [2, 1.5, .3])
        self.assertNotIn('faceCentre', wall)
        for key in ('thicknessBasis', 'thicknessMeasured', 'thicknessCandidate', 'wallEvidence'):
            self.assertNotIn(key, wall)
        from wall_evidence import thickness_properties
        self.assertEqual(thickness_properties(wall)['ThicknessBasis'], 'operator-authored thickness: unverified')
        self.assertIn('faceCentre', scene['walls'][0], 'the source scene keeps its record')

    def test_combined_wall_and_opening_resize_checks_final_geometry(self):
        edited = apply_edits(self.scene, self.contract([
            {'op': 'wall', 'componentId': self.wall_id, 'sizeMeters': [3, 2.5, .15]},
            {'op': 'opening', 'componentId': self.scene['openings'][1]['componentId'],
             'offsetMeters': 1.6, 'widthMeters': .7, 'heightMeters': .8, 'sillMeters': 1.2}]))
        self.assertEqual(edited['walls'][0]['size'], [3, 2.5, .15])
        self.assertEqual(edited['openings'][1]['host']['size'], [3, 2.5, .15])
        self.assertAlmostEqual(sum(math.prod(part['size']) for part in wall_parts(edited['walls'][0], edited['openings'])),
                               (3 * 2.5 - .9 * 2.1 - .7 * .8) * .15)

    def test_display_label_updates_preserve_internal_and_stable_names(self):
        target = self.scene['objects'][1]
        edited = apply_edits(self.scene, self.contract([{'op': 'label', 'componentId': target['componentId'],
                                                       'label': 'Operator seat'}]))
        self.assertEqual(edited['objects'][1]['name'], target['name'])
        self.assertEqual(edited['objects'][1]['componentId'], target['componentId'])
        self.assertEqual(edited['objects'][1]['label'], 'Operator seat')
        self.assertEqual(edited['objects'][1]['labelProvenance'], 'operator-authored-edit')
        self.assertNotIn('labelConfidence', edited['objects'][1])
        self.assertEqual(edited['objects'][1]['labelAuthority'], 'operator-declared')
        self.assertNotIn('naming', edited)
        self.assertIn('naming', self.scene)

    def test_edits_preserve_source_scale_provenance_and_invalidate_active_evidence(self):
        contract = self.contract([{'op': 'wall', 'componentId': self.wall_id, 'translationMeters': [.1, 0, 0]}])
        saved_contract = copy.deepcopy(contract)
        edited = apply_edits(self.scene, contract)
        self.assertEqual(edited['scale'], self.scene['scale'])
        self.assertEqual(edited['provenance'], self.scene['provenance'])
        self.assertEqual(contract, saved_contract)
        for key in ('fit', 'cad', 'ifc', 'measurements', 'route', 'navigation'):
            self.assertNotIn(key, edited)
        for key in ('metric_verified', 'metricVerified', 'certified', 'clearanceVerified',
                    'physicalRobotValidated', 'scaleReviewed', 'mapReviewed'):
            self.assertIs(edited[key], False)
        self.assertIs(edited['bimReview']['clearanceVerified'], False)
        graph = edited['componentGraph']
        self.assertEqual(graph['revision'], 1)
        self.assertEqual(graph['evidenceStatus'], 'invalidated-by-edit')
        self.assertEqual(graph['editHistory'][0]['parentSceneSha256'], scene_sha256(self.scene))
        raw = json.dumps(contract, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False).encode('ascii')
        self.assertEqual(graph['editHistory'][0]['contractSha256'], hashlib.sha256(raw).hexdigest())
        self.assertEqual(ensure_component_ids(edited), edited)

    def test_revision_chain_preserves_ids_and_refuses_old_contracts(self):
        first_contract = self.contract([{'op': 'wall', 'componentId': self.wall_id, 'yawDegrees': 20}])
        first = apply_edits(self.scene, first_contract)
        with self.assertRaises(ValueError):
            apply_edits(first, first_contract)
        second = apply_edits(first, self.contract([{'op': 'label', 'componentId': self.wall_id, 'label': 'North wall'}], first))
        self.assertEqual(second['componentGraph']['revision'], 2)
        self.assertEqual(second['walls'][0]['componentId'], self.wall_id)
        for field, value in (('revision', False), ('sceneSha256', '0' * 64), ('sourceSha256', 'b' * 64)):
            invalid = self.contract([{'op': 'wall', 'componentId': self.wall_id, 'yawDegrees': 30}])
            invalid[field] = value
            with self.assertRaises(ValueError):
                apply_edits(self.scene, invalid)

    def test_host_only_edit_marks_opening_and_fill_placement_authored(self):
        edited = apply_edits(self.scene, self.contract([
            {'op': 'wall', 'componentId': self.wall_id, 'translationMeters': [.1, 0, 0]}]))
        opening = edited['openings'][0]
        self.assertEqual(opening['provenance'], 'operator-authored-edit')
        self.assertEqual(opening['sourceProvenance'], 'operator-reviewed')
        self.assertEqual(opening['parameterProvenance']['hostPlacement'], 'operator-authored-edit')
        door = door_parts(edited['walls'], edited['openings'])[0]
        self.assertEqual(door['provenance'], 'operator-authored-edit')
        self.assertEqual(door['sourceProvenance'], 'operator-reviewed')
        self.assertEqual(door['componentId'], opening['doorComponentId'])
        self.assertEqual(door['support_points'], 0, 'A reference leaf cannot inherit observed wall point counts')
        self.assertNotIn('provenance', self.scene['openings'][0])

    def test_malformed_or_unsupported_edits_are_atomic(self):
        changes = [
            {'op': 'wall', 'componentId': self.wall_id},
            {'op': 'wall', 'componentId': self.wall_id, 'translationMeters': [0, 0, 0]},
            {'op': 'wall', 'componentId': self.wall_id, 'translationMeters': [0, 0]},
            {'op': 'wall', 'componentId': self.wall_id, 'translationMeters': [101, 0, 0]},
            {'op': 'wall', 'componentId': self.wall_id, 'sizeMeters': [True, 2, .1]},
            {'op': 'wall', 'componentId': self.wall_id, 'sizeMeters': [0, 2, .1]},
            {'op': 'wall', 'componentId': self.wall_id, 'yawDegrees': float('nan')},
            {'op': 'wall', 'componentId': self.wall_id, 'yawDegrees': float('inf')},
            {'op': 'wall', 'componentId': self.wall_id, 'yawDegrees': 361},
            {'op': 'opening', 'componentId': self.wall_id, 'widthMeters': 1},
            {'op': 'wall', 'componentId': self.door_id, 'yawDegrees': 1},
            {'op': 'opening', 'componentId': self.door_id, 'sillMeters': .1},
            {'op': 'opening', 'componentId': self.door_id, 'offsetMeters': 2.2},
            {'op': 'opening', 'componentId': self.door_id, 'widthMeters': 100},
            {'op': 'wall', 'componentId': str(uuid.uuid4()), 'yawDegrees': 1},
            {'op': 'label', 'componentId': self.wall_id, 'label': 'bad\nlabel'},
            {'op': 'label', 'componentId': self.wall_id, 'label': ''},
            {'op': 'label', 'componentId': self.wall_id, 'label': 'x' * 161},
            {'op': 'label', 'componentId': self.wall_id, 'label': 'safe', 'name': 'new_internal_name'},
            {'op': 'delete', 'componentId': self.wall_id},
            {'op': 'wall', 'componentId': self.wall_id, 'yawDegrees': 1, 'metric_verified': True}]
        before = copy.deepcopy(self.scene)
        for change in changes:
            with self.subTest(edit=repr(change)):
                with self.assertRaises(ValueError):
                    apply_edits(self.scene, self.contract([change]))
                self.assertEqual(self.scene, before)

    def test_batch_bounds_duplicate_operations_and_unknown_fields(self):
        one = {'op': 'wall', 'componentId': self.wall_id, 'yawDegrees': 3}
        for edits in ([], [one, one], [one] * 33, None):
            with self.assertRaises(ValueError):
                apply_edits(self.scene, self.contract(edits))
        bad = self.contract([one]); bad['approved'] = True
        with self.assertRaises(ValueError):
            apply_edits(self.scene, bad)
        bad = self.contract([copy.deepcopy(one)]); bad['edits'][0]['note'] = 'x' * 65536
        with self.assertRaises(ValueError):
            apply_edits(self.scene, bad)
        valid = self.contract([one, {'op': 'label', 'componentId': self.wall_id, 'label': 'North wall'}])
        self.assertEqual(apply_edits(self.scene, valid)['walls'][0]['label'], 'North wall')

    def test_geometry_edits_remove_cached_bounds_and_record_parameter_authority(self):
        original = fixture()
        original['walls'][0].update(min=[0, 0, -.1], max=[4, 3, .1], support_points=200)
        original['usd'] = {'written': True}
        identified = attach_component_ids(original, 'a' * 64)
        edited = apply_edits(identified, self.contract([
            {'op': 'wall', 'componentId': self.wall_id, 'translationMeters': [1, 0, 0]}], identified))
        self.assertNotIn('usd', edited)
        self.assertNotIn('min', edited['walls'][0])
        self.assertNotIn('max', edited['walls'][0])
        self.assertEqual(edited['walls'][0]['dimensionProvenance'], 'operator-authored-edit')
        self.assertEqual(edited['walls'][0]['parameterProvenance'], {'translationMeters': 'operator-authored-edit'})
        self.assertEqual(edited['walls'][0]['provenance'], 'operator-authored-edit')
        self.assertEqual(edited['walls'][0]['sourceProvenance'], 'observed')
        self.assertEqual(edited['walls'][0]['support_points'], 200)
        self.assertEqual(edited['walls'][0]['supportPointsScope'], 'original-source-not-edited-geometry')
        again = apply_edits(edited, self.contract([
            {'op': 'wall', 'componentId': self.wall_id, 'yawDegrees': 15}], edited))
        self.assertEqual(again['walls'][0]['sourceProvenance'], 'observed')
        self.assertEqual(again['walls'][0]['provenance'], 'operator-authored-edit')

    def test_only_geometric_edits_change_geometric_provenance(self):
        label = apply_edits(self.scene, self.contract([{'op': 'label', 'componentId': self.wall_id, 'label': 'North wall'}]))
        self.assertEqual(label['walls'][0]['provenance'], 'observed')
        self.assertNotIn('sourceProvenance', label['walls'][0])
        hole = apply_edits(self.scene, self.contract([{'op': 'opening', 'componentId': self.door_id, 'widthMeters': 1}]))
        self.assertEqual(hole['openings'][0]['provenance'], 'operator-authored-edit')
        self.assertEqual(hole['openings'][0]['sourceProvenance'], 'operator-reviewed')
        self.assertEqual(hole['walls'][0]['provenance'], 'observed')

    def test_numeric_host_snapshot_types_match_existing_review_semantics(self):
        source = fixture()
        source['openings'][0]['host']['centre'] = [2.0, 1.5, 0.0]
        source['openings'][0]['host']['size'] = [4.0, 3.0, .2]
        source['openings'][0]['host']['yaw_degrees'] = 0.0
        self.assertTrue(ensure_component_ids(source)['openings'][0]['componentId'])
        source['openings'][0]['host']['yaw_degrees'] = False
        with self.assertRaises(ValueError):
            ensure_component_ids(source)

    def test_opening_identifiers_match_existing_review_contract(self):
        for identifier in ('bad space', 'bad/slash', '-leading', 'x' * 65):
            scene = fixture(); scene['openings'][0]['id'] = identifier
            with self.assertRaises(ValueError):
                ensure_component_ids(scene)

    def test_wrong_scene_units_finite_types_and_unbounded_components_refused(self):
        scene = copy.deepcopy(self.scene); scene['units'] = 'cm'
        with self.assertRaises(ValueError):
            apply_edits(scene, self.contract([{'op': 'wall', 'componentId': self.wall_id, 'yawDegrees': 3}], scene))
        for value in (float('inf'), float('nan'), True):
            bad = fixture(); bad['walls'][0]['centre'][0] = value
            with self.assertRaises(ValueError):
                ensure_component_ids(bad)
        bad = fixture(); bad['objects'] = [bad['objects'][0]] * 1025
        with self.assertRaises(ValueError):
            ensure_component_ids(bad)
        bad = fixture(); bad['provenance'][1] = 'not a string key'
        with self.assertRaises(ValueError):
            ensure_component_ids(bad)

    def test_history_cannot_silently_change_types_or_operation_receipts(self):
        edited = apply_edits(self.scene, self.contract([{'op': 'wall', 'componentId': self.wall_id, 'yawDegrees': 3}]))
        for mutate in (lambda s: s['componentGraph'].update(revision=True),
                       lambda s: s['componentGraph']['editHistory'][0].update(revision=True),
                       lambda s: s['componentGraph']['editHistory'][0]['edits'][0].update(yawDegrees=7),
                       lambda s: s['componentGraph'].update(metricVerified=0)):
            bad = copy.deepcopy(edited); mutate(bad)
            with self.assertRaises(ValueError):
                ensure_component_ids(bad)

    def test_edited_hosted_geometry_remains_usable_by_existing_exports(self):
        import ifc_export
        import nav2_export
        edited = apply_edits(self.scene, self.contract([
            {'op': 'wall', 'componentId': self.wall_id, 'translationMeters': [.2, 0, 0], 'yawDegrees': 15},
            {'op': 'opening', 'componentId': self.door_id, 'widthMeters': 1}]))
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'scene.ifc'
            ifc_export.write_ifc(output, edited)
            self.assertIn('IFCRELVOIDSELEMENT', output.read_text())
            self.assertIn('IFCRELFILLSELEMENT', output.read_text())
            nav2_export.export(edited, Path(tmp) / 'navigation')
            manifest = json.loads((Path(tmp) / 'navigation/nav2-map.json').read_text())
            self.assertEqual(manifest['source']['componentGraph']['revision'], 1)
            self.assertEqual(manifest['geometry']['closedDoorLeaves'], 1)
            self.assertIs(manifest['validation']['physicalRobotValidated'], False)
            self.assertIs(manifest['validation']['physicalReviewRequired'], True)
        sys.path.insert(0, str(ROOT / 'robotics/world_worker'))
        import cad_export
        items = cad_export.elements(edited)
        self.assertTrue(any(item['kind'] == 'door' for item in items))


if __name__ == '__main__':
    unittest.main()
