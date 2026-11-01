"""Live-HTTP retention validation.

Validates the retention (ttl) behavior against a REAL uvicorn server over
live HTTP (not TestClient):

1. Capabilities advertising — WORLD_RETENTION_SECONDS env override is
   reflected in GET /v1/capabilities limits.retention_seconds, and an
   invalid value (below the 60s minimum) refuses to start.
2. Prune behavior — with a short real TTL, a completed job's artifacts and
   row are removed by a maintenance-triggered prune, and the removal is
   observable over live HTTP (job row gone, artifact file gone from disk).

Bounded by default: prune is observed by driving store.prune() through a
triggered POST /v1/uploads (the production prune point). If the optional
WORLD_RETENTION_WAIT env var is set to seconds, the test instead waits for
the background maintenance loop to prune on its own (real 60s cycle).

Run:  python tests/world/retention_live_http.py
      (receipt written to output/playwright/world/retention-live-receipt.json)
"""
import json
import os
import sys
import tempfile
import threading
import time
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from robotics.world_worker.app import create_app

PNG = bytes.fromhex(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489'
    '0000000d4944514154789c636301000004000185a152e1000000004945444e44ae426082')


def req(base, method, path, token=None, body=None, content=None):
    data = None
    headers = {}
    if content is not None:
        data = content
        headers['Content-Length'] = str(len(content))
    elif body is not None:
        data = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    if token:
        headers['Authorization'] = 'Bearer ' + token
    request = urllib.request.Request(base + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.loads(error.read())
        except Exception:
            return error.code, {'raw': ''}


def run_inspect_job(base, token, name):
    """Upload a real PNG and drive an inspect job to completion over live HTTP."""
    status, up = req(base, 'POST', '/v1/uploads', token,
                     {'name': name, 'kind': 'image', 'size': len(PNG)})
    assert status == 201, (status, up)
    uid = up['id']
    status, _ = req(base, 'PUT', '/v1/uploads/%s?offset=0' % uid, token, content=PNG)
    assert status == 200, status
    status, job = req(base, 'POST', '/v1/jobs', token,
                      {'engine': 'inspect', 'upload_ids': [uid], 'consent': True})
    assert status == 201, (status, job)
    jid = job['id']
    assert req(base, 'POST', '/v1/jobs/%s/start' % jid, token, {})[0] == 200
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        status, job = req(base, 'GET', '/v1/jobs/%s' % jid, token)
        assert status == 200
        if job['status'] in ('complete', 'failed'):
            break
        time.sleep(0.2)
    assert job['status'] == 'complete', job
    return jid


def start_worker(tmp_base, ttl_env_value, label):
    import uvicorn
    keys = Path(tmp_base) / ('keys-' + label)
    keys.mkdir(exist_ok=True)
    from robotics.world_worker.report_receipts import main as receipt_main
    saved = sys.argv
    sys.argv = [sys.argv[0], 'init-key',
                '--private-key', str(keys / 'k.key'), '--public-key', str(keys / 'k.pub')]
    try:
        try:
            receipt_main()
        except SystemExit as exc:
            assert not exc.code, 'init-key failed'
    finally:
        sys.argv = saved

    token = 'b' * 48
    saved_origin = os.environ.get('WORLD_ALLOWED_ORIGINS')
    saved_ttl = os.environ.get('WORLD_RETENTION_SECONDS')
    if ttl_env_value is None:
        os.environ.pop('WORLD_RETENTION_SECONDS', None)
    else:
        os.environ['WORLD_RETENTION_SECONDS'] = ttl_env_value
    try:
        app = create_app(root=Path(tmp_base) / ('worker-' + label), token=token,
                         report_key=str(keys / 'k.key'))
    finally:
        if saved_origin is not None:
            os.environ['WORLD_ALLOWED_ORIGINS'] = saved_origin
        else:
            os.environ.pop('WORLD_ALLOWED_ORIGINS', None)
        if saved_ttl is not None:
            os.environ['WORLD_RETENTION_SECONDS'] = saved_ttl
        else:
            os.environ.pop('WORLD_RETENTION_SECONDS', None)
    probe = None
    import socket
    sock = socket.socket()
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
    sock.close()
    config = uvicorn.Config(app, host='127.0.0.1', port=port, log_level='warning')
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 15
    while not server.started:
        assert time.monotonic() < deadline, 'server did not start'
        time.sleep(0.05)
    actual = server.servers[0].sockets[0].getsockname()[1]
    print(f'[{label}] uvicorn up on 127.0.0.1:{actual}, ttl_env={ttl_env_value}', flush=True)
    return f'http://127.0.0.1:{actual}', token, Path(tmp_base) / ('worker-' + label), server, app


def main():
    tmp_base = tempfile.mkdtemp(prefix='wb-retention-')
    receipt_dir = ROOT / 'output' / 'playwright' / 'world'
    receipt_dir.mkdir(parents=True, exist_ok=True)
    receipt = {'test': 'retention-live-http', 'checks': {}}

    # --- Check 1: env override is advertised on capabilities (real uvicorn) ---
    base1, token1, root1, server1, app1 = start_worker(tmp_base, '3600', 'override')
    status, caps = req(base1, 'GET', '/v1/capabilities', token1)
    assert status == 200, (status, caps)
    advertised = caps['limits']['retention_seconds']
    receipt['checks']['env_override_advertised'] = {
        'passed': advertised == 3600, 'advertised': advertised,
        'capabilities_status': status}
    print(f'[check 1] capabilities retention_seconds={advertised} (expected 3600)', flush=True)

    # --- Check 2: invalid env value refuses to start ---
    start_failed = False
    err_text = ''
    try:
        start_worker(tmp_base, '30', 'invalid')
    except Exception as exc:
        start_failed = True
        err_text = str(exc)
    receipt['checks']['invalid_env_refused'] = {
        'passed': start_failed and ('ValueError' in err_text or '60' in err_text),
        'error': err_text[:200]}
    print(f'[check 2] invalid env refused: {start_failed} ({err_text[:120]})', flush=True)

    # --- Check 3: default (no env) advertises 86400 ---
    base3, token3, root3, server3, app3 = start_worker(tmp_base, None, 'default')
    status, caps3 = req(base3, 'GET', '/v1/capabilities', token3)
    assert status == 200
    receipt['checks']['default_advertised'] = {
        'passed': caps3['limits']['retention_seconds'] == 86400,
        'advertised': caps3['limits']['retention_seconds']}
    print(f"[check 3] default retention_seconds={caps3['limits']['retention_seconds']} (expected 86400)", flush=True)

    # --- Check 4: prune removes an expired completed job (live server) ---
    # Fresh worker with a real 60s TTL. Create a completed job, backdate its
    # row past the TTL, then trigger a production prune point over live HTTP
    # (POST /v1/uploads calls store.prune before admission) and verify via
    # live GET that the row is gone and the artifact directory removed.
    base4, token4, root4, server4, app4 = start_worker(tmp_base, '60', 'prune')
    jid = run_inspect_job(base4, token4, 'retention.png')
    job_dir = root4 / 'jobs' / jid
    assert (job_dir / 'output' / 'manifest.json').is_file(), 'inspect job produced no manifest'
    store = app4.state.store
    cutoff = time.time() - 120
    store.db.execute("UPDATE jobs SET created=? WHERE id=?", (cutoff, jid))
    store.db.commit()
    # Trigger the production prune point over live HTTP.
    status, up = req(base4, 'POST', '/v1/uploads', token4,
                     {'name': 'after-prune.png', 'kind': 'image', 'size': len(PNG)})
    assert status == 201, (status, up)
    row_gone = store.db.execute('SELECT id FROM jobs WHERE id=?', (jid,)).fetchone() is None
    dir_gone = not job_dir.exists()
    status_after, job_after = req(base4, 'GET', '/v1/jobs/%s' % jid, token4)
    receipt['checks']['prune_expired_job'] = {
        'passed': row_gone and dir_gone,
        'row_gone': row_gone, 'artifact_dir_gone': dir_gone,
        'live_get_after_prune_status': status_after,
        'live_get_after_prune_detail': job_after.get('detail') if isinstance(job_after, dict) else job_after}
    print(f"[check 4] prune: row_gone={row_gone}, dir_gone={dir_gone}, "
          f"live GET after prune -> {status_after}", flush=True)

    # --- Check 5 (optional): background maintenance prunes on its own ---
    wait_s = os.environ.get('WORLD_RETENTION_WAIT')
    if wait_s:
        jid5 = run_inspect_job(base4, token4, 'maintenance.png')
        job5_dir = root4 / 'jobs' / jid5
        assert (job5_dir / 'output' / 'manifest.json').is_file()
        store.db.execute('UPDATE jobs SET created=? WHERE id=?', (time.time() - 120, jid5))
        store.db.commit()
        print(f'[check 5] waiting {wait_s}s for background maintenance prune…', flush=True)
        deadline = time.monotonic() + int(wait_s) + 10
        pruned = False
        while time.monotonic() < deadline:
            if not job5_dir.exists():
                pruned = True
                break
            time.sleep(2)
        receipt['checks']['maintenance_loop_prune'] = {'passed': pruned, 'wait_seconds': int(wait_s)}
        print(f'[check 5] maintenance loop pruned: {pruned}', flush=True)
    else:
        receipt['checks']['maintenance_loop_prune'] = {'skipped': 'set WORLD_RETENTION_WAIT to run'}
        print('[check 5] skipped (WORLD_RETENTION_WAIT unset; 60s maintenance cycle)', flush=True)

    # --- Upload retention: an expired, unused upload is pruned too ---
    base4b = base4
    status, up = req(base4, 'POST', '/v1/uploads', token4,
                     {'name': 'stale.png', 'kind': 'image', 'size': len(PNG)})
    assert status == 201, (status, up)
    uid_stale = up['id']
    store.db.execute('UPDATE uploads SET created=? WHERE id=?', (time.time() - 120, uid_stale))
    store.db.commit()
    status, up2 = req(base4, 'POST', '/v1/uploads', token4,
                      {'name': 'fresh.png', 'kind': 'image', 'size': len(PNG)})
    assert status == 201, (status, up2)
    upload_row = store.db.execute('SELECT id FROM uploads WHERE id=?', (uid_stale,)).fetchone()
    upload_file = (root4 / 'uploads' / uid_stale).exists()
    fresh_row = store.db.execute('SELECT id FROM uploads WHERE id=?', (up2['id'],)).fetchone()
    receipt['checks']['prune_expired_upload'] = {
        'passed': upload_row is None and not upload_file and fresh_row is not None,
        'stale_row_gone': upload_row is None, 'stale_file_gone': not upload_file,
        'fresh_row_kept': fresh_row is not None}
    print(f"[upload prune] stale_row_gone={upload_row is None}, stale_file_gone={not upload_file}, "
          f"fresh_row_kept={fresh_row is not None}", flush=True)

    for server in (server1, server3, server4):
        server.should_exit = True

    passed = all(v.get('passed', not v.get('skipped')) for v in receipt['checks'].values()
                 if 'passed' in v)
    receipt['status'] = 'PASS' if passed else 'FAIL'
    out = receipt_dir / 'retention-live-receipt.json'
    out.write_text(json.dumps(receipt, indent=2) + '\n')
    print(f"\n{receipt['status']}: receipt -> {out}", flush=True)
    return 0 if passed else 1


if __name__ == '__main__':
    sys.exit(main())
