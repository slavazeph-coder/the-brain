"""Observation adapter contracts. VLM outputs are explicit test doubles.

Photo/video derivatives use real Pillow, FFprobe and PyAV. These tests do not
qualify any model's visual accuracy or claim that a VLM was executed.
"""
from contextlib import contextmanager
from fractions import Fraction
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from robotics.world_worker import observations as obs

ENV = {'WORLD_VLM_ENABLED': '1', 'WORLD_VLM_MODEL': 'synthetic-test-model', 'WORLD_VLM_REVISION': 'synthetic-revision'}


def completion(entries=None, **changes):
    value = {'model': ENV['WORLD_VLM_MODEL'], 'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps({'observations': entries or []})}}]}
    value['choices'][0].update(changes)
    return json.dumps(value).encode()


@pytest.fixture
def photo(tmp_path):
    path = tmp_path / 'source.jpg'
    exif = Image.Exif()
    exif[274] = 6
    exif[270] = 'Private source metadata'
    Image.new('RGB', (1000, 600), '#4477aa').save(path, exif=exif)
    return path


def request(source, tmp_path, kind='image'):
    return {'schema': 'brainsnn.adapter.v1', 'inputs': [{'path': str(source), 'name': source.name,
            'kind': kind, 'size': source.stat().st_size}], 'output_dir': str(tmp_path / 'output')}


def test_photo_exact_hash_metadata_orientation_and_strict_artifacts(photo, tmp_path):
    calls = []
    def fake(config, payload):
        calls.append((config, payload))
        return completion([{'frameId': 'frame-0', 'label': 'Colored surface',
                            'uncertainty': 'Synthetic response; no model executed.'}])
    result = obs.run(request(photo, tmp_path), environ=ENV, transport=fake)
    assert result['source'] == {'sha256': hashlib.sha256(photo.read_bytes()).hexdigest(), 'kind': 'photo'}
    assert result['model']['provider'] == 'local-vllm'
    assert result['model']['revision'] == 'synthetic-revision'
    assert result['model']['promptSha256'] == hashlib.sha256(obs.PROMPT.encode()).hexdigest()
    frame = result['frames'][0]
    raw = (tmp_path / 'output/frame-0.png').read_bytes()
    assert frame == {'id': 'frame-0', 'sha256': hashlib.sha256(raw).hexdigest(), 'width': 307, 'height': 512, 'timestamp': None}
    with Image.open(io.BytesIO(raw)) as derivative:
        assert derivative.format == 'PNG'
        assert derivative.size == (307, 512)
        assert not derivative.info and not derivative.getexif()
    assert b'Private source metadata' not in raw
    assert len(calls) == 1
    _, payload = calls[0]
    assert payload['temperature'] == 0 and payload['max_tokens'] == 1024
    assert payload['response_format']['type'] == 'json_schema'
    schema = payload['response_format']['json_schema']
    assert schema['strict'] is True and schema['schema']['additionalProperties'] is False
    array = schema['schema']['properties']['observations']
    assert array['maxItems'] == 6 and array['items']['additionalProperties'] is False
    assert array['items']['properties']['frameId']['enum'] == ['frame-0']
    assert array['items']['properties']['label']['maxLength'] == 80
    assert array['items']['properties']['uncertainty']['maxLength'] == 180
    assert set(array['items']['properties']) == {'frameId', 'label', 'uncertainty'}
    assert 'partial selection' in payload['messages'][0]['content']
    assert payload['chat_template_kwargs'] == {'enable_thinking': False}
    assert 'tools' not in payload
    import base64
    assert base64.b64decode(payload['messages'][1]['content'][1]['image_url']['url'].split(',')[1]) == raw
    assert json.loads((tmp_path / 'output/observations.json').read_bytes()) == result
    index = json.loads((tmp_path / 'output/observation-frames.json').read_bytes())
    assert index == {'schema': 'brainsnn.world.observation-frames.v1', 'source': result['source'], 'frames': result['frames']}
    manifest = json.loads((tmp_path / 'output/manifest.json').read_bytes())
    assert manifest['artifacts'] == [{'name': 'observations.json', 'kind': 'observations'},
        {'name': 'observation-frames.json', 'kind': 'observation-index'}, {'name': 'frame-0.png', 'kind': 'observation-frame'}]


def test_disabled_by_default_before_any_io(photo, tmp_path):
    with pytest.raises(ValueError, match='disabled'):
        obs.run(request(photo, tmp_path), environ={}, transport=lambda *_: pytest.fail('HTTP called'))
    assert not (tmp_path / 'output').exists()
    with pytest.raises(ValueError, match='model ID'):
        obs.configuration({'WORLD_VLM_ENABLED': '1'})


@pytest.mark.parametrize('url', ['https://127.0.0.1/v1', 'http://example.com/v1', 'http://127.0.0.1.evil/v1',
    'http://0.0.0.0/v1', 'http://192.168.1.1/v1', 'http://user:secret@127.0.0.1/v1',
    'http://127.0.0.1/v1?redirect=remote', 'http://127.0.0.1/v1#fragment',
    'http://127.0.0.1:99999/v1', 'http://127.0.0.1/other', 'http://127.0.0.1\n/v1'])
def test_remote_or_ambiguous_endpoint_rejected(url):
    with pytest.raises(ValueError, match='loopback'):
        obs.configuration(ENV | {'WORLD_VLM_BASE_URL': url})


def test_model_revision_not_inferred_and_localhost_not_dns():
    config = obs.configuration({'WORLD_VLM_ENABLED': '1', 'WORLD_VLM_MODEL': 'qwen3.8:27b',
                                'WORLD_VLM_BASE_URL': 'http://localhost:11435/v1/'})
    assert config['host'] == '127.0.0.1' and config['revision'] is None


def test_server_key_rejects_control_unicode_and_empty_headers():
    for key in ('', 'line\nbreak', '\U0001f511', 'x' * 4097):
        with pytest.raises(ValueError, match='API key'):
            obs.configuration(ENV | {'WORLD_VLM_API_KEY': key})


@pytest.mark.parametrize('entry', [
    {'frameId': 'unknown', 'label': 'Chair', 'uncertainty': 'Occluded'},
    {'frameId': 'frame-0', 'label': 'Chair', 'uncertainty': 'Occluded', 'xyz': [1, 2, 3]},
    {'frameId': 'frame-0', 'label': 'Chair', 'uncertainty': 'Occluded', 'reviewed': True},
    {'frameId': 'frame-0', 'label': 'Chair', 'uncertainty': 0.8},
    {'frameId': 'frame-0', 'label': '', 'uncertainty': 'Occluded'},
    {'frameId': 'frame-0', 'label': 'a' * 81, 'uncertainty': 'Occluded'},
    {'frameId': 'frame-0', 'label': 'Chair', 'uncertainty': 'a' * 181},
    {'frameId': 'frame-0', 'label': '\ud800', 'uncertainty': 'Occluded'},
    {'frameId': 'frame-0', 'label': 'Chair\x00', 'uncertainty': 'Occluded'},
    *[{'frameId': 'frame-0', 'label': 'Chair', 'uncertainty': 'Occluded', 'box': b}
      for b in ([0, 0, 0, 1], [0, 0, 2, 1], [True, 0, 1, 1], [0, 0, 1], [0, 0, float('nan'), 1])],
])
def test_model_annotations_fail_closed(entry):
    with pytest.raises((ValueError, UnicodeError)):
        obs.validate_completion(completion([entry]), {'frame-0'})


def test_empty_valid_truncation_tools_duplicate_and_oversize_invalid():
    assert obs.validate_completion(completion(), {'frame-0'}) == []
    for raw in (completion(finish_reason='length'), completion(message={'tool_calls': [{'name': 'execute'}], 'content': '{}'}),
                b'x' * (obs.MAX_JSON_BYTES + 1), b'{"choices":[],"choices":[]}'):
        with pytest.raises(ValueError):
            obs.validate_completion(raw, {'frame-0'})
    nested = completion(message={'content': '{"observations":[],"observations":[]}'})
    with pytest.raises(ValueError, match='Duplicate'):
        obs.validate_completion(nested, {'frame-0'})
    with pytest.raises(ValueError, match='6'):
        obs.validate_completion(completion([{}] * 7), {'frame-0'})


def test_requested_model_alias_must_match_response():
    assert obs.validate_completion(completion(), set(), ENV['WORLD_VLM_MODEL']) == []
    with pytest.raises(ValueError, match='model alias'):
        obs.validate_completion(completion(), set(), 'different-model')
    missing = json.loads(completion())
    del missing['model']
    with pytest.raises(ValueError, match='model alias'):
        obs.validate_completion(json.dumps(missing).encode(), set(), ENV['WORLD_VLM_MODEL'])


def test_generation_rejects_even_valid_boxes_without_loosening_legacy_validation(photo, tmp_path):
    entry = {'frameId': 'frame-0', 'label': 'Surface', 'uncertainty': 'Synthetic fixture.', 'box': [0, 0, 1, 1]}
    assert obs.validate_completion(completion([entry]), {'frame-0'})[0]['box'] == [0, 0, 1, 1]
    with pytest.raises(ValueError, match='unsupported fields'):
        obs.run(request(photo, tmp_path), environ=ENV, transport=lambda *_: completion([entry]))
    assert not (tmp_path / 'output').exists()
    with pytest.raises(ValueError, match='positive normalized'):
        obs.validate_completion(completion([entry | {'box': [0, 0, 0, 1]}]), {'frame-0'})


@contextmanager
def http_fixture(status=200, body=None, headers=None):
    calls = []
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass
        def do_POST(self):
            calls.append((self.path, dict(self.headers), self.rfile.read(int(self.headers['Content-Length']))))
            self.send_response(status)
            for key, value in (headers or {}).items():
                self.send_header(key, value)
            self.end_headers()
            try:
                self.wfile.write(completion() if body is None else body)
            except (BrokenPipeError, ConnectionResetError):
                pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}/v1', calls
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def test_real_local_http_transport_ignores_proxy_and_uses_one_request(monkeypatch):
    monkeypatch.setenv('HTTP_PROXY', 'http://127.0.0.1:1')
    monkeypatch.setenv('ALL_PROXY', 'http://127.0.0.1:1')
    with http_fixture() as (url, calls):
        config = obs.configuration(ENV | {'WORLD_VLM_BASE_URL': url, 'WORLD_VLM_API_KEY': 'test-key-not-a-secret'})
        raw = obs.local_completion(config, {'test': 'fake transport response'})
        assert obs.validate_completion(raw, set()) == []
        assert len(calls) == 1 and calls[0][0] == '/v1/chat/completions'
        assert calls[0][1]['Authorization'] == 'Bearer test-key-not-a-secret'


