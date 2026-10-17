"""Real local Parquet/MP4/MCAP fixtures; no model, robot, or network calls."""
import base64
import json
from types import SimpleNamespace
import io
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from inspection.interop import BundleBuilder, ImportError, export_mcap, import_lerobot, import_mcap, json_bytes, parse_json, parquet_rows
from workers.arena.recording import verify_bundle, RecordingError


def fixture(root):
    import av
    import numpy as np
    import pyarrow as pa
    import pyarrow.parquet as pq
    for directory in ('meta/episodes/chunk-000', 'data/chunk-000', 'videos/observation.images.front/chunk-000'):
        (root / directory).mkdir(parents=True)
    info = {"codebase_version": "v3.0", "fps": 2, "robot_type": "synthetic-test",
        "data_path": "data/chunk-{chunk_index:03d}/file-{file_index:03d}.parquet",
        "video_path": "videos/{video_key}/chunk-{chunk_index:03d}/file-{file_index:03d}.mp4",
        "features": {"observation.images.front": {"dtype": "video", "shape": [16, 16, 3]},
                     "action": {"dtype": "float32", "shape": [2]},
                     "observation.state": {"dtype": "float32", "shape": [2]}}}
    (root / 'meta/info.json').write_bytes(json_bytes(info))
    episodes = [{"episode_index": n, "length": 2, "tasks": ["synthetic fixture"],
        "dataset_from_index": n * 2, "dataset_to_index": n * 2 + 2,
        "data/chunk_index": 0, "data/file_index": 0,
        "videos/observation.images.front/chunk_index": 0, "videos/observation.images.front/file_index": 0,
        "videos/observation.images.front/from_timestamp": float(n),
        "videos/observation.images.front/to_timestamp": float(n + 1)} for n in (0, 1)]
    pq.write_table(pa.Table.from_pylist(episodes), root / 'meta/episodes/chunk-000/file-000.parquet')
    rows = [{"episode_index": i // 2, "index": i, "frame_index": i % 2, "timestamp": (i % 2) / 2,
             "observation.state": [float(i), 0.0], "action": [float(i), 0.5]} for i in range(4)]
    pq.write_table(pa.Table.from_pylist(rows), root / 'data/chunk-000/file-000.parquet')
    video = root / 'videos/observation.images.front/chunk-000/file-000.mp4'
    with av.open(str(video), 'w') as output:
        stream = output.add_stream('mpeg4', rate=2)
        stream.width = stream.height = 16
        stream.pix_fmt = 'yuv420p'
        for i in range(4):
            pixels = np.zeros((16, 16, 3), dtype=np.uint8)
            pixels[:, :, 0 if i < 2 else 2] = 240
            frame = av.VideoFrame.from_ndarray(pixels, format='rgb24')
            frame.pts = i
            for packet in stream.encode(frame): output.mux(packet)
        for packet in stream.encode(): output.mux(packet)
    return info, episodes, rows


class InterchangeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self): self.temp.cleanup()

    def simple(self):
        b = BundleBuilder('fixture-recording', {"format": "test fixture"}, {}, [])
        aid = b.artifact('source.txt', b'exact source', media='text/plain')
        b.event('observation', {"state": [0.25, 0.0]}, sim_time=0, artifacts=[aid], monotonicNs='1792200000000000001')
        return b.finish()

    def test_lerobot_selects_second_episode_from_shared_sources(self):
        from PIL import Image
        fixture(self.root)
        bundle = import_lerobot(self.root, 1)
        m = verify_bundle(bundle)
        observations = [e for e in m['events'] if e['kind'] == 'observation']
        self.assertEqual([e['data']['sourceRowIndex'] for e in observations], [2, 3])
        self.assertEqual([e['data']['state'][0] for e in observations], [2.0, 3.0])
        self.assertEqual(m['source']['kind'], 'imported')
        self.assertFalse(m['outcome']['policyExecuted'])
        self.assertEqual(m['outcome']['actionsApplied'], 0)
        self.assertNotIn('controller-input', [e['kind'] for e in m['events']])
        for event in observations:
            camera = event['data']['cameras'][0]
            self.assertGreaterEqual(camera['sourceTime'], 1.0)
            self.assertLess(camera['sourceTime'], 2.0)
            artifact = next(a for a in m['artifacts'] if a['id'] == camera['artifactId'])
            image = Image.open(io.BytesIO(base64.b64decode(bundle['payloads'][artifact['path']])))
            red, _, blue = image.getpixel((8, 8))
            self.assertGreater(blue, red + 100, 'Decoded neighboring episode')
        self.assertEqual(bundle, import_lerobot(self.root, 1))

    def test_cross_language_browser_accepts_actual_video_bundle(self):
        fixture(self.root)
        source = self.root / 'episode.json'
        source.write_bytes(json_bytes(import_lerobot(self.root, 1)))
        script = """const fs=require('node:fs'),vm=require('node:vm');
const ctx={crypto:require('node:crypto').webcrypto,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,atob,btoa};
vm.runInNewContext(fs.readFileSync(process.argv[1],'utf8'),ctx);
ctx.BrainSNNArenaRecording.importBundle(fs.readFileSync(process.argv[2],'utf8')).then(r=>{
if(r.manifest.source.kind!=='imported')throw Error('wrong source'); console.log(r.manifest.recordingId);
}).catch(e=>{console.error(e);process.exitCode=1;});"""
        js = Path(__file__).resolve().parents[3] / 'brainsnn-r3f-app/public/arena/arena-recording.js'
        result = subprocess.run(['node', '-e', script, str(js), str(source)], capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_wrong_offsets_rejected(self):
        import pyarrow as pa
        import pyarrow.parquet as pq
        _, episodes, _ = fixture(self.root)
        episodes[1]['dataset_from_index'] = 0
        pq.write_table(pa.Table.from_pylist(episodes), self.root / 'meta/episodes/chunk-000/file-000.parquet')
        with self.assertRaisesRegex(ImportError, 'offsets'): import_lerobot(self.root, 1)

    def test_camera_offset_cannot_cross_episode(self):
        import pyarrow as pa
        import pyarrow.parquet as pq
        _, episodes, _ = fixture(self.root)
        episodes[1]['videos/observation.images.front/to_timestamp'] = 1.25
        pq.write_table(pa.Table.from_pylist(episodes), self.root / 'meta/episodes/chunk-000/file-000.parquet')
        with self.assertRaisesRegex(ImportError, 'boundary'): import_lerobot(self.root, 1)

    def test_outside_source_path_rejected(self):
        info, _, _ = fixture(self.root)
        info['data_path'] = '../outside.parquet'
        (self.root / 'meta/info.json').write_bytes(json_bytes(info))
        with self.assertRaisesRegex(ImportError, 'inside'): import_lerobot(self.root, 1)

    def test_declared_source_omission_is_partial(self):
        fixture(self.root)
        with patch('inspection.interop.MAX_ORIGINAL_BYTES', 0): bundle = import_lerobot(self.root, 1)
        m = verify_bundle(bundle)
        self.assertEqual(m['completion']['status'], 'partial')
        omitted = [a for a in m['artifacts'] if a['retention'] == 'omitted']
        self.assertTrue(omitted)
        self.assertTrue(all(a['path'] not in bundle['payloads'] for a in omitted))
        self.assertTrue(all(len(a['sha256']) == 64 for a in omitted))

    def test_mcap_exact_roundtrip_retains_epoch_ns(self):
        bundle = self.simple()
        path, second = self.root / 'run.mcap', self.root / 'again.mcap'
        export_mcap(bundle, path)
        self.assertEqual(import_mcap(path), bundle)
        export_mcap(bundle, second)
        self.assertEqual(path.read_bytes(), second.read_bytes())

    def test_mcap_external_json_preserves_original_times_and_bytes(self):
        from mcap.writer import Writer, CompressionType
        path = self.root / 'external.mcap'
        with path.open('wb') as out:
            writer = Writer(out, compression=CompressionType.NONE)
            writer.start()
            channel = writer.register_channel('/state', 'json', 0)
            writer.add_message(channel, 1792200000000000001, b'{"x":2}', 1792200000000000000, sequence=9)
            writer.finish()
        bundle = import_mcap(path)
        event = verify_bundle(bundle)['events'][0]
        self.assertEqual(event['data']['logTimeNs'], '1792200000000000001')
        self.assertEqual(event['data']['publishTimeNs'], '1792200000000000000')
        self.assertEqual(event['data']['payload'], {'x': 2})
        self.assertNotIn('simTime', event)
        self.assertEqual(base64.b64decode(bundle['payloads']['sources/recording.mcap']), path.read_bytes())

    def test_mcap_compressed_input_explicitly_refused(self):
        from mcap.writer import Writer
        path = self.root / 'compressed.mcap'
        with path.open('wb') as out:
            writer = Writer(out)
            writer.start()
            channel = writer.register_channel('/state', 'json', 0)
            writer.add_message(channel, 1, b'{"x":2}', 1)
            writer.finish()
        with self.assertRaisesRegex(ImportError, 'Compressed'): import_mcap(path)

    def test_mcap_opaque_messages_stay_opaque(self):
        from mcap.writer import Writer, CompressionType
        path = self.root / 'opaque.mcap'
        with path.open('wb') as out:
            writer = Writer(out, compression=CompressionType.NONE)
            writer.start()
            channel = writer.register_channel('/camera', 'cdr', 0)
            writer.add_message(channel, 1, b'\x00\x01\x02', 1)
            writer.finish()
        m = verify_bundle(import_mcap(path))
        self.assertFalse(m['events'][0]['data']['payloadAvailable'])
        self.assertFalse(m['outcome']['policyExecuted'])

    def test_tampered_bundle_cannot_export_mcap(self):
        bundle = self.simple()
        bundle['payloads']['source.txt'] = base64.b64encode(b'wrong source').decode()
        with self.assertRaises(RecordingError): export_mcap(bundle, self.root / 'bad.mcap')
        self.assertFalse((self.root / 'bad.mcap').exists())

    def test_duplicate_json_refused(self):
        with self.assertRaisesRegex(ImportError, 'Duplicate'): parse_json('{"a":1,"a":2}')

    def test_native_mcap_boolean_numeric_tamper_is_not_equal_evidence(self):
        from mcap.writer import Writer, CompressionType
        bundle = self.simple()
        event = json.loads(bundle['manifestText'])['events'][0]
        event['seq'] = True  # Python dict equality would treat this as 1.
        path = self.root / 'tampered.mcap'
        with path.open('wb') as out:
            writer = Writer(out, compression=CompressionType.NONE)
            writer.start()
            channel = writer.register_channel('/brainsnn/observation', 'json', 0)
            ns = int(event['monotonicNs'])
            writer.add_message(channel, ns, json_bytes(event), ns, sequence=1)
            header = {key: bundle[key] for key in ('schema', 'manifestText', 'manifestSha256')}
            writer.add_attachment(0, 0, 'brainsnn/manifest.json', 'application/json', json_bytes(header))
            writer.add_attachment(0, 0, 'artifacts/source.txt', 'text/plain', b'exact source')
            writer.finish()
        with self.assertRaisesRegex(ImportError, 'differs'): import_mcap(path)

    def test_generic_mcap_reexport_retains_log_and_publish_clock(self):
        from mcap.writer import Writer, CompressionType
        from mcap.reader import make_reader
        path = self.root / 'clock.mcap'
        with path.open('wb') as out:
            writer = Writer(out, compression=CompressionType.NONE)
            writer.start()
            channel = writer.register_channel('/state', 'json', 0)
            writer.add_message(channel, 1792200000000000001, b'{"x":2}', 1792200000000000000)
            writer.finish()
        bundle = import_mcap(path)
        exported = self.root / 'exported.mcap'
        export_mcap(bundle, exported)
        with exported.open('rb') as stream:
            message = next(make_reader(stream).iter_messages())[2]
        self.assertEqual(message.log_time, 1792200000000000001)
        self.assertEqual(message.publish_time, 1792200000000000000)
        self.assertEqual(import_mcap(exported), bundle)

    def test_declared_parquet_allocation_refused_before_decode(self):
        column = SimpleNamespace(path_in_schema='action', total_uncompressed_size=17 * 1024 * 1024)
        group = SimpleNamespace(num_columns=1, column=lambda _: column)
        metadata = SimpleNamespace(num_rows=1, num_row_groups=1, row_group=lambda _: group)
        def unexpected_decode(**kwargs): raise AssertionError('Decoder should not run')
        parquet = SimpleNamespace(metadata=metadata, iter_batches=unexpected_decode)
        with patch('pyarrow.parquet.ParquetFile', return_value=parquet):
            with self.assertRaisesRegex(ImportError, 'before decompression'):
                list(parquet_rows(self.root / 'unused.parquet', columns=['action']))

    def test_existing_destination_not_overwritten(self):
        path = self.root / 'keep.mcap'
        path.write_bytes(b'keep')
        with self.assertRaises(FileExistsError): export_mcap(self.simple(), path)
        self.assertEqual(path.read_bytes(), b'keep')

if __name__ == '__main__': unittest.main()
