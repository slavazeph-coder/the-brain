#!/usr/bin/env python3
"""Repeatable, private video upload and CPU reconstruction qualification.

Run with --video FILE --out NEW_DIRECTORY outside this checkout. --upload-only
checks real upload transport; --reconstruction-only runs CPU COLMAP without
Blender or indoor scene checks. --review RUN_DIRECTORY rechecks retained
downloads and geometry in the recorded scope without executing another job.
Exit 0: requested workflow and screening passed; 2: geometry needs review;
1: execution/integrity failure; 130: interrupted. No physical accuracy claim.
"""
from __future__ import annotations

import argparse
from contextlib import suppress
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import socket
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request

from video_qualification import assess_quality

DEFAULT_REPO = Path(__file__).resolve().parents[2]
MIB = 1024 * 1024
SAFE_ARTIFACT = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$')


class QualificationError(RuntimeError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, newurl):
        return None


def digest(path):
    result = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(MIB), b''):
            result.update(chunk)
    return result.hexdigest()


def stamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def save_json(path, value):
    raw = json.dumps(value, indent=2, allow_nan=False).encode() + b'\n'
    temporary = path.with_name(path.name + '.tmp')
    with temporary.open('wb') as stream:
        os.chmod(temporary, 0o600)
        stream.write(raw)
    temporary.replace(path)


def read_json(path):
    if Path(path).stat().st_size > 32 * MIB:
        raise QualificationError('A retained JSON result exceeded its bounded read budget.')
    return json.loads(Path(path).read_bytes())


def require(condition, message):
    if not condition:
        raise QualificationError(message)


def validate_glb(path):
    """Check container structure, lengths and JSON, not just the glTF magic."""
    path = Path(path)
    with path.open('rb') as stream:
        header = stream.read(12)
        require(len(header) == 12, 'Truncated GLB header.')
        magic, version, total = struct.unpack('<4sII', header)
        require(magic == b'glTF' and version == 2 and total == path.stat().st_size,
                'GLB version or declared file length is invalid.')
        chunks = []
        while stream.tell() < total:
            chunk_header = stream.read(8)
            require(len(chunk_header) == 8, 'Truncated GLB chunk header.')
            length, kind = struct.unpack('<II', chunk_header)
            require(length % 4 == 0 and stream.tell() + length <= total, 'GLB chunk exceeds its container.')
            if kind == 0x4E4F534A:
                require(length <= 32 * MIB, 'GLB JSON exceeds its bounded read budget.')
                value = json.loads(stream.read(length))
                require(value.get('asset', {}).get('version') == '2.0' and value.get('meshes'),
                        'GLB does not contain a version-2 mesh scene.')
            else:
                stream.seek(length, 1)
            chunks.append(kind)
        require(chunks and chunks[0] == 0x4E4F534A and chunks.count(0x4E4F534A) == 1,
                'GLB must begin with one JSON chunk.')


def verify_retained(directory):
    """Verify every retained download against the original test manifest."""
    result = {}
    for stage in ('reconstruction', 'scene'):
        manifest = directory / f'{stage}-download-verification.json'
        if not manifest.exists():
            if stage == 'scene':
                continue
            raise QualificationError('Retained reconstruction download manifest is missing.')
        rows = read_json(manifest)
        require(isinstance(rows, list) and rows, 'Empty download verification manifest.')
        names = set()
        for row in rows:
            name = row['name']
            require(isinstance(name, str) and SAFE_ARTIFACT.fullmatch(name) and name not in names,
                    'Unsafe or duplicate retained artifact name.')
            names.add(name)
            path = directory / 'downloads' / stage / name
            require(path.is_file() and not path.is_symlink() and path.resolve().is_relative_to(directory.resolve()),
                    'Retained artifact is missing or escapes the run directory.')
            require(path.stat().st_size == row['bytes'] and digest(path) == row['sha256'],
                    f'Retained artifact {name} failed exact size/hash verification.')
        required = {'reconstruction.json', 'camera-frames.json', 'sparse-preview.ply'} if stage == 'reconstruction' else {
            'scene.glb', 'scene.json', 'scene-usd.json', 'arena-cloud.json'}
        require(required <= names, f'Retained {stage} artifacts are incomplete.')
        result[stage] = rows
    return result


def check_unscaled(scene, receipt, artifact_names):
    require(scene.get('units') == 'arbitrary' and scene.get('scale') is None,
            'Unscaled scene made an unexpected metric-scale claim.')
    require(all(receipt.get(key) is False for key in (
        'metric_verified', 'policy_executed', 'model_weights_used', 'physics_ready')),
        'Scene receipt makes an unsupported physical/model execution claim.')
    forbidden = {'scene.ifc', 'scene.usda', 'scene.3dm', 'scene-plan.dxf', 'quantities.csv',
                 'scene-measurements.json', 'component-fit.json', 'nav2-map.json',
                 'map.pgm', 'map.yaml', 'nav2-map.pgm', 'nav2-map.yaml'}
    require(not (set(artifact_names) & forbidden), 'Metric-only outputs appeared without a measured scale.')
    require(not any(isinstance(receipt.get(key), dict) and receipt[key].get('written') is True
                    for key in ('usd', 'ifc', 'component_fit', 'navigation', 'component_graph', 'component_evidence')),
            'Metric-only evidence was reported as written for an unscaled scene.')


