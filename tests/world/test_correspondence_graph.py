"""Frozen correspondence contracts on authored SQLite data, not reconstruction accuracy.

These tests never invoke a learned model, native COLMAP or a physical capture.
They exercise the same public pack reader used by the independent CPU replay.
"""
from __future__ import annotations

import io
import itertools
from pathlib import Path
import random
import sqlite3
import tempfile
import unittest
from unittest import mock
import warnings
import zipfile

import numpy as np
from PIL import Image, ImageDraw

from robotics.world_worker import reconstruction_comparison as rc
from robotics.world_worker import correspondence_graph as cg


PAIR_BASE = 2_147_483_647


def authored_case(root, count=3, *, name='case', tone=0):
    photos = root / (name + '-photos')
    photos.mkdir()
    for i in range(count):
        image = Image.new('RGB', (640, 480), (40 + tone + i * 7, 50, 110))
        draw = ImageDraw.Draw(image)
        for x in range(12, 640, 29):
            draw.line((x, 0, x, 479), fill=(210, 180, 70), width=2)
        draw.text((20 + i * 3, 20), f'Authored view {i}', fill='white')
        image.save(photos / f'view-{i:02d}.jpg')
    case = root / name
    return case, rc.prepare(out=case, photos=photos, frames=count)


def authored_database(path, receipt, edges=None, *, columns=4, features=64):
    """Edges describe canonical case-frame order; SQL stores native image-ID order."""
    count = len(receipt['frames'])
    ids = [41, 7, 92, 13, 64, 118][:count]
    camera_ids = [201 + i for i in range(count)]
    edges = [(0, 1, 60), (1, 2, 12)] if edges is None else edges
    keypoints = []
    for i in range(count):
        rows = np.zeros((features, columns), dtype='<f4')
        rows[:, 0] = .5 + np.arange(features) * 2 + i / 8
        rows[:, 1] = 2.5 + np.arange(features) + i / 4
        if columns > 2:
            rows[:, 2:] = np.arange(1, columns - 1, dtype=np.float32)
        keypoints.append(rows)
    expected = []
    with sqlite3.connect(path) as db:
        db.executescript('''
          CREATE TABLE cameras(camera_id INTEGER PRIMARY KEY, model INTEGER NOT NULL,
            width INTEGER NOT NULL, height INTEGER NOT NULL, params BLOB, prior_focal_length INTEGER NOT NULL);
          CREATE TABLE images(image_id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
            camera_id INTEGER NOT NULL);
          CREATE TABLE keypoints(image_id INTEGER PRIMARY KEY, rows INTEGER NOT NULL,
            cols INTEGER NOT NULL, data BLOB);
          CREATE TABLE two_view_geometries(pair_id INTEGER PRIMARY KEY, rows INTEGER NOT NULL,
            cols INTEGER NOT NULL, data BLOB, config INTEGER NOT NULL,
            F BLOB,E BLOB,H BLOB,qvec BLOB,tvec BLOB);
          CREATE TABLE matches(pair_id INTEGER PRIMARY KEY, rows INTEGER NOT NULL, cols INTEGER NOT NULL, data BLOB);
          CREATE TABLE descriptors(image_id INTEGER PRIMARY KEY, rows INTEGER NOT NULL, cols INTEGER NOT NULL, data BLOB);
        ''')
        for i, frame in enumerate(receipt['frames']):
            params = np.asarray([500., 320., 240., .01], dtype='<f8').tobytes()
            db.execute('INSERT INTO cameras VALUES(?,?,?,?,?,?)', (camera_ids[i], 2, frame['width'], frame['height'], params, 0))
            db.execute('INSERT INTO images VALUES(?,?,?)', (ids[i], frame['image'], camera_ids[i]))
            db.execute('INSERT INTO keypoints VALUES(?,?,?,?)', (ids[i], features, columns, keypoints[i].tobytes()))
        for i, j, length in edges:
            assert i < j and length <= features
            indices = np.column_stack([np.arange(length), (np.arange(length) + 7) % features]).astype('<u4')
            native = indices if ids[i] < ids[j] else indices[:, ::-1].copy()
            pair_id = min(ids[i], ids[j]) * PAIR_BASE + max(ids[i], ids[j])
            db.execute('INSERT INTO two_view_geometries(pair_id,rows,cols,data,config) VALUES(?,?,?,?,?)',
                       (pair_id, length, 2, native.tobytes(), 2))
            expected.append((i, j, indices,
                np.column_stack([keypoints[i][indices[:, 0], :2], keypoints[j][indices[:, 1], :2]])))
    return {'ids': ids, 'cameraIds': camera_ids, 'keypoints': keypoints,
            'edges': sorted(expected, key=lambda row: row[:2])}


