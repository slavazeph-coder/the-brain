"""Evidence admission tests only: synthetic files here are never demonstration media."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
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
                                       capture_sha256='', expected_points=1, entered_distance=5.79)
        for p in (self.args.job, self.args.reconstruction, self.args.photos):
            p.mkdir()
        self.args.capture.write_bytes(b'SYNTHETIC TEST SOURCE, NOT A VIDEO')
        self.args.capture_sha256 = hashlib.sha256(self.args.capture.read_bytes()).hexdigest()
        (self.args.photos / 'frame.jpg').write_bytes(b'SYNTHETIC TEST FRAME')
        scale = {'distance': 5.79, 'verified': False}
        cloud = {'units': 'm', 'points': [[0, 0, 0, 10, 20, 30]], 'scale': scale,
                 'fromSource': [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]],
                 'provenance': {'floorAligned': True, 'metricVerified': False, 'totalPoints': 1,
                                'keptPoints': 1, 'outliersDropped': 0, 'thinned': False}}
        for name in demo.REQUIRED:
            (self.args.job / name).write_text('{}')
        self.write('arena-cloud.json', cloud)
        scene = {'units': 'm', 'scale': scale, 'objects': []}
        import sys
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


if __name__ == '__main__':
    unittest.main()