def check_admitted_upload(upload, source):
    require(upload['sha256'] == source['sha256'] and upload['bytes'] == source['bytes'],
            'Video changed after preflight; uploaded bytes do not match the admitted capture.')


def retained_mode(directory, admitted):
    """A missing scene is allowed only for a recorded reconstruction-only run.

    Legacy runs default to the full workflow. The request written before a new
    run is hash-bound by its summary and tied to the admitted source, so deleting
    a full run's scene or changing only its reported mode cannot downgrade it.
    These local hashes detect inconsistency, not a rewritten or signed history.
    """
    summary_path = directory / 'summary.json'
    if not summary_path.exists():
        return 'full'
    require(summary_path.is_file() and not summary_path.is_symlink(), 'Invalid retained run summary.')
    summary = read_json(summary_path)
    mode = summary.get('mode', 'full')
    require(mode in ('full', 'reconstruction-only'), 'Retained run has no reconstruction qualification scope.')
    if mode == 'full':
        return mode
    require(summary.get('schema') == 'brainsnn.video-qualification.v1', 'Unexpected retained run summary schema.')
    record = summary.get('request', {})
    path = directory / 'qualification-request.json'
    require(record.get('name') == path.name and path.is_file() and not path.is_symlink()
            and path.resolve().is_relative_to(directory.resolve()), 'Reconstruction-only request evidence is missing.')
    require(path.stat().st_size == record.get('bytes') and digest(path) == record.get('sha256'),
            'Retained qualification request failed size/hash verification.')
    request = read_json(path)
    require(request.get('schema') == 'brainsnn.video-qualification-request.v1'
            and request.get('mode') == mode, 'Retained request and summary disagree on qualification scope.')
    source = request.get('source', {})
    require(all(source.get(key) == admitted.get(key) for key in ('name', 'kind', 'sha256'))
            and type(source.get('bytes')) is int and source['bytes'] > 0,
            'Retained qualification request belongs to another source.')
    require(all(summary.get('source', {}).get(key) == source.get(key) for key in ('name', 'sha256', 'bytes')),
            'Retained run summary and request belong to different sources.')
    require(not summary.get('sceneJob') and 'scene' not in summary,
            'A reconstruction-only run cannot contain a scene execution.')
    return mode


def review(args):
    """Re-evaluate retained evidence; never pretend this executes a new worker job."""
    output = args.out.absolute()
    initialized = False
    report = {'schema': 'brainsnn.video-qualification-review.v1', 'startedAt': stamp(),
              'mode': 'retained-review', 'softwareWorkflowExecuted': False,
              'physicalAccuracyValidated': False, 'artifactIntegrityPassed': False}
    code = 1
    try:
        source = args.review.resolve()
        require(source.is_dir(), '--review must name an existing run directory.')
        require(not output.exists() and not output.is_symlink(), 'Use a fresh absent output directory.')
        require(not output.resolve().is_relative_to(args.repo)
                and not output.resolve().is_relative_to(source), 'Review output must be outside the checkout and source run.')
        output.mkdir(parents=True, mode=0o700)
        initialized = True
        verified = verify_retained(source)
        reconstruction_path = source / 'downloads/reconstruction/reconstruction.json'
        reconstruction = read_json(reconstruction_path)
        ledger = read_json(source / 'downloads/reconstruction/camera-frames.json')
        require(reconstruction.get('schema') == 'brainsnn.reconstruction.v1'
                and ledger.get('schema') == 'brainsnn.camera-frames.v1', 'Unexpected retained evidence schema.')
        require(len(reconstruction.get('sources', [])) == 1 and reconstruction['sources'] == ledger.get('sources'),
                'Retained reconstruction and camera ledger belong to different sources.')
        admitted = reconstruction['sources'][0]
        require(admitted.get('kind') == 'video' and isinstance(admitted.get('sha256'), str)
                and re.fullmatch(r'[0-9a-f]{64}', admitted['sha256']), 'Retained video source identity is invalid.')
        if args.expected_video_sha256:
            require(admitted['sha256'] == args.expected_video_sha256, 'Retained source differs from --expected-video-sha256.')
        require(ledger.get('reconstruction', {}).get('sha256') == digest(reconstruction_path),
                'Camera ledger is bound to another reconstruction receipt.')
        preview = source / 'downloads/reconstruction/sparse-preview.ply'
        require(any(c.get('sha256') == digest(preview) for c in ledger.get('clouds', [])),
                'Camera ledger is bound to another point cloud.')
        require(reconstruction.get('units') == 'arbitrary' and reconstruction.get('metric_verified') is False,
                'Retained unmeasured reconstruction claims metric scale.')
        mode = retained_mode(source, admitted)
        report['originalMode'] = mode
        folded = reconstruction.get('capture', {}).get('consistency', {}).get('status') == 'folded'
        require('scene' in verified or folded or mode == 'reconstruction-only',
                'Scene download manifest is required for a non-folded full qualification review.')
        require(mode != 'reconstruction-only' or 'scene' not in verified,
                'Unexpected scene artifacts in a reconstruction-only review.')
        receipt = None
        if 'scene' in verified:
            scene_dir = source / 'downloads/scene'
            receipt = read_json(scene_dir / 'scene-usd.json')
            check_unscaled(read_json(scene_dir / 'scene.json'), receipt,
                           [row['name'] for row in verified['scene']])
            cloud = read_json(scene_dir / 'arena-cloud.json')
            require(cloud.get('units') == 'arbitrary' and cloud.get('scale') is None,
                    'Retained scene cloud unexpectedly changed scale.')
            validate_glb(scene_dir / 'scene.glb')
        quality = assess_quality(reconstruction, ledger, receipt,
            min_registration_fraction=args.min_registration_fraction, min_wall_support=args.min_wall_support)
        report.update(artifactIntegrityPassed=True, geometryQuality=quality,
                      status='screening-passed' if quality['screeningPassed'] else 'geometry-review-required',
                      source=reconstruction['sources'], verifiedArtifacts=verified)
        save_json(output / 'geometry-quality.json', quality)
        code = 0 if quality['screeningPassed'] else 2
    except Exception as error:
        report.update(status='failed', failure={'type': type(error).__name__, 'message': str(error)[:1600]})
    report.update(finishedAt=stamp(), exitCode=code)
    if initialized:
        save_json(output / 'summary.json', report)
    print(json.dumps(report, allow_nan=False), flush=True)
    return code


