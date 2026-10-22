"""Private World Studio worker. Run behind TLS, with one Uvicorn process.

No user-supplied commands or remote input URLs are accepted. GPU adapters are
operator-installed, license-reviewed executables and remain disabled by default.
"""
from __future__ import annotations
import asyncio
import base64
from contextlib import asynccontextmanager
import hashlib
import hmac
import json
import logging
import math
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import sqlite3
import time
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from .geometry import MAX_PREVIEW_COORDINATE
from .auth import Identities, OPERATOR_OWNER

MIB = 1024 ** 2
ID = re.compile(r"^[a-f0-9]{32}$")
SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$")
ACTIVE = ('prepared', 'queued', 'running')

class UploadBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1, max_length=160)
    kind: Literal['image', 'video']
    size: int = Field(gt=0, le=200 * MIB, strict=True)

class JobBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    engine: str = Field(min_length=1, max_length=64)
    upload_ids: list[str] = Field(min_length=1, max_length=12)
    consent: bool = Field(strict=True)

class TicketBody(BaseModel):
    model_config = ConfigDict(extra='forbid')
    artifact: int = Field(ge=0, le=31, strict=True)

class Store:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        (root / 'uploads').mkdir(exist_ok=True)
        (root / 'jobs').mkdir(exist_ok=True)
        self.db = sqlite3.connect(root / 'state.sqlite', check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, name TEXT, kind TEXT, size INTEGER, offset INTEGER, created REAL);
        CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, engine TEXT, status TEXT, uploads TEXT, created REAL, error TEXT, artifacts TEXT);
        ''')
        # Existing private data belongs only to the reserved operator identity.
        # Never infer its owner from whichever tenant happens to connect first.
        for table in ['uploads', 'jobs']:
            if 'owner_id' not in {row['name'] for row in self.db.execute(f'PRAGMA table_info({table})')}:
                self.db.execute(f"ALTER TABLE {table} ADD COLUMN owner_id TEXT NOT NULL DEFAULT '{OPERATOR_OWNER}'")
            self.db.execute(f'CREATE INDEX IF NOT EXISTS {table}_owner ON {table}(owner_id, created)')
        self.db.execute("UPDATE jobs SET status='failed', error='Worker restarted; execution was interrupted.' WHERE status IN ('queued','running')")
        self.db.commit()

    def upload(self, uid, owner_id=None):
        if not ID.fullmatch(uid):
            raise HTTPException(404, 'Upload not found.')
        row = self.db.execute('SELECT * FROM uploads WHERE id=?' + (' AND owner_id=?' if owner_id is not None else ''),
                              (uid, owner_id) if owner_id is not None else (uid,)).fetchone()
        if not row:
            raise HTTPException(404, 'Upload not found.')
        return dict(row)

    def job(self, jid, owner_id=None):
        if not ID.fullmatch(jid):
            raise HTTPException(404, 'Job not found.')
        row = self.db.execute('SELECT * FROM jobs WHERE id=?' + (' AND owner_id=?' if owner_id is not None else ''),
                              (jid, owner_id) if owner_id is not None else (jid,)).fetchone()
        if not row:
            raise HTTPException(404, 'Job not found.')
        value = dict(row)
        value['upload_ids'] = json.loads(value.pop('uploads'))
        value['artifacts'] = json.loads(value['artifacts'] or '[]')
        return value

    def state(self, jid, state, error=None, artifacts=None):
        self.db.execute('UPDATE jobs SET status=?, error=?, artifacts=? WHERE id=?',
                        (state, error, json.dumps(artifacts or []), jid))
        self.db.commit()

    def upload_path(self, uid, owner_id=None):
        self.upload(uid, owner_id)
        return self.root / 'uploads' / uid

    def in_use(self, uid, running_ids=()):
        return any(uid in json.loads(row['uploads']) for row in self.db.execute('SELECT id,status,uploads FROM jobs')
                   if row['status'] in ACTIVE or row['id'] in running_ids)

    def prune(self, ttl, running_ids=()):
        cutoff = time.time() - ttl
        for row in list(self.db.execute("SELECT id FROM jobs WHERE created<? AND status NOT IN ('queued','running')", (cutoff,))):
            if row['id'] in running_ids: continue
            shutil.rmtree(self.root / 'jobs' / row['id'], ignore_errors=True)
            self.db.execute('DELETE FROM jobs WHERE id=?', (row['id'],))
        for row in list(self.db.execute('SELECT id FROM uploads WHERE created<?', (cutoff,))):
            if not self.in_use(row['id'], running_ids):
                (self.root / 'uploads' / row['id']).unlink(missing_ok=True)
                self.db.execute('DELETE FROM uploads WHERE id=?', (row['id'],))
        self.db.commit()

    def storage_commitment(self, job_limit, running_ids=(), owner_id=None):
        """Charge existing bytes plus unwritten upload/job reservations once.

        Database state persists reservations across HTTP requests and restarts.
        A cancelled adapter keeps its reservation until its process has stopped.
        Caller serializes admission and upload mutations with the worker IO lock.
        """
        condition, arguments = (' WHERE owner_id=?', (owner_id,)) if owner_id is not None else ('', ())
        uploads = list(self.db.execute('SELECT id,size FROM uploads' + condition, arguments))
        jobs = list(self.db.execute('SELECT id,status FROM jobs' + condition, arguments))
        upload_ids, job_ids = {row['id'] for row in uploads}, {row['id'] for row in jobs}
        used, upload_bytes, job_bytes = 0, {}, {}
        for path in self.root.rglob('*'):
            parts = path.relative_to(self.root).parts
            if owner_id is not None and not (len(parts) >= 2 and (
                    (parts[0] == 'uploads' and parts[1] in upload_ids) or (parts[0] == 'jobs' and parts[1] in job_ids))):
                continue
            try:
                if path.is_symlink() or not path.is_file():
                    continue
                size = path.stat().st_size
            except FileNotFoundError:
                continue  # Adapter may rename a temporary file while monitored.
            used += size
            if len(parts) == 2 and parts[0] == 'uploads':
                upload_bytes[parts[1]] = size
            elif len(parts) >= 3 and parts[0] == 'jobs':
                job_bytes[parts[1]] = job_bytes.get(parts[1], 0) + size
        upload_remaining = sum(max(0, row['size'] - upload_bytes.get(row['id'], 0))
                               for row in uploads)
        active_ids = {row['id'] for row in jobs if row['status'] in ACTIVE}
        active_ids.update(set(running_ids) & job_ids)
        job_remaining = sum(max(0, job_limit - job_bytes.get(jid, 0)) for jid in active_ids)
        # Leave room for bounded SQLite metadata/WAL updates after admission.
        return used + upload_remaining + job_remaining + MIB


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for part in iter(lambda: stream.read(MIB), b''):
            digest.update(part)
    return digest.hexdigest()


def validate_media(path: Path, kind: str):
    with path.open('rb') as stream:
        header = stream.read(32)
    if kind == 'image':
        valid = header.startswith((b'\xff\xd8\xff', b'\x89PNG\r\n\x1a\n')) or (header[:4] == b'RIFF' and header[8:12] == b'WEBP')
    else:
        valid = header.startswith(b'\x1aE\xdf\xa3') or header[4:8] == b'ftyp'
    if not valid:
        raise HTTPException(422, 'File signature does not match a supported image or video. Convert the source first.')


def configured_engines(config):
    engines = {'inspect': {'id': 'inspect', 'label': 'Capture integrity (no AI)', 'available': True, 'input_kinds': ['image', 'video'], 'max_inputs': 12}}
    if not config:
        return engines
    entries = json.loads(Path(config).read_text())
    if not isinstance(entries, list) or len(entries) > 16:
        raise ValueError('Adapter configuration must contain at most 16 entries.')
    for entry in entries:
        eid = entry.get('id', '')
        command = entry.get('command', [])
        if not SAFE_NAME.fullmatch(eid) or eid in engines or not isinstance(command, list) or not command or not all(isinstance(x, str) and len(x) < 4096 for x in command):
            raise ValueError('Invalid trusted adapter configuration.')
        if not Path(command[0]).is_absolute() or not Path(command[0]).is_file():
            raise ValueError('Adapter executable must be an existing absolute path.')
        kinds = entry.get('input_kinds', [])
        if not kinds or any(k not in ['image', 'video'] for k in kinds):
            raise ValueError('Invalid adapter input kinds.')
        engines[eid] = {**entry, 'available': entry.get('enabled') is True and entry.get('license_reviewed') is True,
                        'max_inputs': min(12, max(1, int(entry.get('max_inputs', 1)))),
                        'timeout_seconds': min(3600, max(1, int(entry.get('timeout_seconds', 1800))))}
    return engines


def visual_metadata(entry):
    """Keep adapter display hints bounded; they never certify geometry or scale."""
    if 'representation' not in entry:
        return {}
    if entry['representation'] not in ['point-cloud', 'gaussian-splat', 'triangle-mesh']:
        raise ValueError('Unknown visual representation.')
    result = {'representation': entry['representation'], 'units': 'arbitrary'}
    if 'coordinate_frame' in entry:
        if entry['coordinate_frame'] not in ['right-handed-y-up', 'colmap', 'unknown']:
            raise ValueError('Unknown visual coordinate frame.')
        result['coordinate_frame'] = entry['coordinate_frame']
    if 'point_count' in entry:
        if type(entry['point_count']) is not int or not 1 <= entry['point_count'] <= 20_000_000:
            raise ValueError('Invalid visual point count.')
        result['point_count'] = entry['point_count']
    if 'bounds' in entry:
        bounds = entry['bounds']
        if not isinstance(bounds, dict) or set(bounds) != {'min', 'max'}:
            raise ValueError('Invalid visual bounds.')
        for axis in ['min', 'max']:
            values = bounds[axis]
            if (not isinstance(values, list) or len(values) != 3
                    or any(type(value) not in [float, int] or not math.isfinite(value) or abs(value) > MAX_PREVIEW_COORDINATE for value in values)):
                raise ValueError('Invalid visual bounds.')
        if any(low > high for low, high in zip(bounds['min'], bounds['max'])):
            raise ValueError('Invalid visual bounds.')
        result['bounds'] = bounds
    return result


def create_app(*, root: Path | None = None, token: str | None = None, adapters: str | None = None, tenants: str | None = None, ttl: int = 86400,
               storage_limit: int = 20 * 1024 ** 3, job_limit: int = 4 * 1024 ** 3):
    token = token or os.environ.get('WORLD_WORKER_TOKEN', '')
    if len(token) < 32:
        raise RuntimeError('Set WORLD_WORKER_TOKEN to a random secret of at least 32 characters.')
    if type(storage_limit) is not int or type(job_limit) is not int or not 0 < job_limit < storage_limit - MIB:
        raise ValueError('Storage capacity must exceed the positive job budget plus metadata reserve.')
    engines = configured_engines(adapters or os.environ.get('WORLD_ADAPTERS_FILE'))
    identities = Identities(token, tenants or os.environ.get('WORLD_TENANTS_FILE'), engines, storage_limit)
    # Never sign capabilities with a credential handed to any browser, including
    # the legacy operator credential. Restart intentionally expires old tickets.
    ticket_key = secrets.token_bytes(32)
    store = Store(root or Path(os.environ.get('WORLD_WORKER_DIR', './world-worker-data')))
    queue: asyncio.Queue = asyncio.Queue(maxsize=8)
    processes = {}
    running = set()
    io_lock = asyncio.Lock()

    def check_storage(extra=0, principal=None):
        if store.storage_commitment(job_limit, running) + extra > storage_limit:
            raise HTTPException(429, 'Worker disk budget is reserved or full. Delete finished jobs or cancel pending work.')
        if principal and store.storage_commitment(job_limit, running, principal.owner_id) + extra > principal.limits['storage_bytes']:
            raise HTTPException(429, 'Owner disk budget is reserved or full. Delete finished jobs or cancel pending work.')

    def require_engine(principal, engine):
        if engine not in principal.engines:
            raise HTTPException(403, 'This credential is not authorized for that engine.')

    def check_owner_jobs(principal, *, adding=False):
        owned = list(store.db.execute('SELECT id,status FROM jobs WHERE owner_id=?', (principal.owner_id,)))
        active = sum(row['status'] in ACTIVE or row['id'] in running for row in owned)
        if len(owned) + int(adding) > principal.limits['job_count'] or active + int(adding) > principal.limits['active_jobs']:
            raise HTTPException(429,'Owner job quota reached. Finish or cancel active work and delete old jobs.')

    def check_execution_storage(directory):
        total = sum(path.stat().st_size for path in directory.rglob('*') if path.is_file() and not path.is_symlink())
        if total > job_limit:
            raise ValueError('Adapter exceeded its disk budget.')
        if store.storage_commitment(job_limit, running) > storage_limit:
            raise ValueError('Worker global disk budget was exceeded during execution.')

    async def stop_process(jid):
        proc = processes.get(jid)
        if proc and proc.returncode is None:
            try:
                if os.name == 'posix': os.killpg(proc.pid, signal.SIGTERM)
                else: proc.terminate()
                await asyncio.wait_for(proc.wait(), 3)
            except (ProcessLookupError, asyncio.TimeoutError):
                if proc.returncode is None:
                    if os.name == 'posix': os.killpg(proc.pid, signal.SIGKILL)
                    else: proc.kill()
                    await proc.wait()

    def artifact_manifest(out):
        manifest = out / 'manifest.json'
        if not manifest.is_file() or manifest.is_symlink() or manifest.stat().st_size > MIB:
            raise ValueError('Adapter did not write a bounded manifest.json.')
        value = json.loads(manifest.read_text())
        entries = value.get('artifacts') if isinstance(value, dict) else None
        if not isinstance(entries, list) or not 1 <= len(entries) <= 32:
            raise ValueError('Adapter manifest requires 1 to 32 artifacts.')
        result = []
        seen = set()
        for entry in entries:
            if not isinstance(entry, dict):
                raise ValueError('Invalid artifact entry.')
            name = entry.get('name', '')
            if not isinstance(name, str) or not SAFE_NAME.fullmatch(name) or name in seen or Path(name).suffix.lower() not in ['.json','.ply','.spz','.splat','.ksplat','.glb','.usda','.png','.jpg','.mp4','.csv']:
                raise ValueError('Unsafe artifact name or type.')
            seen.add(name)
            path = out / name
            if path.is_symlink() or not path.is_file() or path.resolve().parent != out.resolve() or not 0 < path.stat().st_size <= 3 * 1024 ** 3:
                raise ValueError('Missing, oversized or unsafe artifact.')
            result.append({'name': name, 'size': path.stat().st_size, 'sha256': sha256_file(path),
                           'kind': str(entry.get('kind', 'visual'))[:40],
                           **visual_metadata(entry), 'provenance': 'unverified-output', 'metric_verified': False})
        return result

    async def execute(jid):
        directory = store.root / 'jobs' / jid
        out = directory / 'output'
        try:
            async with io_lock:
                try:
                    job = store.job(jid)
                except HTTPException as error:
                    if error.status_code == 404: return  # Cancelled/deleted queued job.
                    raise
                if job['status'] != 'queued': return
                try:
                    principal = identities.owner(job['owner_id'])
                    if principal is None or job['engine'] not in principal.engines:
                        store.state(jid, 'failed', 'Owner access or engine authorization was revoked before execution.')
                        return
                    check_owner_jobs(principal)
                    check_storage(principal=principal)
                except HTTPException:
                    store.state(jid, 'failed', 'Reserved capacity or owner quota is no longer available; execution did not start.')
                    return
                store.state(jid, 'running')
                running.add(jid)
            directory.mkdir(exist_ok=True)
            out.mkdir(exist_ok=True)
            items = [store.upload(i, job['owner_id']) for i in job['upload_ids']]
            inputs = []
            for item in items:
                path = store.upload_path(item['id'], job['owner_id'])
                validate_media(path, item['kind'])
                inputs.append({'path': str(path), 'name': item['name'], 'kind': item['kind'], 'size': item['size']})
            request_file = directory / 'input.json'
            request_file.write_text(json.dumps({'schema': 'brainsnn.adapter.v1', 'inputs': inputs, 'output_dir': str(out)}))
            if job['engine'] == 'inspect':
                rows = []
                for item in inputs:
                    rows.append({k: v for k, v in item.items() if k != 'path'} | {'sha256': await asyncio.to_thread(sha256_file, Path(item['path']))})
                (out / 'capture-integrity.json').write_text(json.dumps({'schema': 'brainsnn.capture.v1', 'sources': rows, 'model_executed': False, 'claim': 'File integrity only; no geometry or semantic inference.'}, indent=2))
                (out / 'manifest.json').write_text(json.dumps({'artifacts': [{'name': 'capture-integrity.json', 'kind': 'integrity'}]}))
            else:
                entry = engines[job['engine']]
                command = [arg.replace('{input_manifest}', str(request_file)).replace('{output_dir}', str(out)) for arg in entry['command']]
                # The worker secret is deliberately excluded from adapter environments.
                env = {k: v for k, v in os.environ.items() if k in ['PATH','HOME','SYSTEMROOT','CUDA_VISIBLE_DEVICES','LD_LIBRARY_PATH','HF_HOME','WORLD_DEPTH_MODEL_DIR','WORLD_MAPANYTHING_SOURCE_DIR','WORLD_MAPANYTHING_MODEL_DIR','WORLD_DINOV2_SOURCE_DIR','WORLD_VLM_ENABLED','WORLD_VLM_BASE_URL','WORLD_VLM_MODEL','WORLD_VLM_REVISION','WORLD_VLM_API_KEY']}
                env.update({'PYTHONUNBUFFERED':'1','HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1'})
                with (directory / 'operator.log').open('wb') as log:
                    proc = await asyncio.create_subprocess_exec(*command, cwd=str(directory), env=env, stdout=log, stderr=log, start_new_session=os.name=='posix')
                    processes[jid] = proc
                    start = time.monotonic()
                    while proc.returncode is None:
                        await asyncio.sleep(.2)
                        if store.job(jid)['status'] == 'cancelled': await stop_process(jid); return
                        if time.monotonic()-start > entry['timeout_seconds']: raise TimeoutError('Adapter exceeded its time budget.')
                        async with io_lock:
                            check_execution_storage(directory)
                    if proc.returncode: raise ValueError('Adapter failed. Check operator logs; no successful output was claimed.')
            if store.job(jid)['status'] == 'cancelled': return
            async with io_lock:
                check_execution_storage(directory)
            artifacts = await asyncio.to_thread(artifact_manifest, out)
            if store.job(jid)['status'] != 'cancelled': store.state(jid, 'complete', artifacts=artifacts)
        except asyncio.CancelledError:
            await stop_process(jid)
            if store.job(jid)['status'] != 'cancelled': store.state(jid,'failed','Worker stopped during execution.')
            raise
        except Exception as error:
            await stop_process(jid)
            if store.job(jid)['status'] != 'cancelled': store.state(jid, 'failed', str(error)[:300])
        finally:
            processes.pop(jid, None)
            running.discard(jid)

    async def runner():
        while True:
            jid = await queue.get()
            try:
                await execute(jid)
            except Exception:
                # A stale queue item or per-job IO failure must not stop all work.
                # execute owns child cleanup; this is the final queue-service guard.
                logging.getLogger(__name__).exception('Unexpected worker job failure: %s', jid)
            finally: queue.task_done()

    async def maintenance():
        while True:
            await asyncio.sleep(60)
            async with io_lock: store.prune(ttl, running)

    @asynccontextmanager
    async def lifespan(app):
        store.prune(ttl)
        task = asyncio.create_task(runner()); cleanup = asyncio.create_task(maintenance())
        yield
        task.cancel(); cleanup.cancel()
        await asyncio.gather(task, cleanup, return_exceptions=True)
        store.db.close()

    app = FastAPI(title='BrainSNN World Worker', lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.store = store

    @app.middleware('http')
    async def security(request: Request, call_next):
        is_download = request.url.path.startswith('/v1/download/') and request.method in ['GET','HEAD']
        needs_auth = request.method != 'OPTIONS' and request.url.path != '/healthz' and not is_download
        def authorize():
            try:
                principal = identities.authenticate(request.headers.get('authorization', '')) if len(request.headers.getlist('authorization')) == 1 else None
            except (OSError, ValueError):
                return JSONResponse({'detail':'Tenant access configuration is unavailable.'},503)
            if principal is None: return JSONResponse({'detail':'Unauthorized.'},401)
            request.state.principal = principal
            return None
        if needs_auth:
            failure = authorize()
            if failure is not None: return failure
        limit = 4*MIB if request.method == 'PUT' and request.url.path.startswith('/v1/uploads/') else 16384
        if request.method in ['POST','PUT','PATCH']:
            length = request.headers.get('content-length')
            if length is None or not length.isdigit(): return JSONResponse({'detail':'Content-Length is required.'},411)
            if int(length)>limit:return JSONResponse({'detail':'Request exceeds the body limit.'},413)
            # Guard both declared and actual body sizes before JSON or media parsing.
            data=bytearray()
            async for chunk in request.stream():
                data.extend(chunk)
                if len(data)>limit:return JSONResponse({'detail':'Request exceeds the body limit.'},413)
            request._body=bytes(data)
            # A caller can stall its request body across a registry edit. Refresh
            # identity, engine grants and budgets after the await, at admission.
            if needs_auth:
                failure = authorize()
                if failure is not None: return failure
        response = await call_next(request)
        response.headers['Cache-Control']='no-store'
        response.headers['X-Content-Type-Options']='nosniff'
        response.headers['Referrer-Policy']='no-referrer'
        return response

    origins=[v.strip() for v in os.environ.get('WORLD_ALLOWED_ORIGINS','https://www.brainsnn.com,https://brainsnn.com,http://127.0.0.1:8765,http://localhost:8765').split(',') if v.strip()]
    if '*' in origins:raise RuntimeError('Wildcard origins are not supported.')
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=['GET','HEAD','POST','PUT','DELETE'], allow_headers=['Authorization','Content-Type'], allow_credentials=False)

    @app.get('/healthz')
    async def health(): return {'status':'ok','public_processing':False}

    @app.get('/v1/capabilities')
    async def capabilities(request:Request):
        principal = request.state.principal
        return {'api_version':'brainsnn.worker.v1','operator_only':True,
                'access_mode':'operator' if principal.owner_id == OPERATOR_OWNER else 'tenant',
                'owner_id':principal.owner_id, 'owner_limits':principal.limits,
                'engines':[{k:e.get(k) for k in ['id','label','available','input_kinds','max_inputs']} for e in engines.values() if e['id'] in principal.engines],
                'limits':{'file_bytes':200*MIB,'chunk_bytes':4*MIB,'retention_seconds':ttl,'concurrent_jobs':1,'storage_bytes':storage_limit,'job_bytes':job_limit}, 'model_validation':'Adapter configuration is not a quality or hardware benchmark.'}

    @app.post('/v1/uploads',status_code=201)
    async def create_upload(body: UploadBody, request:Request):
        principal = request.state.principal
        suffix=Path(body.name).suffix.lower()
        if suffix not in (['.jpg','.jpeg','.png','.webp'] if body.kind=='image' else ['.mp4','.mov','.webm']): raise HTTPException(422,'Unsupported file type.')
        async with io_lock:
            store.prune(ttl, running)
            count,reserved=store.db.execute('SELECT COUNT(*),COALESCE(SUM(size),0) FROM uploads').fetchone()
            if count>=50 or reserved+body.size>2*1024**3:raise HTTPException(429,'Upload quota reached. Delete old sources or wait for expiry.')
            count,reserved=store.db.execute('SELECT COUNT(*),COALESCE(SUM(size),0) FROM uploads WHERE owner_id=?',(principal.owner_id,)).fetchone()
            if count >= principal.limits['upload_count'] or reserved + body.size > principal.limits['upload_bytes']:
                raise HTTPException(429,'Owner upload quota reached. Delete old sources or wait for expiry.')
            check_storage(body.size, principal)
            uid=secrets.token_hex(16)
            (store.root/'uploads'/uid).touch(mode=0o600)
            store.db.execute('INSERT INTO uploads (id,name,kind,size,offset,created,owner_id) VALUES (?,?,?,?,?,?,?)',(uid,body.name,body.kind,body.size,0,time.time(),principal.owner_id));store.db.commit()
            return store.upload(uid, principal.owner_id)

    @app.get('/v1/uploads/{uid}')
    async def upload_status(uid:str,request:Request):return store.upload(uid, request.state.principal.owner_id)

    @app.put('/v1/uploads/{uid}')
    async def put_upload(uid:str,offset:int,request:Request):
        principal = request.state.principal
        data=await request.body()
        if not data:raise HTTPException(422,'Empty upload chunk.')
        async with io_lock:
            item=store.upload(uid, principal.owner_id)
            if store.in_use(uid, running):raise HTTPException(409,'This upload belongs to an active or stopping job.')
            if offset!=item['offset']:raise HTTPException(409,'Upload offset mismatch. Read upload status to resume.')
            if offset+len(data)>item['size']:raise HTTPException(413,'Chunk exceeds the declared file size.')
            check_storage(principal=principal)  # Full declared size was reserved at upload admission.
            path=store.upload_path(uid, principal.owner_id)
            with path.open('r+b') as f:
                f.truncate(offset);f.seek(offset);f.write(data);f.flush();os.fsync(f.fileno())
            store.db.execute('UPDATE uploads SET offset=? WHERE id=? AND owner_id=?',(offset+len(data),uid,principal.owner_id));store.db.commit()
            return store.upload(uid, principal.owner_id)

    @app.delete('/v1/uploads/{uid}')
    async def delete_upload(uid:str,request:Request):
        owner = request.state.principal.owner_id
        async with io_lock:
            store.upload(uid, owner)  # Authorize before revealing active-job state.
            if store.in_use(uid, running):raise HTTPException(409,'Cancel the job and wait for execution to stop before deleting its sources.')
            store.upload_path(uid,owner).unlink(missing_ok=True);store.db.execute('DELETE FROM uploads WHERE id=? AND owner_id=?',(uid,owner));store.db.commit()
        return {'deleted':True}

    @app.post('/v1/jobs',status_code=201)
    async def create_job(body:JobBody,request:Request):
        principal = request.state.principal
        if body.consent is not True:raise HTTPException(422,'Explicit processing consent is required.')
        engine=engines.get(body.engine)
        if not engine or not engine['available']:raise HTTPException(409,'This engine is not configured and license-approved.')
        require_engine(principal, body.engine)
        if len(set(body.upload_ids))!=len(body.upload_ids) or len(body.upload_ids)>engine['max_inputs']:raise HTTPException(422,'Invalid number of inputs.')
        async with io_lock:
            if store.db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0]>=50:raise HTTPException(429,'Job quota reached. Delete finished jobs or wait for expiry.')
            check_owner_jobs(principal, adding=True)
            for uid in body.upload_ids:
                item=store.upload(uid, principal.owner_id)
                if item['offset']!=item['size'] or item['kind'] not in engine['input_kinds']:raise HTTPException(422,'Incomplete or unsupported source.')
                validate_media(store.upload_path(uid, principal.owner_id),item['kind'])
            check_storage(job_limit, principal)
            jid=secrets.token_hex(16)
            store.db.execute('INSERT INTO jobs (id,engine,status,uploads,created,error,artifacts,owner_id) VALUES (?,?,?,?,?,?,?,?)',(jid,body.engine,'prepared',json.dumps(body.upload_ids),time.time(),None,'[]',principal.owner_id));store.db.commit()
            return store.job(jid, principal.owner_id)

    @app.post('/v1/jobs/{jid}/start')
    async def start_job(jid:str,request:Request):
        principal = request.state.principal
        async with io_lock:
            job=store.job(jid, principal.owner_id)
            require_engine(principal, job['engine'])
            if job['status']!='prepared':raise HTTPException(409,'Only a prepared job can start; cancelled jobs never restart.')
            if queue.full():raise HTTPException(429,'Processing queue is full.')
            check_owner_jobs(principal)
            check_storage(principal=principal)
            store.state(jid,'queued');queue.put_nowait(jid)
            return store.job(jid, principal.owner_id)

    @app.get('/v1/jobs/{jid}')
    async def job_status(jid:str,request:Request):return store.job(jid, request.state.principal.owner_id)

    @app.get('/v1/jobs')
    async def list_jobs(request:Request):
        owner = request.state.principal.owner_id
        return {'jobs':[store.job(r[0], owner) for r in store.db.execute('SELECT id FROM jobs WHERE owner_id=? ORDER BY created DESC LIMIT 50',(owner,))]}

    @app.delete('/v1/jobs/{jid}')
    async def cancel_job(jid:str,request:Request):
        owner = request.state.principal.owner_id
        async with io_lock:
            job=store.job(jid, owner)
            active=job['status'] in ACTIVE
            if active:store.state(jid,'cancelled')
        if active:await stop_process(jid)
        return store.job(jid, owner)

    @app.delete('/v1/jobs/{jid}/artifacts')
    async def delete_artifacts(jid:str,request:Request):
        owner = request.state.principal.owner_id
        async with io_lock:
            job=store.job(jid, owner)
            if job['status'] in ACTIVE or jid in running:raise HTTPException(409,'Cancel the job and wait for execution to stop first.')
            shutil.rmtree(store.root/'jobs'/jid,ignore_errors=True)
            store.db.execute('DELETE FROM jobs WHERE id=? AND owner_id=?',(jid,owner));store.db.commit()
        return {'deleted':True}

    @app.post('/v1/jobs/{jid}/ticket')
    async def ticket(jid:str,body:TicketBody,request:Request):
        principal = request.state.principal
        job=store.job(jid, principal.owner_id)
        if job['status']!='complete' or body.artifact>=len(job['artifacts']):raise HTTPException(404,'Artifact not found.')
        raw=json.dumps({'owner':principal.owner_id,'credential':principal.credential_hash,'job':jid,'artifact':body.artifact,'expires':int(time.time())+60},separators=(',',':')).encode()
        payload=base64.urlsafe_b64encode(raw).decode().rstrip('=')
        sig=hmac.new(ticket_key,payload.encode(),hashlib.sha256).hexdigest()
        return {'url':f'/v1/download/{payload}.{sig}','expires_in':60}

    @app.api_route('/v1/download/{ticket}',methods=['GET','HEAD'])
    async def download(ticket:str):
        try:
            if len(ticket)>1024:raise ValueError()
            payload,sig=ticket.rsplit('.',1)
            if not hmac.compare_digest(sig,hmac.new(ticket_key,payload.encode(),hashlib.sha256).hexdigest()):raise ValueError()
            body=json.loads(base64.urlsafe_b64decode(payload+'='*(-len(payload)%4)))
            if not isinstance(body,dict) or set(body) != {'owner','credential','job','artifact','expires'}:raise ValueError()
            if type(body['expires']) is not int or not time.time()<body['expires']<=time.time()+65:raise ValueError()
            if not isinstance(body['owner'],str) or not identities.ticket_principal(body['owner'],body['credential']):raise ValueError()
            job=store.job(body['job'],body['owner']);index=body['artifact']
            if job['status']!='complete' or type(index) is not int or not 0<=index<len(job['artifacts']):raise ValueError()
            entry=job['artifacts'][index];path=store.root/'jobs'/job['id']/'output'/entry['name']
            if path.is_symlink() or not path.is_file():raise ValueError()
        except (OSError,ValueError,KeyError,TypeError,IndexError,HTTPException):raise HTTPException(403,'Invalid or expired download ticket.') from None
        return FileResponse(path,media_type='application/octet-stream',filename=entry['name'],headers={'Content-Security-Policy':'sandbox','Cache-Control':'private, no-store'})

    return app
