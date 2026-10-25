"""Evidence admission tests only: synthetic files here are never demonstration media."""
import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[2] / 'scripts/world-demo/regenerate_reference.py'
spec = importlib.util.spec_from_file_location('demo_regeneration', SCRIPT)
demo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(demo)


class ReferenceAdmission(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.args = argparse.Namespace(job=root / 'job', reconstruction=root / 'rec', photos=root / 'photos',
                                       capture=root / 'capture.mp4', out=root / 'output',
                                       capture_sha256='', expected_points=1, entered_distance=5.79,
                                       capture_kind='photo-sequence-fixture', minimum_held_out=0,
                                       capture_credit='Synthetic admission-test fixture, not demonstration media')
        for p in (self.args.job, self.args.reconstruction, self.args.photos):
            p.mkdir()
        self.args.capture.write_bytes(b'SYNTHETIC TEST SOURCE, NOT A VIDEO')
        self.args.capture_sha256 = hashlib.sha256(self.args.capture.read_bytes()).hexdigest()
        (self.args.photos / 'frame.jpg').write_bytes(b'SYNTHETIC TEST FRAME')
        scale = {'distance': 5.79, 'verified': False}
        cloud = {'units': 'm', 'coordinateFrame': 'right-handed-y-up',
                 'points': [[0, 0, 0, 10, 20, 30]], 'scale': scale,
                 'fromSource': [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]],
                 'provenance': {'floorAligned': True, 'metricVerified': False, 'totalPoints': 1,
                                'keptPoints': 1, 'outliersDropped': 0, 'thinned': False}}
        for name in demo.REQUIRED:
            (self.args.job / name).write_text('{}')
        self.write('arena-cloud.json', cloud)
        scene = {'units': 'm', 'scale': scale, 'objects': []}
        sys.path.insert(0, str(SCRIPT.parents[2] / 'robotics/world_worker'))
        import fit_check
        fit = fit_check.check(scene, cloud['points'])
        summary = {'within_5cm': fit['within']['5cm'], 'modelled_median_cm': fit['modelled']['median_cm'],
                   'by_kind': fit['by_kind'], 'misfits': fit['misfits']}
        self.write('scene.json', {**scene, 'fit': summary})
        self.write('scene-usd.json', {'units': 'm', 'handoff': {'points': 1, 'scale': scale, 'provenance': cloud['provenance']}, 'fit': summary})
        self.write('fit-check.json', fit)
        (self.args.reconstruction / 'sparse-preview.ply').write_text(
            'ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\n'
            'property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n0 0 0 10 20 30\n')
        (self.args.reconstruction / 'reconstruction.json').write_text(json.dumps({
            'sources': [{'kind': 'video', 'sha256': self.args.capture_sha256}], 'cameras': [{'image': 'frame.jpg'}]}))

    def write(self, name, obj):
        (self.args.job / name).write_text(json.dumps(obj))

    def measured_job(self, *, held_out_distance=2.0):
        """Real report/fit writers on three synthetic points, never physical reference evidence."""
        import fit_check
        import measurement_check
        cloud = demo.read(self.args.job / 'arena-cloud.json')
        cloud['points'] = [[0, 0, 0, 10, 20, 30], [5.79, 0, 0, 40, 50, 60], [0, 0, 2, 70, 80, 90]]
        cloud['provenance'].update(totalPoints=3, keptPoints=3)
        self.args.expected_points = 3
        cloud['measurementChecks'] = {
            'schema': measurement_check.INPUT_SCHEMA,
            'cloudPointsSha256': measurement_check.points_sha256(cloud),
            'coordinateFrame': 'right-handed-y-up', 'units': 'm',
            'tolerance': {'absoluteMeters': .05, 'relative': .02},
            'checks': [{
                'id': name, 'label': 'Synthetic ' + name, 'role': role, 'pointIndices': indices,
                'distanceMeters': distance, 'uncertaintyMeters': .005, 'method': 'manual-reference',
                'instrument': 'Synthetic test reference, not a physical reading',
                'measuredOn': '2026-10-24', 'note': 'Software admission test only.'
            } for name, role, indices, distance in (
                ('calibration', 'calibration', [0, 1], 5.79),
                ('heldout', 'held-out', [0, 2], held_out_distance))]}
        self.write('arena-cloud.json', cloud)
        scene = demo.read(self.args.job / 'scene.json')
        fit = fit_check.check(scene, cloud['points'])
        summary = {'within_5cm': fit['within']['5cm'], 'modelled_median_cm': fit['modelled']['median_cm'],
                   'by_kind': fit['by_kind'], 'misfits': fit['misfits']}
        scene['fit'] = summary
        self.write('scene.json', scene)
        self.write('fit-check.json', fit)
        report = measurement_check.build_report(scene, cloud)
        report['sourceFiles'] = {key: {'sha256': demo.digest(self.args.job / name)}
                                 for key, name in [('scene', 'scene.json'), ('cloud', 'arena-cloud.json')]}
        self.write('scene-measurements.json', report)
        evidence = demo.read(self.args.job / 'scene-usd.json')
        evidence['handoff'].update(points=3, provenance=cloud['provenance'])
        evidence['fit'] = summary
        evidence['measurements'] = {'written': True, 'status': report['status'], 'metric_verified': False}
        self.write('scene-usd.json', evidence)
        (self.args.reconstruction / 'sparse-preview.ply').write_text(
            'ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\n'
            'property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n' +
            '\n'.join(' '.join(map(str, row)) for row in cloud['points']) + '\n')
        return report

    def rejected_without_output(self):
        with self.assertRaises(ValueError):
            demo.validate(self.args)
        self.assertFalse(self.args.out.exists())

    def test_consistent_evidence_admitted_without_generating_media(self):
        self.assertEqual(demo.validate(self.args)['points'], 1)
        self.assertFalse(self.args.out.exists())

    def test_tilted_handoff_rejected_before_output(self):
        cloud = demo.read(self.args.job / 'arena-cloud.json')
        cloud['provenance']['floorAligned'] = False
        self.write('arena-cloud.json', cloud)
        with self.assertRaisesRegex(ValueError, 'gravity aligned'):
            demo.validate(self.args)
        self.assertFalse(self.args.out.exists())

    def test_original_capture_hash_and_receipt_required(self):
        self.args.capture.write_bytes(b'OTHER SOURCE')
        with self.assertRaisesRegex(ValueError, 'SHA-256'):
            demo.validate(self.args)
        self.args.capture_sha256 = demo.digest(self.args.capture)
        with self.assertRaisesRegex(ValueError, 'receipt does not bind'):
            demo.validate(self.args)
        self.assertFalse(self.args.out.exists())

    def test_missing_export_or_stale_output_rejected(self):
        (self.args.job / 'scene.ifc').unlink()
        with self.assertRaisesRegex(ValueError, 'Missing'):
            demo.validate(self.args)
        self.args.out.mkdir()
        with self.assertRaisesRegex(ValueError, 'fresh directory'):
            demo.validate(self.args)

    def test_output_cannot_be_inside_source(self):
        self.args.out = self.args.reconstruction / 'new-output'
        with self.assertRaisesRegex(ValueError, 'overlaps'):
            demo.validate(self.args)
        self.assertFalse(self.args.out.exists())

    def test_same_count_does_not_admit_altered_fit_or_source_points(self):
        fit = demo.read(self.args.job / 'fit-check.json')
        fit['within']['5cm'] = .5
        self.write('fit-check.json', fit)
        with self.assertRaisesRegex(ValueError, 'Persisted fit'):
            demo.validate(self.args)
        fit['within']['5cm'] = 0
        self.write('fit-check.json', fit)
        (self.args.reconstruction / 'sparse-preview.ply').write_text(
            (self.args.reconstruction / 'sparse-preview.ply').read_text().replace('0 0 0 10 20 30', '1 0 0 10 20 30'))
        import subprocess
        with self.assertRaises(subprocess.CalledProcessError):
            demo.validate(self.args)
        self.assertFalse(self.args.out.exists())

    def test_legacy_jobs_without_references_are_explicitly_unchecked(self):
        for kind in ('photo-sequence-fixture', 'unknown'):
            with self.subTest(kind=kind):
                self.args.capture_kind = kind
                result = demo.validate(self.args)
                self.assertIsNone(result['measurements'])
                self.assertEqual(result['capture'], {'kind': kind, 'credit': self.args.capture_credit,
                                                     'authority': 'operator-declared'})
                self.assertFalse(self.args.out.exists())

    def test_phone_kind_requires_a_report_even_with_zero_requested_minimum(self):
        self.args.capture_kind = 'phone-video'
        self.rejected_without_output()

    def test_positive_minimum_requires_a_report_for_fixture_jobs(self):
        self.args.minimum_held_out = 1
        self.rejected_without_output()

    def test_capture_metadata_is_required_bounded_plain_text(self):
        for kind in ('dataset', '', None):
            with self.subTest(kind=kind):
                self.args.capture_kind = kind
                self.rejected_without_output()
        self.args.capture_kind = 'unknown'
        for credit in ('', '   ', 'x' * 241, 'line\nbreak', 'tab\there', 'nul\0here', 'del\x7fhere', 'c1\x85here', None):
            with self.subTest(credit=repr(credit)):
                self.args.capture_credit = credit
                self.rejected_without_output()

    def test_requested_minimum_is_a_bounded_integer(self):
        for minimum in (-1, 65, True, 1.0, None):
            with self.subTest(minimum=repr(minimum)):
                self.args.minimum_held_out = minimum
                self.rejected_without_output()

    def test_report_recomputed_and_bound_without_changing_inputs_or_claims(self):
        report = self.measured_job()
        self.args.capture_kind = 'phone-video'
        self.args.capture_credit = '  Synthetic phone-kind admission test, not a phone capture  '
        self.args.minimum_held_out = 1
        paths = [self.args.capture, *self.args.job.rglob('*'), *self.args.reconstruction.rglob('*'), *self.args.photos.rglob('*')]
        before = {path: path.read_bytes() for path in paths if path.is_file()}
        result = demo.validate(self.args)
        self.assertEqual(result['measurements'], report)
        self.assertEqual(result['capture'], {'kind': 'phone-video',
            'credit': self.args.capture_credit.strip(), 'authority': 'operator-declared'})
        self.assertEqual(result['measurements']['summary']['heldOutCount'], 1)
        self.assertEqual(result['measurements']['summary']['calibrationCount'], 1)
        self.assertIs(result['measurements']['metric_verified'], False)
        self.assertIs(result['measurements']['certified'], False)
        self.assertEqual({path: path.read_bytes() for path in before}, before)
        self.assertFalse(self.args.out.exists())

    def test_failed_held_out_checks_remain_admissible_and_count_only_held_out(self):
        report = self.measured_job(held_out_distance=3.0)
        self.args.minimum_held_out = 1
        result = demo.validate(self.args)
        self.assertEqual(result['measurements'], report)
        self.assertEqual(report['status'], 'outside-requested-tolerance')
        self.assertEqual(report['summary']['heldOutWithinTolerance'], 0)
        self.assertEqual(report['summary']['calibrationWithinTolerance'], 1)
        self.args.minimum_held_out = 2  # the calibration check cannot satisfy a second held-out requirement
        self.rejected_without_output()

    def test_no_held_out_report_does_not_satisfy_a_positive_minimum(self):
        import measurement_check
        self.measured_job()
        self.args.capture_kind = 'phone-video'  # Phone provenance alone cannot turn calibration into held-out evidence.
        cloud = demo.read(self.args.job / 'arena-cloud.json')
        cloud['measurementChecks']['checks'] = cloud['measurementChecks']['checks'][:1]
        self.write('arena-cloud.json', cloud)
        report = measurement_check.build_report(demo.read(self.args.job / 'scene.json'), cloud)
        report['sourceFiles'] = {key: {'sha256': demo.digest(self.args.job / name)}
                                 for key, name in [('scene', 'scene.json'), ('cloud', 'arena-cloud.json')]}
        self.write('scene-measurements.json', report)
        evidence = demo.read(self.args.job / 'scene-usd.json')
        evidence['measurements']['status'] = report['status']
        self.write('scene-usd.json', evidence)
        self.assertEqual(demo.validate(self.args)['measurements']['status'], 'no-held-out')
        self.args.minimum_held_out = 1
        self.rejected_without_output()

    def test_missing_report_is_rejected_when_references_or_worker_claim_exist(self):
        for retained in ('references', 'worker-claim'):
            with self.subTest(retained=retained):
                self.measured_job()
                if retained == 'references':
                    evidence = demo.read(self.args.job / 'scene-usd.json')
                    del evidence['measurements']
                    self.write('scene-usd.json', evidence)
                else:
                    cloud = demo.read(self.args.job / 'arena-cloud.json')
                    del cloud['measurementChecks']
                    self.write('arena-cloud.json', cloud)
                (self.args.job / 'scene-measurements.json').unlink()
                self.rejected_without_output()

    def test_worker_measurement_summary_must_match_exactly(self):
        report = self.measured_job()
        baseline = demo.read(self.args.job / 'scene-usd.json')
        valid = {'written': True, 'status': report['status'], 'metric_verified': False}
        invalid = [None, {}, {**valid, 'written': False}, {**valid, 'written': 1},
                   {**valid, 'metric_verified': True}, {**valid, 'metric_verified': 0},
                   {**valid, 'status': 'no-held-out'}, {**valid, 'certified': False}]
        for summary in invalid:
            with self.subTest(summary=summary):
                evidence = copy.deepcopy(baseline)
                if summary is None:
                    del evidence['measurements']
                else:
                    evidence['measurements'] = summary
                self.write('scene-usd.json', evidence)
                self.rejected_without_output()

    def test_tampered_report_fields_cannot_be_admitted_as_worker_evidence(self):
        baseline = self.measured_job(held_out_distance=3.0)
        mutations = [
            (('certified',), True), (('metric_verified',), 0),
            (('status',), 'within-requested-tolerance'),
            (('summary', 'heldOutCount'), True), (('summary', 'heldOutWithinTolerance'), 1),
            (('checks', 1, 'absoluteErrorMeters'), 0), (('checks', 1, 'cloudDistanceMeters'), 3),
            (('checks', 1, 'instrument'), 'Forged reference provenance'),
            (('tolerance', 'absoluteMeters'), .5), (('caveats',), []),
            (('source', 'cloudPointsSha256'), '0' * 64),
            (('source', 'sceneCanonicalSha256'), '0' * 64),
            (('sourceFiles', 'scene', 'sha256'), '0' * 64),
            (('sourceFiles', 'cloud', 'sha256'), '0' * 64)]
        for keys, value in mutations:
            with self.subTest(field=keys):
                report = copy.deepcopy(baseline)
                target = report
                for key in keys[:-1]:
                    target = target[key]
                target[keys[-1]] = value
                self.write('scene-measurements.json', report)
                self.rejected_without_output()

    def test_report_requires_raw_source_file_hashes_not_only_canonical_hashes(self):
        report = self.measured_job()
        for key in ('sourceFiles', 'scene', 'cloud'):
            with self.subTest(missing=key):
                altered = copy.deepcopy(report)
                if key == 'sourceFiles':
                    del altered[key]
                else:
                    del altered['sourceFiles'][key]
                self.write('scene-measurements.json', altered)
                self.rejected_without_output()
        self.write('scene-measurements.json', report)
        for name in ('scene.json', 'arena-cloud.json'):
            with self.subTest(reformatted=name):
                path = self.args.job / name
                original = path.read_bytes()
                path.write_bytes(original + b'\n')  # same parsed data, different archived bytes
                self.rejected_without_output()
                path.write_bytes(original)

    def test_non_finite_measurement_results_are_not_json_evidence(self):
        baseline = self.measured_job()
        for invalid in (float('nan'), float('inf'), float('-inf')):
            with self.subTest(invalid=repr(invalid)):
                report = copy.deepcopy(baseline)
                report['checks'][1]['cloudDistanceMeters'] = invalid
                self.write('scene-measurements.json', report)
                self.rejected_without_output()

    def test_missing_report_cannot_be_hidden_by_an_empty_worker_declaration(self):
        baseline = demo.read(self.args.job / 'scene-usd.json')
        for declaration in (None, {}, {'skipped': 'Report missing'}):
            with self.subTest(declaration=declaration):
                self.write('scene-usd.json', {**baseline, 'measurements': declaration})
                self.rejected_without_output()

    def test_direct_composer_refuses_a_tampered_report_before_render_setup(self):
        report = self.measured_job()
        report['certified'] = True
        self.write('scene-measurements.json', report)
        root = Path(self.tmp.name)
        renders, route, output = root / 'uncreated-renders', root / 'uncreated-route.json', root / 'film.mp4'
        result = subprocess.run([
            sys.executable, str(SCRIPT.parent / 'film/compose_film.py'),
            str(renders), str(self.args.photos), str(self.args.job), str(route), str(output),
            '--capture-kind', 'unknown', '--capture-credit',
            'AUTHORED SOFTWARE ADMISSION FIXTURE; no camera capture or physical readings.'
        ], cwd=SCRIPT.parents[2], capture_output=True, text=True, timeout=15)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Dimensional report does not match', result.stderr)
        self.assertNotIn('Traceback', result.stderr)
        self.assertFalse(output.exists())
        self.assertFalse(renders.exists())
        self.assertFalse(route.exists())


if __name__ == '__main__':
    unittest.main()