def test_http_1_0_known_length_can_close_socket_after_final_read():
    raw = completion()
    with http_fixture(body=raw, headers={'Content-Length': str(len(raw))}) as (url, calls):
        config = obs.configuration(ENV | {'WORLD_VLM_BASE_URL': url})
        assert obs.local_completion(config, {}) == raw
        assert len(calls) == 1


@pytest.mark.parametrize('status,body,headers,match', [
    (302, b'', {'Location': 'http://example.com/'}, 'redirect'),
    (200, b'', {'Content-Length': str(obs.MAX_JSON_BYTES + 1)}, 'size'),
    (200, b'x' * (obs.MAX_JSON_BYTES + 1), {}, 'size'),
    (200, b'', {'Content-Encoding': 'gzip'}, 'Compressed'),
])
def test_real_local_http_rejects_redirects_and_unbounded_responses(status, body, headers, match):
    with http_fixture(status, body, headers) as (url, calls):
        with pytest.raises(ValueError, match=match):
            obs.local_completion(obs.configuration(ENV | {'WORLD_VLM_BASE_URL': url}), {})
        assert len(calls) == 1


def test_input_size_source_change_and_existing_output_refused(photo, tmp_path):
    data = request(photo, tmp_path)
    data['inputs'][0]['size'] += 1
    with pytest.raises(ValueError, match='size'):
        obs.run(data, environ=ENV, transport=lambda *_: pytest.fail('HTTP called'))
    data = request(photo, tmp_path)
    def changed(*_):
        photo.write_bytes(photo.read_bytes() + b'changed')
        return completion()
    with pytest.raises(ValueError, match='Source changed'):
        obs.run(data, environ=ENV, transport=changed)
    assert not (tmp_path / 'output').exists()
    out = tmp_path / 'output'
    out.mkdir()
    (out / 'observations.json').symlink_to(photo)
    with pytest.raises(FileExistsError):
        obs.run(request(photo, tmp_path), environ=ENV, transport=lambda *_: completion())
    assert not (out / 'manifest.json').exists()