class Run:
    def __init__(self, args):
        self.args = args
        self.repo = args.repo.resolve()
        self.video = args.video.absolute() if args.video else None
        self.out = args.out.absolute()
        self.token = secrets.token_urlsafe(36)
        # Environment proxies must never receive local bearer credentials.
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect)
        self.server = None
        self.server_log = None
        self.base = None
        self.active_job = None
        self.initialized = False
        self.started = time.monotonic()
        self.mode = ('upload-only' if args.upload_only else
                     'reconstruction-only' if args.reconstruction_only else 'full')
        self.summary = {'schema': 'brainsnn.video-qualification.v1', 'startedAt': stamp(),
            'mode': self.mode,
            'status': 'starting', 'softwareWorkflowPassed': False, 'metricBimProduced': False,
            'physicalAccuracyValidated': False, 'robotValidated': False, 'paidModelCalls': 0,
            'scaleSupplied': False, 'measurementsSupplied': False,
            'layoutUsableClaim': False,
            'scope': ('Private HTTP upload and CPU sparse reconstruction only; no scene, metric scale, '
                      'surface completeness, geographic alignment or physical accuracy acceptance.'
                      if self.mode == 'reconstruction-only' else
                      'Private HTTP upload and optional CPU reconstruction/unscaled scene; heuristic geometry screening, no physical accuracy acceptance.')}

    def safe_error(self, error):
        return str(error).replace(self.token, '[redacted ephemeral credential]')[:1600]

    def event(self, stage, **fields):
        row = {'time': stamp(), 'elapsedSeconds': round(time.monotonic() - self.started, 3),
               'stage': stage, **fields}
        with (self.out / 'progress.jsonl').open('a') as stream:
            os.chmod(self.out / 'progress.jsonl', 0o600)
            stream.write(json.dumps(row, allow_nan=False) + '\n')
        save_json(self.out / 'status.json', row)
        print(json.dumps(row, allow_nan=False), flush=True)

    def preflight(self):
        def git(*args):
            return subprocess.check_output(['git', '-C', str(self.repo), *args], text=True).strip()
        head = git('rev-parse', 'HEAD')
        if self.args.expected_head:
            require(head == self.args.expected_head, 'Checkout HEAD differs from --expected-head.')
        dirty = bool(git('status', '--porcelain'))
        diff = subprocess.check_output(['git', '-C', str(self.repo), 'diff', 'HEAD', '--binary'])
        paths = [self.video, self.args.python]
        if self.mode == 'full':
            paths.append(self.args.blender)
        for path in paths:
            require(path is not None and path.is_absolute() and path.is_file(),
                    'Required private input or runtime executable is missing. See --help.')
        require(not self.video.is_symlink(), 'The source video must be a regular file, not a symlink.')
        require(shutil.which('ffprobe') and (self.args.upload_only or shutil.which('ffmpeg')),
                'Install ffprobe and ffmpeg for this test.')
        require(not self.out.exists() and not self.out.is_symlink(), 'Use a fresh absent private output directory.')
        require(not self.out.resolve().is_relative_to(self.repo),
                'Private video qualification outputs must stay outside the Git checkout.')
        source_hash = digest(self.video)
        if self.args.expected_video_sha256:
            require(source_hash == self.args.expected_video_sha256, 'The supplied video hash differs from --expected-video-sha256.')
        self.args.expected_video_sha256 = source_hash
        self.out.mkdir(parents=True, mode=0o700)
        self.initialized = True
        self.worker_dir = self.out / 'worker'
        self.worker_dir.mkdir(mode=0o700)
        (self.out / 'home').mkdir(mode=0o700)
        for directory in ('reconstruction', 'scene'):
            (self.out / 'downloads' / directory).mkdir(parents=True, mode=0o700)
        metadata = subprocess.run(['ffprobe', '-v', 'error', '-show_entries',
            'format=duration,size:stream=index,codec_type,codec_name,width,height,r_frame_rate',
            '-of', 'json', str(self.video)], capture_output=True, check=True, timeout=20)
        require(len(metadata.stdout) <= 65536, 'Video metadata exceeds the preflight budget.')
        metadata = json.loads(metadata.stdout)
        duration = float(metadata['format']['duration'])
        require(2 <= duration <= 300 and self.video.stat().st_size <= 2 * 1024**3,
                'Video is outside the current five-minute/2 GiB upload contract.')
        save_json(self.out / 'source-metadata.json', metadata)
        require(any(s.get('codec_type') == 'video' for s in metadata.get('streams', [])),
                'The supplied file contains no video stream.')
        source = {'name': self.video.name, 'sha256': source_hash,
                  'bytes': self.video.stat().st_size, 'durationSeconds': duration,
                  'framesBudget': max(60, min(300, round(duration))), 'metadata': metadata}
        self.summary.update(checkout={'commit': head, 'tree': git('rev-parse', 'HEAD^{tree}'),
            'dirty': dirty, 'trackedDiffSha256': hashlib.sha256(diff).hexdigest(),
            'qualifierSha256': digest(Path(__file__)),
            'evaluatorSha256': digest(Path(__file__).with_name('video_qualification.py'))},
            source=source, runtime={
            'workerPython': str(self.args.python),
            'blenderExecutable': str(self.args.blender) if self.mode == 'full' and self.args.blender else None,
            'cpuThreads': 2, 'adapterTimeoutSeconds': self.args.timeout,
            'requestScope': 'Loopback HTTP with proxies and redirects disabled; offline model flags are not a network sandbox.'})
        request_path = self.out / 'qualification-request.json'
        save_json(request_path, {'schema': 'brainsnn.video-qualification-request.v1', 'mode': self.mode,
                                'source': {'name': source['name'], 'kind': 'video', 'sha256': source_hash,
                                           'bytes': source['bytes']}})
        self.summary['request'] = {'name': request_path.name, 'bytes': request_path.stat().st_size,
                                   'sha256': digest(request_path)}
        self.event('preflight-passed', checkoutCommit=head, dirty=dirty, videoBytes=source['bytes'],
                   durationSeconds=duration, frameBudget=source['framesBudget'], videoSha256=source['sha256'], mode=self.mode)

    def request(self, method, path, *, body=None, raw=None, expected=(200,), auth=True, timeout=30):
        headers = {'Authorization': 'Bearer ' + self.token} if auth else {}
        if body is not None:
            raw = json.dumps(body, allow_nan=False).encode()
            headers['Content-Type'] = 'application/json'
        elif raw is not None:
            headers['Content-Type'] = 'application/octet-stream'
        if method in ('POST', 'PUT', 'PATCH') and raw is None:
            raw = b''
        request = urllib.request.Request(self.base + path, data=raw, method=method, headers=headers)
        try:
            with self.opener.open(request, timeout=timeout) as response:
                status, payload = response.status, response.read(2 * MIB + 1)
        except urllib.error.HTTPError as error:
            status, payload = error.code, error.read(65536)
        except (OSError, urllib.error.URLError) as error:
            raise QualificationError(f'{method} {path.split("/ticket")[0]}: local worker network error ({type(error).__name__}).') from error
        require(status in expected, f'{method} {path}: HTTP {status}, {payload[:400].decode(errors="replace")}')
        require(len(payload) <= 2 * MIB, 'A worker JSON response exceeded the qualification budget.')
        return json.loads(payload) if payload else None

    def start_worker(self):
        worker = self.repo / 'robotics' / 'world_worker'
        python = str(self.args.python)
        adapters = [
            {'id': 'colmap-sparse', 'label': 'Actual phone capture CPU qualification', 'enabled': True,
             'license_reviewed': True, 'input_kinds': ['video'], 'max_inputs': 1,
             'timeout_seconds': self.args.timeout,
             'command': [python, '-B', str(worker / 'sparse_colmap.py'), '--input-manifest', '{input_manifest}']},
            {'id': 'scene-usd', 'label': 'Unscaled scene from the retained actual reconstruction', 'enabled': True,
             'license_reviewed': True, 'input_kinds': ['cloud'], 'max_inputs': 1, 'source_job': True,
             'timeout_seconds': self.args.timeout,
             'command': [python, '-B', str(worker / 'scene_usd.py'), '--input-manifest', '{input_manifest}',
                         '--blender', str(self.args.blender)]}]
        if self.args.upload_only:
            adapters = []
        elif self.args.reconstruction_only:
            adapters = adapters[:1]
        config = self.out / 'adapters.json'; save_json(config, adapters)
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0)); port = listener.getsockname()[1]
        self.base = f'http://127.0.0.1:{port}'
        env = {key: os.environ[key] for key in ('PATH', 'LD_LIBRARY_PATH', 'SYSTEMROOT') if key in os.environ}
        env.update({'HOME': str(self.out / 'home'), 'WORLD_WORKER_TOKEN': self.token,
            'WORLD_WORKER_DIR': str(self.worker_dir), 'WORLD_ADAPTERS_FILE': str(config),
            'WORLD_CPU_THREADS': '2', 'CUDA_VISIBLE_DEVICES': '', 'HF_HUB_OFFLINE': '1',
            'TRANSFORMERS_OFFLINE': '1', 'PYTHONUNBUFFERED': '1', 'PYTHONDONTWRITEBYTECODE': '1',
            'WORLD_ALLOWED_ORIGINS': 'https://brainsnn.com,https://www.brainsnn.com,http://127.0.0.1:4181'})
        self.server_log = (self.out / 'worker-server.log').open('wb')
        self.server = subprocess.Popen([python, '-B', '-m', 'uvicorn', 'robotics.world_worker.app:create_app',
            '--factory', '--host', '127.0.0.1', '--port', str(port), '--no-access-log'], cwd=self.repo,
            env=env, stdin=subprocess.DEVNULL, stdout=self.server_log, stderr=subprocess.STDOUT,
            start_new_session=True)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            require(self.server.poll() is None, 'Private worker exited during startup; inspect worker-server.log.')
            try:
                health = self.request('GET', '/healthz', auth=False, timeout=2)
                if health.get('status') == 'ok':
                    break
            except QualificationError:
                time.sleep(.2)
        else:
            raise QualificationError('Private worker did not become healthy within 30 seconds.')
        self.request('GET', '/v1/capabilities', auth=False, expected=(401,))
        capabilities = self.request('GET', '/v1/capabilities')
        available = {item['id'] for item in capabilities['engines'] if item.get('available')}
        if not self.args.upload_only:
            required = {'colmap-sparse'} if self.args.reconstruction_only else {'colmap-sparse', 'scene-usd'}
            require(required <= available, 'Required real reconstruction/scene adapters are unavailable.')
        require(capabilities['limits']['video_bytes'] >= self.video.stat().st_size,
                'Worker rejects the attached video size.')
        self.chunk_bytes = int(capabilities['limits']['chunk_bytes'])
        require(0 < self.chunk_bytes <= 4 * MIB, 'Unexpected upload chunk budget.')
        save_json(self.out / 'capabilities.json', capabilities)
        self.event('worker-ready', url=self.base, serverPid=self.server.pid, tokenPersisted=False,
                   accessLogsDisabled=True, cpuThreads=2)

    def upload(self, path, kind, *, test_resume=False):
        path = Path(path); size = path.stat().st_size
        item = self.request('POST', '/v1/uploads', body={'name': path.name, 'kind': kind, 'size': size}, expected=(201,))
        identifier = item['id']; count = 0; start = time.monotonic()
        with path.open('rb') as source:
            if test_resume:
                require(size > 1, 'Resume testing needs at least two bytes.')
                first = source.read(min(self.chunk_bytes, MIB, size - 1))
                item = self.request('PUT', f'/v1/uploads/{identifier}?offset=0', raw=first)
                count += 1
                resumed = self.request('GET', f'/v1/uploads/{identifier}')
                require(item['offset'] == resumed['offset'] == len(first), 'Partial upload offset was not retained.')
                self.request('PUT', f'/v1/uploads/{identifier}?offset=0', raw=first, expected=(409,))
                require(self.request('GET', f'/v1/uploads/{identifier}')['offset'] == len(first),
                        'Rejected stale offset changed the upload.')
                self.event('partial-upload-resume-verified', name=path.name, uploadId=identifier,
                           retainedOffset=len(first), staleOffsetRejected=True)
            while item['offset'] < size:
                source.seek(item['offset'])
                part = source.read(self.chunk_bytes)
                previous = item['offset']
                item = self.request('PUT', f'/v1/uploads/{identifier}?offset={previous}', raw=part, timeout=60)
                count += 1
                require(item['offset'] == previous + len(part), 'Chunk upload did not advance exactly to its acknowledged offset.')
        final = self.request('GET', f'/v1/uploads/{identifier}')
        require(final['offset'] == final['size'] == size, 'Final upload size differs from the source.')
        stored = self.worker_dir / 'uploads' / identifier
        source_hash = digest(path)
        require(digest(stored) == source_hash, 'The HTTP-uploaded file bytes differ from the original source.')
        result = {'id': identifier, 'name': path.name, 'kind': kind, 'bytes': size, 'sha256': source_hash,
                  'acceptedChunks': count, 'partialResumeChecked': test_resume,
                  'staleOffsetRejected': test_resume, 'elapsedSeconds': round(time.monotonic() - start, 3)}
        self.event('upload-complete', **result)
        return result

    def run_job(self, engine, upload_id, *, source_job=None):
        job = self.request('POST', '/v1/jobs', body={'engine': engine, 'upload_ids': [upload_id], 'consent': True,
            **({'source_job': source_job} if source_job else {})}, expected=(201,))
        self.active_job = job['id']
        require(job['status'] == 'prepared', 'Job did not remain prepared until explicit start.')
        self.request('POST', f'/v1/jobs/{job["id"]}/start')
        self.event('job-started', engine=engine, jobId=job['id'], sourceJob=source_job)
        start = time.monotonic(); deadline = start + self.args.timeout + 30
        last_status = None
        while True:
            require(self.server.poll() is None, 'Private worker exited while an actual job was active.')
            job = self.request('GET', f'/v1/jobs/{job["id"]}')
            save_json(self.out / f'{engine}-job.json', job)
            elapsed = round(time.monotonic() - start, 3)
            self.event('job-progress', engine=engine, jobId=job['id'], status=job['status'],
                       jobElapsedSeconds=elapsed, statusChanged=job['status'] != last_status)
            last_status = job['status']
            if job['status'] in ('complete', 'failed', 'cancelled'):
                self.active_job = None
                require(job['status'] == 'complete', f'{engine} {job["status"]}: {job.get("error") or "no successful result"}')
                return job
            require(time.monotonic() <= deadline, f'{engine} did not terminate within its external time budget.')
            time.sleep(5)

    def download_all(self, job, stage):
        records = []
        for index, entry in enumerate(job['artifacts']):
            name = entry['name']
            require(SAFE_ARTIFACT.fullmatch(name) is not None and Path(name).name == name,
                    'Unsafe artifact name in worker manifest.')
            require(not any(row['name'] == name for row in records), 'Duplicate artifact name in manifest.')
            require(type(entry['size']) is int and 0 < entry['size'] <= 2 * 1024**3
                    and re.fullmatch(r'[0-9a-f]{64}', entry['sha256']), 'Invalid artifact size/hash in manifest.')
            ticket = self.request('POST', f'/v1/jobs/{job["id"]}/ticket', body={'artifact': index})
            route = ticket['url']
            require(route.startswith('/v1/download/') and '?' not in route and '://' not in route,
                    'Download ticket did not remain on the local worker.')
            target = self.out / 'downloads' / stage / name
            temporary = target.with_name(target.name + '.partial')
            h = hashlib.sha256(); size = 0
            try:
                with self.opener.open(self.base + route, timeout=60) as response, temporary.open('wb') as stream:
                    os.chmod(temporary, 0o600)
                    require(response.status == 200, 'Ticketed download did not return the artifact.')
                    while True:
                        chunk = response.read(MIB)
                        if not chunk:
                            break
                        size += len(chunk)
                        require(size <= entry['size'], 'Artifact exceeded its declared size.')
                        h.update(chunk); stream.write(chunk)
            except (OSError, urllib.error.URLError) as error:
                raise QualificationError(f'Ticketed download failed for {name} ({type(error).__name__}); no ticket is retained.') from error
            require(size == entry['size'] and h.hexdigest() == entry['sha256'],
                    f'Artifact {name} failed exact manifest size/hash verification.')
            temporary.replace(target)
            records.append({'name': name, 'bytes': size, 'sha256': h.hexdigest(), 'ticketDownloadVerified': True})
        save_json(self.out / f'{stage}-download-verification.json', records)
        self.event('downloads-verified', resultStage=stage, artifacts=len(records), bytes=sum(row['bytes'] for row in records))
        return records

    def reconstruct(self):
        upload = self.upload(self.video, 'video', test_resume=True)
        check_admitted_upload(upload, self.summary['source'])
        self.summary['upload'] = upload
        job = self.run_job('colmap-sparse', upload['id'])
        self.summary['reconstructionJob'] = job['id']
        records = self.download_all(job, 'reconstruction')
        output = self.out / 'downloads' / 'reconstruction'
        reconstruction = read_json(output / 'reconstruction.json')
        require(reconstruction.get('schema') == 'brainsnn.reconstruction.v1'
                and len(reconstruction.get('sources', [])) == 1, 'Unexpected reconstruction receipt or source count.')
        require(reconstruction['sources'][0]['sha256'] == self.args.expected_video_sha256,
                'Reconstruction receipt belongs to another original capture.')
        require(reconstruction['sources'][0]['name'] == self.video.name
                and reconstruction['sources'][0]['kind'] == 'video', 'Reconstruction source identity changed.')
        require(reconstruction.get('units') == 'arbitrary' and reconstruction.get('metric_verified') is False,
                'Unmeasured phone reconstruction made an unexpected metric claim.')
        require(reconstruction.get('pipeline') == 'colmap-sparse' and reconstruction.get('device') == 'cpu'
                and reconstruction.get('model_weights_used') is False, 'Unexpected reconstruction implementation/model scope.')
        sys.path.insert(0, str(self.repo))
        from robotics.world_worker import camera_frames
        job_root = self.worker_dir / 'jobs' / job['id']
        ledger = camera_frames.load_record(job_root)
        require(ledger['sources'][0]['sha256'] == self.args.expected_video_sha256,
                'Registered camera ledger belongs to another capture.')
        capture = reconstruction['capture']
        require(len(ledger['frames']) == capture['registered_images'], 'Registered-camera count differs from the validated ledger.')
        require(capture['images'] <= self.summary['source']['framesBudget'], 'Extractor exceeded its admitted frame budget.')
        self.summary['reconstruction'] = {
            key: reconstruction.get(key) for key in ('pipeline', 'pycolmap_version', 'device', 'reconstructed_points', 'preview_points',
                'mean_reprojection_error_pixels', 'elapsed_seconds', 'coordinate_frame', 'units', 'metric_verified',
                'warnings', 'review_required')}
        self.summary['reconstruction']['capture'] = {key: capture.get(key) for key in (
            'duration_seconds', 'frame_budget', 'images', 'registered_images', 'registration_fraction',
            'models_found', 'model_index', 'mapping_attempts', 'matching', 'discarded_frames',
            'near_duplicate_frames', 'consistency', 'timestamp_evidence', 'pixel_geometry_evidence')}
        self.summary['reconstruction']['validatedLedgerFrames'] = len(ledger['frames'])
        self.summary['reconstruction']['ticketedArtifacts'] = records
        self.event('reconstruction-checked', jobId=job['id'], images=capture['images'],
            registeredImages=capture['registered_images'], points=reconstruction['reconstructed_points'],
            meanReprojectionErrorPixels=reconstruction['mean_reprojection_error_pixels'],
            consistency=(capture.get('consistency') or {}).get('status'),
            originalFrameTimestampsAvailable=False, physicalAccuracyValidated=False)
        return job, reconstruction

    def compile_scene(self, rec_job, reconstruction):
        from robotics.world_worker.scene_usd import read_ply, to_arena_cloud
        preview = self.out / 'downloads' / 'reconstruction' / 'sparse-preview.ply'
        cloud = to_arena_cloud(read_ply(preview), coordinate_frame=reconstruction['coordinate_frame'],
                               source='sparse-preview.ply', metres_per_unit=None)
        require(cloud['units'] == 'arbitrary' and cloud['scale'] is None,
                'The unmeasured handoff must remain explicitly unscaled.')
        require('measurementChecks' not in cloud and 'bimReview' not in cloud and not cloud.get('nameObjects'),
                'No fabricated readings, openings or semantic provider request may enter this run.')
        path = self.out / 'unscaled-arena-cloud.json'; save_json(path, cloud)
        upload = self.upload(path, 'cloud')
        job = self.run_job('scene-usd', upload['id'], source_job=rec_job['id'])
        self.summary['sceneJob'] = job['id']
        records = self.download_all(job, 'scene')
        output = self.out / 'downloads' / 'scene'
        scene, receipt = read_json(output / 'scene.json'), read_json(output / 'scene-usd.json')
        validate_glb(output / 'scene.glb')
        names = {entry['name'] for entry in job['artifacts']}
        check_unscaled(scene, receipt, names)
        kept_cloud = read_json(output / 'arena-cloud.json')
        require(kept_cloud.get('units') == 'arbitrary' and kept_cloud.get('scale') is None,
                'Saved scene source cloud unexpectedly changed scale.')
        self.summary['scene'] = {'units': scene['units'], 'scale': None, 'counts': scene.get('counts'),
            'warnings': receipt.get('warnings'), 'reviewRequired': receipt.get('review_required'),
            'compiler': receipt.get('compiler'), 'elapsedSeconds': receipt.get('elapsed_seconds'),
            'measurements': receipt.get('measurements'), 'componentFitting': receipt.get('component_fit'),
            'navigation': receipt.get('navigation'), 'ticketedArtifacts': records,
            'metricExportsCorrectlySkipped': True}
        self.event('unscaled-scene-verified', jobId=job['id'], counts=scene.get('counts'),
                   metricExportsCorrectlySkipped=True, layoutUsableClaim=False)
        return receipt

    def cleanup(self):
        if self.active_job and self.base and self.server and self.server.poll() is None:
            with suppress(Exception):
                self.request('DELETE', f'/v1/jobs/{self.active_job}', timeout=15)
        if self.server and self.server.poll() is None:
            with suppress(ProcessLookupError):
                os.killpg(self.server.pid, signal.SIGTERM)
            try:
                self.server.wait(timeout=15)
            except subprocess.TimeoutExpired:
                with suppress(ProcessLookupError):
                    os.killpg(self.server.pid, signal.SIGKILL)
                self.server.wait(timeout=5)
        if self.server_log:
            self.server_log.close()
        self.summary['workerStopped'] = self.server is None or self.server.poll() is not None
        self.summary['ephemeralTokenPersisted'] = False

    def run(self):
        exit_code = 1
        try:
            self.preflight()
            self.start_worker()
            if self.args.upload_only:
                self.summary['upload'] = self.upload(self.video, 'video', test_resume=True)
                check_admitted_upload(self.summary['upload'], self.summary['source'])
                self.summary.update(status='upload-passed', softwareWorkflowPassed=True,
                                    geometryQuality={'status': 'not-evaluated', 'screeningPassed': None,
                                                     'physicalAccuracyValidated': False})
                exit_code = 0
                return exit_code
            rec_job, reconstruction = self.reconstruct()
            ledger = read_json(self.out / 'downloads/reconstruction/camera-frames.json')
            receipt = None
            folded = (reconstruction['capture'].get('consistency') or {}).get('status') == 'folded'
            if self.args.reconstruction_only:
                # Execution/integrity can succeed even when the actual geometry
                # fails screening. Full mode still requires scene execution.
                self.summary['softwareWorkflowPassed'] = True
            if folded:
                self.summary['status'] = 'recapture-required-folded'
                self.summary['sceneSkippedReason'] = 'Reconstruction contradicts its consecutive frames; no layout usability claim.'
                self.event('scene-skipped-folded', physicalAccuracyValidated=False)
                exit_code = 2
            elif self.args.reconstruction_only:
                self.summary['sceneSkippedReason'] = 'Reconstruction-only scope requested; no indoor scene or floor screening.'
                self.summary['softwareWorkflowPassed'] = True
                self.event('reconstruction-only-verified', units='arbitrary', metricVerified=False,
                           sceneAssessed=False, surfaceCompletenessValidated=False, geographicAlignmentValidated=False)
            else:
                receipt = self.compile_scene(rec_job, reconstruction)
                self.summary['softwareWorkflowPassed'] = True
            quality = assess_quality(reconstruction, ledger, receipt,
                min_registration_fraction=self.args.min_registration_fraction,
                min_wall_support=self.args.min_wall_support)
            self.summary['geometryQuality'] = quality
            save_json(self.out / 'geometry-quality.json', quality)
            if not folded:
                success = 'complete-reconstruction-only' if self.args.reconstruction_only else 'complete-unscaled'
                self.summary['status'] = success if quality['screeningPassed'] else 'geometry-review-required'
                exit_code = 0 if quality['screeningPassed'] else 2
        except BaseException as error:
            self.summary['status'] = 'interrupted' if isinstance(error, KeyboardInterrupt) else 'failed'
            self.summary['failure'] = {'type': type(error).__name__, 'message': self.safe_error(error)}
            if self.initialized:
                self.event('qualification-failed', errorType=type(error).__name__, message=self.safe_error(error))
            else:
                print(json.dumps({'stage': 'preflight-refused', 'errorType': type(error).__name__,
                                  'message': self.safe_error(error)}), file=sys.stderr, flush=True)
            exit_code = 130 if isinstance(error, KeyboardInterrupt) else 1
        finally:
            self.cleanup()
            self.summary.update(finishedAt=stamp(), totalElapsedSeconds=round(time.monotonic() - self.started, 3),
                                exitCode=exit_code)
            if self.initialized:
                save_json(self.out / 'summary.json', self.summary)
                self.event('finished', status=self.summary['status'], exitCode=exit_code,
                           softwareWorkflowPassed=self.summary['softwareWorkflowPassed'],
                           physicalAccuracyValidated=False, workerStopped=self.summary['workerStopped'])
        return exit_code


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=DEFAULT_REPO)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--video', type=Path, help='Private local walkthrough video, never added to git.')
    mode.add_argument('--review', type=Path, help='Existing run directory; verify retained hashes and reassess its recorded scope.')
    parser.add_argument('--python', type=Path, default=Path(sys.executable))
    parser.add_argument('--blender', type=Path, default=Path(shutil.which('blender')) if shutil.which('blender') else None)
    parser.add_argument('--expected-head', help='Optional exact checkout SHA guard, including feature branches.')
    parser.add_argument('--expected-video-sha256', help='Optional admitted source SHA256 guard.')
    parser.add_argument('--out', type=Path, required=True, help='Fresh private output directory, outside git.')
    parser.add_argument('--timeout', type=int, default=3600, help='Each actual adapter job budget, at most 3600 seconds.')
    scope = parser.add_mutually_exclusive_group()
    scope.add_argument('--upload-only', action='store_true', help='Only real HTTP upload/resume/integrity; no geometry claim.')
    scope.add_argument('--reconstruction-only', action='store_true',
                       help='Real HTTP upload and CPU sparse reconstruction only; no Blender, scene, metric or geographic claim.')
    parser.add_argument('--min-registration-fraction', type=float, default=0.90, help='Heuristic fraction of selected frames registered, default 0.90.')
    parser.add_argument('--min-wall-support', type=int, default=20, help='Heuristic minimum points per wall primitive, default 20.')
    args = parser.parse_args()
    parser.error('Use a 60–3600 second actual-job budget.') if not 60 <= args.timeout <= 3600 else None
    if args.expected_head and not re.fullmatch(r'[0-9a-f]{40}', args.expected_head):
        parser.error('--expected-head must be a full lower-case commit SHA.')
    if args.expected_video_sha256 and not re.fullmatch(r'[0-9a-f]{64}', args.expected_video_sha256):
        parser.error('--expected-video-sha256 must be a full lower-case SHA256.')
    try:
        assess_quality({}, {}, min_registration_fraction=args.min_registration_fraction,
                       min_wall_support=args.min_wall_support)
    except ValueError as error:
        parser.error(str(error))
    args.repo = args.repo.resolve()
    # Resolving a venv's python symlink selects the base interpreter and loses
    # its installed dependencies. Preserve the invocation path.
    args.python = args.python.absolute()
    if args.blender:
        args.blender = args.blender.resolve()
    if args.review:
        if args.upload_only or args.reconstruction_only:
            parser.error('--review uses the recorded scope; do not pass --upload-only or --reconstruction-only.')
        if args.expected_head:
            parser.error('--expected-head guards execution and cannot be combined with --review.')
        return review(args)
    previous_term = signal.getsignal(signal.SIGTERM)
    def terminate(signum, frame):
        raise KeyboardInterrupt('Termination requested; cleaning up the private worker.')
    signal.signal(signal.SIGTERM, terminate)
    try:
        return Run(args).run()
    finally:
        signal.signal(signal.SIGTERM, previous_term)


if __name__ == '__main__':
    sys.exit(main())
