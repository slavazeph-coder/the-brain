"""Run one worker job the way the site does: upload each source in chunks, create the job with consent, start it,
and wait for it to finish.

usage: WORLD_WORKER_URL=http://127.0.0.1:8040 WORLD_WORKER_TOKEN=... \
       python worker_client.py ENGINE FILE [FILE ...] [--source-job JOB_ID] [--kind video|image|cloud]
Prints the finished job as JSON (its id names the job directory under the worker's jobs/). The token is read from the
environment only; never write it into a file or a command that is saved.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

CHUNK = 4 * 1024 * 1024  # the worker's default; it advertises its own in /v1/capabilities limits.chunk_bytes
KIND = {'.mp4': 'video', '.mov': 'video', '.webm': 'video', '.json': 'cloud', '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.webp': 'image'}


def call(method, path, body=None, *, raw=None):
    url = os.environ.get('WORLD_WORKER_URL', 'http://127.0.0.1:8040').rstrip('/') + path
    headers = {'Authorization': 'Bearer ' + os.environ['WORLD_WORKER_TOKEN']}
    data = raw
    if body is not None: data = json.dumps(body).encode(); headers['Content-Type'] = 'application/json'
    elif raw is not None: headers['Content-Type'] = 'application/octet-stream'
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, method=method, headers=headers), timeout=120) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        sys.exit(f'{method} {path}: {e.code} {e.read().decode(errors="replace")[:400]}')


def upload(path, kind=None):
    path = Path(path); size = path.stat().st_size
    chunk = int((call('GET', '/v1/capabilities').get('limits') or {}).get('chunk_bytes') or CHUNK)
    item = call('POST', '/v1/uploads', {'name': path.name, 'kind': kind or KIND[path.suffix.lower()], 'size': size})
    with path.open('rb') as f:
        while item['offset'] < size:
            f.seek(item['offset']); item = call('PUT', f"/v1/uploads/{item['id']}?offset={item['offset']}", raw=f.read(chunk))
    return item['id']


def run(engine, files, source_job=None, kind=None, poll=5):
    ids = [upload(p, kind) for p in files]
    job = call('POST', '/v1/jobs', {'engine': engine, 'upload_ids': ids, 'consent': True, **({'source_job': source_job} if source_job else {})})
    call('POST', f"/v1/jobs/{job['id']}/start")
    while job['status'] not in ('complete', 'failed', 'cancelled'):
        time.sleep(poll); job = call('GET', f"/v1/jobs/{job['id']}")
        print(f"{engine} {job['id'][:8]}: {job['status']}", file=sys.stderr, flush=True)
    return job


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('engine'); ap.add_argument('files', nargs='+')
    ap.add_argument('--source-job'); ap.add_argument('--kind', choices=['video', 'image', 'cloud'])
    a = ap.parse_args()
    job = run(a.engine, a.files, a.source_job, a.kind)
    print(json.dumps(job, indent=1))
    if job['status'] != 'complete': sys.exit(1)


if __name__ == '__main__':
    main()