def test_photo_pixel_limit_and_animated_image_refused(photo, monkeypatch, tmp_path):
    monkeypatch.setattr(obs, 'MAX_PHOTO_PIXELS', 100)
    with pytest.raises(ValueError, match='megapixels'):
        obs.png_derivative(photo)
    monkeypatch.setattr(obs, 'MAX_PHOTO_PIXELS', 24_000_000)
    animated = tmp_path / 'animated.png'
    Image.new('RGB', (10, 10)).save(animated, save_all=True, append_images=[Image.new('RGB', (10, 10), 'red')])
    with pytest.raises(ValueError, match='Animated'):
        obs.png_derivative(animated)


def test_video_real_pts_derivatives_with_explicit_fake_vlm(tmp_path):
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        pytest.skip('FFmpeg required for actual frame decoding contract')
    pytest.importorskip('av')
    source = tmp_path / 'offset.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=5:duration=1',
                    '-vf', 'setpts=PTS+2/TB', '-c:v', 'libx264', '-threads', '1', str(source)], check=True)
    result = obs.run(request(source, tmp_path, 'video'), environ=ENV, transport=lambda *_: completion())
    decoded = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
        'frame=pts:stream=time_base', '-of', 'json', str(source)], check=True, capture_output=True).stdout)
    known_pts = {str(item['pts']) for item in decoded['frames']}
    exact_base = Fraction(decoded['streams'][0]['time_base'])
    assert 1 <= len(result['frames']) <= 4 and result['source']['kind'] == 'video'
    assert result['observations'] == []
    for frame in result['frames']:
        stamp = frame['timestamp']
        assert stamp['pts'] in known_pts
        assert stamp['timeBase'] == [exact_base.numerator, exact_base.denominator]
        assert Fraction(int(stamp['pts'])) * exact_base >= 2
        assert max(frame['width'], frame['height']) == 512
        assert hashlib.sha256((tmp_path / 'output' / (frame['id'] + '.png')).read_bytes()).hexdigest() == frame['sha256']