def matching_evidence(database, receipt):
    return {'schema': 'brainsnn.matching-preparation.v1', 'origin': 'fresh-cpu-sift-before-solve',
            'captureSha256': receipt['captureSha256'], 'databaseSha256': rc.sha(database),
            'settings': {'feature': 'SIFT', 'maxNumFeatures': 4096, 'maxImageSize': 1280,
                         'cameraModel': 'SIMPLE_RADIAL', 'cameraMode': 'AUTO', 'pairing': 'exhaustive'},
            'dependencies': {'pycolmap': '4.2.1', 'numpy': np.__version__},
            'device': {'type': 'cpu', 'threads': 2},
            'featureExtractionSeconds': .2, 'matchingSeconds': .3, 'totalSeconds': .5}


def graph_arrays(edges):
    """A bounded pair graph with known, irrelevant-to-audit 2D observations."""
    pairs, offsets, features, xy = [], [0], [], []
    for i, j, count in sorted(edges):
        pairs.append([i, j])
        features.extend([[k, k] for k in range(count)])
        xy.extend([[.5 + k, 1.5, 2.5 + k, 3.5] for k in range(count)])
        offsets.append(offsets[-1] + count)
    return {'view_pairs': np.asarray(pairs, dtype='<i8').reshape(-1, 2),
            'pair_offsets': np.asarray(offsets, dtype='<i8'),
            'feature_indices': np.asarray(features, dtype='<u4').reshape(-1, 2),
            'xy': np.asarray(xy, dtype='<f4').reshape(-1, 4),
            'pair_configs': np.full(len(pairs), 2, dtype='<i8')}


class CorrespondenceGraphTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.case, self.receipt = authored_case(self.root)
        self.database = self.root / 'authored.db'
        self.expected = authored_database(self.database, self.receipt)
        self.pack = self.root / 'pack'

    def build(self, *, database=None, matching=None, out=None):
        database = database or self.database
        return cg.build_pack(case=self.case, database=database, out=out or self.pack,
            matching=matching or matching_evidence(database, self.receipt))

    def manifest(self):
        return rc.read_json(self.pack / 'manifest.json')

    def rewrite_manifest(self, change):
        value = self.manifest()
        change(value)
        rc.write_json(self.pack / 'manifest.json', value)

    def rewrite_arrays(self, change):
        path = self.pack / 'correspondences.npz'
        with np.load(path, allow_pickle=False) as archive:
            arrays = {name: archive[name].copy() for name in archive.files}
        change(arrays)
        np.savez_compressed(path, **arrays)
        self.rebind_array_file()

    def rebind_array_file(self):
        path = self.pack / 'correspondences.npz'
        self.rewrite_manifest(lambda value: value['artifacts']['arrays'].update(
            bytes=path.stat().st_size, sha256=rc.sha(path)))

    def test_round_trip_preserves_native_pixels_memberships_and_unverified_scope(self):
        original = self.database.read_bytes()
        manifest = self.build()
        loaded = cg.load_pack(case=self.case, pack=self.pack)
        arrays = loaded['arrays']
        np.testing.assert_array_equal(arrays['view_pairs'], [[0, 1], [1, 2]])
        np.testing.assert_array_equal(arrays['pair_offsets'], [0, 60, 72])
        np.testing.assert_array_equal(arrays['feature_indices'],
            np.concatenate([row[2] for row in self.expected['edges']]))
        np.testing.assert_array_equal(arrays['xy'], np.concatenate([row[3] for row in self.expected['edges']]))
        self.assertEqual(float(arrays['xy'][0, 0]), .5, 'Do not add another half-pixel offset.')
        self.assertEqual([row['databaseImageId'] for row in manifest['frames']], self.expected['ids'])
        self.assertEqual(manifest['captureSha256'], self.receipt['captureSha256'])
        self.assertEqual(manifest['captureReceiptSha256'], rc.sha(self.case / 'capture.json'))
        self.assertEqual((self.pack / 'database.db').read_bytes(), original)
        self.assertEqual(self.database.read_bytes(), original, 'Export cannot modify its source database.')
        self.assertFalse(manifest['claims']['deepbaExecuted'])
        self.assertFalse(manifest['claims']['metricVerified'])
        self.assertFalse(manifest['claims']['physicalAccuracyVerified'])
        self.assertNotIn('poses', manifest)
        self.assertNotIn('points3D', manifest)
        self.assertEqual(loaded['manifest'], manifest)

    def test_paper_threshold_is_a_separate_diagnostic_without_thinning_the_frozen_input(self):
        self.build()
        loaded = cg.load_pack(case=self.case, pack=self.pack)
        full = loaded['audit']['fullGraph']
        candidate = loaded['audit']['paperCandidateGraph']
        self.assertEqual((full['frames'], full['pairs'], full['matches']), (3, 2, 72))
        self.assertTrue(full['connected'])
        self.assertEqual((candidate['frames'], candidate['pairs'], candidate['matches']), (3, 1, 60))
        self.assertFalse(candidate['connected'])
        self.assertEqual(candidate['isolatedFrames'], ['frame_0002.jpg'])
        self.assertEqual(len(loaded['arrays']['xy']), 72)
        with sqlite3.connect(self.pack / 'database.db') as db:
            self.assertEqual(db.execute('SELECT SUM(rows) FROM two_view_geometries').fetchone()[0], 72)

    def test_featureless_and_unregistered_views_remain_in_the_denominator(self):
        with sqlite3.connect(self.database) as db:
            db.execute('DELETE FROM two_view_geometries')
            db.execute('DELETE FROM keypoints WHERE image_id=?', (self.expected['ids'][2],))
        self.build()
        result = cg.load_pack(case=self.case, pack=self.pack)
        self.assertEqual(len(result['manifest']['frames']), 3)
        self.assertEqual(result['audit']['fullGraph']['pairs'], 0)
        self.assertEqual(result['audit']['fullGraph']['isolatedFrames'], [row['image'] for row in self.receipt['frames']])
        self.assertEqual(len(result['audit']['fullGraph']['components']), 3)

    def test_native_zero_row_zero_column_records_keep_the_featureless_frame(self):
        for pair_columns in (0, 2):
            with self.subTest(pair_columns=pair_columns):
                database = self.root / f'empty-native-{pair_columns}.db'
                database.write_bytes(self.database.read_bytes())
                image_id = self.expected['ids'][2]
                first_id = self.expected['ids'][0]
                with sqlite3.connect(database) as db:
                    db.execute('UPDATE keypoints SET rows=0,cols=0,data=NULL WHERE image_id=?', (image_id,))
                    db.execute('DELETE FROM two_view_geometries')
                    pair_id = min(first_id, image_id) * PAIR_BASE + max(first_id, image_id)
                    db.execute('INSERT INTO two_view_geometries(pair_id,rows,cols,data,config) VALUES(?,0,?,NULL,0)',
                               (pair_id, pair_columns))
                pack = self.root / f'empty-native-{pair_columns}-pack'
                self.build(database=database, out=pack)
                result = cg.load_pack(case=self.case, pack=pack)
                self.assertEqual(result['manifest']['frames'][2]['keypoints'], 0)
                self.assertEqual(result['arrays']['xy'].shape, (0, 4))
                self.assertEqual(result['audit']['fullGraph']['frames'], 3)
                self.assertEqual(result['audit']['fullGraph']['pairs'], 0)
                self.assertEqual(len(result['audit']['fullGraph']['isolatedFrames']), 3)

    def test_six_view_two_cliques_report_the_only_bridge_and_articulation_views(self):
        frames = [{'image': f'frame_{i:04d}.jpg', 'sourceKind': 'image'} for i in range(6)]
        edges = [(0, 1, 60), (0, 2, 60), (1, 2, 60), (2, 3, 3),
                 (3, 4, 60), (3, 5, 60), (4, 5, 60)]
        audit = cg.graph_audit(frames, graph_arrays(edges))
        full, candidate = audit['fullGraph'], audit['paperCandidateGraph']
        self.assertTrue(full['connected'])
        self.assertEqual([row['frames'] for row in full['bridges']], [['frame_0002.jpg', 'frame_0003.jpg']])
        self.assertEqual(full['articulationFrames'], ['frame_0002.jpg', 'frame_0003.jpg'])
        cut = full['bottleneck']
        self.assertEqual(cut['method'], 'integer-weight-global-mincut-stoer-wagner-v1')
        self.assertTrue(cut['weak'])
        self.assertEqual(cut['crossingPairs'], 1)
        self.assertEqual(cut['crossingMatches'], 3)
        self.assertAlmostEqual(cut['normalizedCutScore'], 6 / 363)
        self.assertFalse(cut['physicalAccuracyValidated'])
        self.assertFalse(candidate['connected'])
        self.assertEqual(sorted(row['size'] for row in candidate['components']), [3, 3])
        self.assertEqual(full['missingSequentialPairs'], [], 'Unordered photographs have no implied capture sequence.')

    def test_weighted_cut_matches_an_independent_exhaustive_oracle_on_small_graphs(self):
        rng = random.Random(20261116)
        for count in range(3, 8):
            frames = [{'image': f'frame_{i:04d}.jpg', 'sourceKind': 'image'} for i in range(count)]
            for repeat in range(7):
                weights = {(i, i + 1): rng.randrange(1, 10) for i in range(count - 1)}
                for a, b in itertools.combinations(range(count), 2):
                    if rng.random() < .4: weights[a, b] = rng.randrange(1, 10)
                edges = [(a, b, weight) for (a, b), weight in weights.items()]
                arrays = graph_arrays(edges)
                audit = cg.graph_audit(frames, arrays)
                cut = audit['fullGraph']['bottleneck']
                expected = min(sum(weight for (a, b), weight in weights.items()
                                   if (bool(mask & (1 << a))) != (bool(mask & (1 << b))))
                               for mask in range(1, (1 << count) - 1))
                with self.subTest(count=count, repeat=repeat):
                    self.assertEqual(cut['crossingMatches'], expected)
                    left, right = set(cut['partitionA']), set(cut['partitionB'])
                    self.assertTrue(left and right)
                    self.assertFalse(left & right)
                    self.assertEqual(left | right, {frame['image'] for frame in frames})
                    degree = [sum(weight for (a, b), weight in weights.items() if i in (a, b)) for i in range(count)]
                    volumes = [sum(degree[i] for i, frame in enumerate(frames) if frame['image'] in side)
                               for side in (left, right)]
                    self.assertEqual(cut['normalizedCutScore'], round(expected * sum(1 / volume for volume in volumes), 12))
                    self.assertEqual(cg.graph_audit(frames, arrays), audit, 'Tie handling must be deterministic.')

    def test_phase_cut_flags_a_weak_cluster_join_that_has_no_bridge_or_articulation(self):
        # Every single view has many connections. The minimum crossing-weight
        # cut isolates one view, hiding the weaker *relative* join between the
        # two dense groups. This is a matching-graph heuristic, not evidence
        # that either group or their reconstructed placement is physically right.
        frames = [{'image': f'frame_{i:04d}.jpg', 'sourceKind': 'image'} for i in range(40)]
        edges = [(a, b, 100) for first in (0, 20)
                 for a, b in itertools.combinations(range(first, first + 20), 2)]
        edges += [(i, i + 20, 100) for i in range(20)] + [(0, 21, 100)]
        arrays = graph_arrays(edges)
        audit = cg.graph_audit(frames, arrays)
        self.assertTrue(audit['needsReview'])
        for name in ('fullGraph', 'paperCandidateGraph'):
            graph = audit[name]
            self.assertTrue(graph['connected'])
            self.assertEqual((graph['frames'], graph['pairs'], graph['matches']), (40, 401, 40_100))
            self.assertEqual(graph['bridges'], [])
            self.assertEqual(graph['articulationFrames'], [])
            self.assertEqual(graph['bottleneck']['crossingMatches'], 2000)
            self.assertGreater(graph['bottleneck']['normalizedCutScore'], 1)
            witness = graph['normalizedPhaseCut']
            self.assertEqual(witness['method'], 'integer-weight-stoer-wagner-phase-prefix-witness-v1')
            self.assertIn('not a global normalized-cut optimum', witness['objective'])
            self.assertEqual(witness['terminalPhaseCutsConsidered'], 39)
            self.assertGreaterEqual(witness['phaseCutsConsidered'], 39)
            self.assertLessEqual(witness['phaseCutsConsidered'], 40 * 39 // 2)
            self.assertTrue(witness['weak'])
            self.assertLess(witness['normalizedCutScore'], .15)
            self.assertFalse(witness['physicalAccuracyValidated'])
            left, right = set(witness['partitionA']), set(witness['partitionB'])
            self.assertFalse(left & right)
            self.assertEqual(left | right, {frame['image'] for frame in frames})
            crossing = [(a, b, count) for a, b, count in edges
                        if (frames[a]['image'] in left) != (frames[b]['image'] in left)]
            self.assertEqual(witness['crossingPairs'], len(crossing))
            self.assertEqual(witness['crossingMatches'], sum(row[2] for row in crossing))
            volumes = [sum(count * (int(frames[a]['image'] in side) + int(frames[b]['image'] in side))
                           for a, b, count in edges) for side in (left, right)]
            self.assertEqual(witness['normalizedCutScore'],
                             round(sum(row[2] for row in crossing) * sum(1 / volume for volume in volumes), 12))
        self.assertEqual(cg.graph_audit(frames, arrays), audit)

    def test_missing_sequential_video_pairs_do_not_claim_missing_3d_or_measured_baseline(self):
        frames = [{'image': f'frame_{i:04d}.jpg', 'sourceKind': 'video', 'sourceIndex': 0,
                   'sourceFrameIndex': i * 15} for i in range(4)]
        audit = cg.graph_audit(frames, graph_arrays([(0, 1, 60), (1, 3, 55)]))
        missing = audit['fullGraph']['missingSequentialPairs']
        self.assertEqual(missing, [['frame_0001.jpg', 'frame_0002.jpg'], ['frame_0002.jpg', 'frame_0003.jpg']])
        self.assertFalse(audit['fullGraph']['connected'])

    def test_a_different_capture_and_a_changed_prepared_frame_are_both_refused(self):
        self.build()
        other_case, _ = authored_case(self.root, name='other', tone=30)
        with self.assertRaises(ValueError):
            cg.load_pack(case=other_case, pack=self.pack)
        frame = self.case / 'frames' / self.receipt['frames'][0]['image']
        frame.write_bytes(frame.read_bytes() + b'changed')
        with self.assertRaises(ValueError):
            cg.load_pack(case=self.case, pack=self.pack)

    def test_source_matching_evidence_cannot_rebind_a_different_database_or_capture(self):
        for key, value in [('databaseSha256', 'f' * 64), ('captureSha256', 'e' * 64),
                           ('origin', 'operator-supplied-old-database')]:
            with self.subTest(key=key):
                matching = matching_evidence(self.database, self.receipt)
                matching[key] = value
                with self.assertRaises(ValueError):
                    self.build(matching=matching, out=self.root / ('rejected-' + key))

    def test_nonfinite_negative_or_inconsistent_matching_times_are_refused(self):
        for key, value in [('featureExtractionSeconds', float('nan')), ('matchingSeconds', -1),
                           ('totalSeconds', .1), ('matchingSeconds', True)]:
            with self.subTest(key=key, value=value):
                matching = matching_evidence(self.database, self.receipt)
                matching[key] = value
                with self.assertRaises(ValueError):
                    self.build(matching=matching, out=self.root / ('time-' + key + str(len(list(self.root.iterdir())))))

    def test_existing_output_is_not_reused_or_overwritten(self):
        self.build()
        before = {path.name: path.read_bytes() for path in self.pack.iterdir() if path.is_file()}
        with self.assertRaises((ValueError, FileExistsError)):
            self.build()
        self.assertEqual(before, {path.name: path.read_bytes() for path in self.pack.iterdir() if path.is_file()})

    def test_supported_keypoint_record_widths_preserve_xy_only_without_reinventing_tracks(self):
        for columns in (2, 6):
            with self.subTest(columns=columns):
                database = self.root / f'keypoints-{columns}.db'
                expected = authored_database(database, self.receipt, columns=columns)
                out = self.root / f'keypoints-{columns}-pack'
                self.build(database=database, out=out)
                loaded = cg.load_pack(case=self.case, pack=out)
                np.testing.assert_array_equal(loaded['arrays']['xy'], np.concatenate([row[3] for row in expected['edges']]))
                self.assertFalse(loaded['manifest']['observations']['tracksMerged'])

    def test_empty_native_pose_prior_table_is_allowed_but_solved_or_external_pose_inputs_are_not(self):
        with sqlite3.connect(self.database) as db:
            db.execute('CREATE TABLE pose_priors(image_id INTEGER PRIMARY KEY,position BLOB,coordinate_system INTEGER)')
        self.build()
        observations = cg.load_pack(case=self.case, pack=self.pack)['manifest']['observations']
        self.assertFalse(observations['solvedAbsolutePosesIncluded'])
        self.assertTrue(observations['relativeVerificationGeometryRetained'])
        for table in ['pose_priors', 'points3D', 'camera_poses']:
            with self.subTest(table=table):
                target = self.root / (table + '.db')
                target.write_bytes(self.database.read_bytes())
                with sqlite3.connect(target) as db:
                    if table == 'pose_priors':
                        db.execute('INSERT INTO pose_priors VALUES(?,?,?)',
                            (self.expected['ids'][0], np.zeros(3, dtype='<f8').tobytes(), 0))
                    else:
                        db.execute(f'CREATE TABLE {table}(id INTEGER PRIMARY KEY, geometry BLOB)')
                with self.assertRaisesRegex(ValueError, 'pose|geometry|solved|cold'):
                    self.build(database=target, out=self.root / (table + '-pack'))

    def test_connected_planar_and_watermark_graphs_remain_screening_only(self):
        frames = [{'image': f'frame_{i:04d}.jpg', 'sourceKind': 'image'} for i in range(3)]
        arrays = graph_arrays([(0, 1, 60), (0, 2, 60), (1, 2, 60)])
        arrays['pair_configs'][:] = [4, 5, 7]
        audit = cg.graph_audit(frames, arrays)
        self.assertTrue(audit['fullGraph']['connected'])
        self.assertTrue(audit['paperCandidateGraph']['connected'])
        self.assertTrue(audit['needsReview'])
        self.assertTrue(audit['screeningOnly'])
        self.assertFalse(audit['parallaxVerified'])
        labels = {entry['label'] for entry in audit['fullGraph']['geometryConfigurations']}
        self.assertEqual(labels, {'PLANAR', 'PANORAMIC', 'WATERMARK'})
        self.assertTrue(any('planar' in value for value in audit['warnings']))
        self.assertTrue(any('WATERMARK' in value for value in audit['warnings']))
        arrays['pair_configs'][0] = 10
        with self.assertRaises(ValueError):
            cg.graph_audit(frames, arrays)

    def test_match_and_expanded_archive_budgets_refuse_instead_of_thinning(self):
        with mock.patch.object(cg, 'MAX_MATCHES', 71):
            with self.assertRaisesRegex(ValueError, 'budget|limit|exceed'):
                self.build(out=self.root / 'over-matches')
        self.build()
        archive_path = self.pack / 'correspondences.npz'
        with zipfile.ZipFile(archive_path) as archive:
            expanded = sum(entry.file_size for entry in archive.infolist())
        self.assertLess(archive_path.stat().st_size, expanded, 'Fixture compresses enough to isolate its expanded-byte budget.')
        with mock.patch.object(cg, 'MAX_ARRAY_BYTES', expanded - 1):
            with self.assertRaisesRegex(ValueError, 'budget|oversized|limit'):
                cg.load_pack(case=self.case, pack=self.pack)

    def test_sqlite_symlinks_and_nonempty_journals_are_refused(self):
        link = self.root / 'linked.db'
        link.symlink_to(self.database)
        with self.assertRaises(ValueError):
            self.build(database=link, out=self.root / 'symlink-pack')
        for suffix in ['-wal', '-journal']:
            with self.subTest(suffix=suffix):
                sidecar = Path(str(self.database) + suffix)
                sidecar.write_bytes(b'uncheckpointed data')
                with self.assertRaises(ValueError):
                    self.build(out=self.root / ('sidecar' + suffix))
                sidecar.unlink()

    def test_missing_duplicate_extra_or_mismatched_database_images_are_refused(self):
        for mutation in ['missing', 'extra', 'dimension']:
            with self.subTest(mutation=mutation):
                target = self.root / (mutation + '.db')
                target.write_bytes(self.database.read_bytes())
                with sqlite3.connect(target) as db:
                    if mutation == 'missing':
                        db.execute('DELETE FROM images WHERE image_id=?', (self.expected['ids'][2],))
                    elif mutation == 'extra':
                        db.execute('INSERT INTO images VALUES(999,?,?)', ('unrecorded.jpg', self.expected['cameraIds'][0]))
                    else:
                        db.execute('UPDATE cameras SET width=639 WHERE camera_id=?', (self.expected['cameraIds'][0],))
                with self.assertRaises(ValueError):
                    self.build(database=target, out=self.root / (mutation + '-pack'))

    def test_invalid_source_match_rows_cannot_be_silently_repaired(self):
        for mutation in ['duplicate', 'index', 'pixel', 'nan']:
            with self.subTest(mutation=mutation):
                target = self.root / (mutation + '.db')
                target.write_bytes(self.database.read_bytes())
                with sqlite3.connect(target) as db:
                    if mutation in ('duplicate', 'index'):
                        pair_id, data = db.execute('SELECT pair_id,data FROM two_view_geometries ORDER BY pair_id LIMIT 1').fetchone()
                        values = np.frombuffer(data, '<u4').copy().reshape(-1, 2)
                        if mutation == 'duplicate': values[1] = values[0]
                        else: values[0, 0] = 99999
                        db.execute('UPDATE two_view_geometries SET data=? WHERE pair_id=?', (values.tobytes(), pair_id))
                    else:
                        image_id, cols, data = db.execute('SELECT image_id,cols,data FROM keypoints ORDER BY image_id LIMIT 1').fetchone()
                        values = np.frombuffer(data, '<f4').copy().reshape(-1, cols)
                        values[0, 0] = float('nan') if mutation == 'nan' else 641
                        db.execute('UPDATE keypoints SET data=? WHERE image_id=?', (values.tobytes(), image_id))
                with self.assertRaises(ValueError):
                    self.build(database=target, out=self.root / (mutation + '-pack'))

    def test_database_views_and_duplicate_camera_or_keypoint_records_are_refused(self):
        # These are bounded SQLite files with plausible values but not valid
        # native relational identities. Do not let SELECT/fetchone silently pick
        # one duplicate record or evaluate an operator-supplied SQL view.
        for mutation in ['view', 'camera', 'keypoints']:
            with self.subTest(mutation=mutation):
                target = self.root / (mutation + '.db')
                target.write_bytes(self.database.read_bytes())
                with sqlite3.connect(target) as db:
                    if mutation == 'view':
                        db.executescript('ALTER TABLE cameras RENAME TO camera_data; '
                                         'CREATE VIEW cameras AS SELECT * FROM camera_data;')
                    elif mutation == 'camera':
                        db.execute('UPDATE images SET camera_id=?', (self.expected['cameraIds'][0],))
                        db.execute('DELETE FROM cameras WHERE camera_id<>?', (self.expected['cameraIds'][0],))
                        db.executescript('CREATE TABLE camera_copy AS SELECT * FROM cameras; '
                            'DROP TABLE cameras; ALTER TABLE camera_copy RENAME TO cameras; '
                            'INSERT INTO cameras SELECT * FROM cameras;')
                    else:
                        db.executescript('DELETE FROM two_view_geometries; '
                            'CREATE TABLE keypoint_copy AS SELECT * FROM keypoints; '
                            'DROP TABLE keypoints; ALTER TABLE keypoint_copy RENAME TO keypoints;')
                        db.execute('DELETE FROM keypoints WHERE image_id=?', (self.expected['ids'][2],))
                        db.execute('INSERT INTO keypoints SELECT * FROM keypoints WHERE image_id=?',
                                   (self.expected['ids'][0],))
                with self.assertRaises(ValueError):
                    self.build(database=target, out=self.root / (mutation + '-pack'))

    def test_simple_artifact_tampering_fails_hash_validation(self):
        self.build()
        for filename in ['database.db', 'correspondences.npz', 'audit.json']:
            with self.subTest(filename=filename):
                path = self.pack / filename
                before = path.read_bytes()
                path.write_bytes(before + b'changed')
                with self.assertRaises(ValueError):
                    cg.load_pack(case=self.case, pack=self.pack)
                path.write_bytes(before)

    def test_rehashed_false_arrays_still_fail_the_native_database_equivalence_check(self):
        self.build()
        original_arrays = (self.pack / 'correspondences.npz').read_bytes()
        original_manifest = (self.pack / 'manifest.json').read_bytes()
        changes = {
            'pixel': lambda a: a['xy'].__setitem__((0, 0), a['xy'][0, 0] + 1),
            'nan': lambda a: a['xy'].__setitem__((0, 0), np.nan),
            'feature': lambda a: a['feature_indices'].__setitem__((0, 0), 63),
            'offset': lambda a: a['pair_offsets'].__setitem__(-1, int(a['pair_offsets'][-1]) + 1),
            'config': lambda a: a['pair_configs'].__setitem__(0, 4),
        }
        for label, change in changes.items():
            with self.subTest(change=label):
                self.rewrite_arrays(change)
                with self.assertRaises(ValueError):
                    cg.load_pack(case=self.case, pack=self.pack)
                (self.pack / 'correspondences.npz').write_bytes(original_arrays)
                (self.pack / 'manifest.json').write_bytes(original_manifest)

    def test_npz_duplicate_entries_and_object_arrays_are_refused_without_pickle(self):
        self.build()
        path = self.pack / 'correspondences.npz'
        original_arrays = path.read_bytes()
        original_manifest = (self.pack / 'manifest.json').read_bytes()
        with zipfile.ZipFile(io.BytesIO(original_arrays)) as source:
            entries = [(entry.filename, source.read(entry)) for entry in source.infolist()]
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with zipfile.ZipFile(path, 'w') as target:
                for name, data in entries: target.writestr(name, data)
                target.writestr(entries[0][0], entries[0][1])
        self.rebind_array_file()
        with self.assertRaises(ValueError):
            cg.load_pack(case=self.case, pack=self.pack)
        path.write_bytes(original_arrays)
        (self.pack / 'manifest.json').write_bytes(original_manifest)
        self.rewrite_arrays(lambda arrays: arrays.__setitem__('xy', np.asarray([['not numeric']], dtype=object)))
        with self.assertRaises(ValueError):
            cg.load_pack(case=self.case, pack=self.pack)

    def test_qualification_claims_and_audit_status_are_not_trusted(self):
        self.build()
        original_manifest = (self.pack / 'manifest.json').read_bytes()
        for claim in ['deepbaExecuted', 'metricVerified', 'physicalAccuracyVerified']:
            with self.subTest(claim=claim):
                self.rewrite_manifest(lambda value: value['claims'].__setitem__(claim, True))
                with self.assertRaises(ValueError):
                    cg.load_pack(case=self.case, pack=self.pack)
                (self.pack / 'manifest.json').write_bytes(original_manifest)
        audit_path = self.pack / 'audit.json'
        audit = rc.read_json(audit_path)
        audit['paperCandidateGraph']['connected'] = True
        rc.write_json(audit_path, audit)
        self.rewrite_manifest(lambda value: value['artifacts']['audit'].update(
            bytes=audit_path.stat().st_size, sha256=rc.sha(audit_path)))
        with self.assertRaises(ValueError):
            cg.load_pack(case=self.case, pack=self.pack)

    def test_duplicate_json_keys_and_pack_artifact_symlinks_are_refused(self):
        self.build()
        manifest_path = self.pack / 'manifest.json'
        before = manifest_path.read_bytes()
        manifest_path.write_text('{"schema":"wrong",' + before.decode().lstrip()[1:])
        with self.assertRaises(ValueError):
            cg.load_pack(case=self.case, pack=self.pack)
        manifest_path.write_bytes(before)
        database = self.pack / 'database.db'
        external = self.root / 'external-copy.db'
        external.write_bytes(database.read_bytes())
        database.unlink()
        database.symlink_to(external)
        with self.assertRaises(ValueError):
            cg.load_pack(case=self.case, pack=self.pack)


if __name__ == '__main__':
    unittest.main()