def test_disguised_playlist_rejected_before_any_model_request(tmp_path):
    if not shutil.which('ffprobe'):
        pytest.skip('FFprobe required')
    source = tmp_path / 'playlist.mp4'
    source.write_text('#EXTM3U\n#EXTINF:1\nhttp://127.0.0.1:1/private.mp4\n')
    with pytest.raises(ValueError, match='probe rejected'):
        obs.run(request(source, tmp_path, 'video'), environ=ENV, transport=lambda *_: pytest.fail('HTTP called'))


def test_probe_output_is_bounded_while_reading():
    with pytest.raises(ValueError, match='size'):
        obs.bounded_probe([sys.executable, '-c', 'import sys;sys.stdout.buffer.write(b"x"*70000)'])


def test_standalone_video_cli_from_worker_directory_with_fake_local_server(tmp_path):
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        pytest.skip('FFmpeg required')
    pytest.importorskip('av')
    source = tmp_path / 'clip.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x64:rate=4:duration=1',
                    '-c:v', 'libx264', '-threads', '1', str(source)], check=True)
    manifest = tmp_path / 'input.json'
    manifest.write_text(json.dumps(request(source, tmp_path, 'video')))
    with http_fixture() as (url, calls):
        subprocess.run([sys.executable, str(Path(obs.__file__)), '--input-manifest', str(manifest)],
                       cwd=tmp_path, env=os.environ | ENV | {'WORLD_VLM_BASE_URL': url}, check=True, timeout=30)
        assert len(calls) == 1
    result = json.loads((tmp_path / 'output/observations.json').read_text())
    assert result['source']['kind'] == 'video' and result['observations'] == []
    assert all(f['timestamp']['timeBase'] for f in result['frames'])


def test_source_byte_budget_rejects_sparse_oversize_before_decode(tmp_path):
    source = tmp_path / 'huge.jpg'
    with source.open('wb') as handle:
        handle.truncate(obs.MAX_SOURCE_BYTES + 1)
    with pytest.raises(ValueError, match='200 MiB'):
        obs.run(request(source, tmp_path), environ=ENV, transport=lambda *_: pytest.fail('HTTP called'))


@pytest.mark.parametrize('edit', [{'format': {'duration': '121'}}, {'streams': []},
    {'stream': {'start_pts': -1}}, {'stream': {'duration_ts': 0}},
    {'stream': {'avg_frame_rate': '241/1'}}, {'stream': {'width': 50000}},
    {'stream': {'time_base': '0/1'}}])
def test_video_probe_duration_dimensions_and_timing_limits(monkeypatch, tmp_path, edit):
    monkeypatch.setattr(obs.shutil, 'which', lambda _: 'ffprobe')
    metadata = {'format': {'duration': '2'}, 'streams': [{'codec_type': 'video', 'width': 640,
        'height': 480, 'avg_frame_rate': '30/1', 'time_base': '1/30', 'start_pts': 0, 'duration_ts': 60}]}
    if 'stream' in edit:
        metadata['streams'][0].update(edit['stream'])
    else:
        metadata.update(edit)
    commands = []
    def fake(command):
        commands.append(command)
        return metadata
    monkeypatch.setattr(obs, 'bounded_probe', fake)
    with pytest.raises(ValueError):
        obs.probe_video(tmp_path / 'clip.mp4')
    command = commands[0]
    assert command[command.index('-protocol_whitelist') + 1] == 'file'
    assert command[command.index('-f') + 1] == 'mov'
    assert command[command.index('-enable_drefs') + 1] == '0'


def test_python_artifacts_pass_frontend_schema_with_independently_hashed_binding(photo, tmp_path):
    node = shutil.which('node')
    if not node:
        pytest.skip('Node required for cross-language schema contract')
    obs.run(request(photo, tmp_path), environ=ENV, transport=lambda *_: completion([
        {'frameId': 'frame-0', 'label': 'Test surface', 'uncertainty': 'Synthetic model output; no inference performed.'}]))
    module = Path(__file__).resolve().parents[2] / 'brainsnn-r3f-app/public/world/observations.mjs'
    script = '''
      import fs from 'node:fs'; import crypto from 'node:crypto'; import assert from 'node:assert/strict';
      const { importObservations } = await import(process.argv[1]);
      const folder = process.argv[2], source = process.argv[3];
      const hash = data => crypto.createHash('sha256').update(data).digest('hex');
      const index = JSON.parse(fs.readFileSync(folder + '/observation-frames.json', 'utf8'));
      assert.equal(index.source.sha256, hash(fs.readFileSync(source)));
      for (const frame of index.frames) {
        const raw = fs.readFileSync(folder + '/' + frame.id + '.png');
        assert.equal(frame.sha256, hash(raw));
        assert.equal(frame.width, raw.readUInt32BE(16)); assert.equal(frame.height, raw.readUInt32BE(20));
      }
      const session = importObservations(fs.readFileSync(folder + '/observations.json', 'utf8'),
        [{sha256: index.source.sha256, kind: index.source.kind, frames: index.frames}]);
      assert.equal(session.observations.length, 1); assert.equal(session.reviews[0].status, 'pending');
    '''
    subprocess.run([node, '--input-type=module', '-e', script, module.as_uri(), str(tmp_path / 'output'), str(photo)],
                   check=True, timeout=15)
