"""The hosted worker's tenant registry, from the site's credentials: brainsnn.com's owner sessions and, when set, its
visitor sessions, each on its own tenant. Only SHA-256 hashes are written; the credentials stay in the environment.

usage: python tenants.py > tenants.json  (reads WORLD_WORKER_SITE_OWNER_TOKEN, WORLD_WORKER_SITE_VISITOR_TOKEN,
WORLD_STORAGE_BYTES, and WORLD_ADAPTERS_FILE for the engines the tenants may use)
"""
from __future__ import annotations
import hashlib
import json
import os
import re
import sys

CREDENTIAL = re.compile(r'^[A-Za-z0-9_-]{43,128}$')
GIB = 1024 ** 3


def registry(env, storage_bytes, engines):
    owner, visitor = env.get('WORLD_WORKER_SITE_OWNER_TOKEN', ''), env.get('WORLD_WORKER_SITE_VISITOR_TOKEN', '')
    if not CREDENTIAL.fullmatch(owner):
        raise ValueError('Set WORLD_WORKER_SITE_OWNER_TOKEN to 43-128 letters, digits, - or _ (the same value as the site).')
    # One job at a time per tenant; a two-minute 4K video needs most of the 4 GiB upload allowance.
    limits = {'upload_count': 24, 'upload_bytes': 4 * GIB, 'job_count': 24, 'active_jobs': 1, 'storage_bytes': storage_bytes}
    tenants = [{'id': 'site-owner', 'token_sha256': hashlib.sha256(owner.encode()).hexdigest(), 'engines': engines, 'limits': limits}]
    if visitor:
        if not CREDENTIAL.fullmatch(visitor) or visitor == owner:
            raise ValueError('WORLD_WORKER_SITE_VISITOR_TOKEN must be its own 43-128 character credential.')
        tenants.append({'id': 'site-visitors', 'token_sha256': hashlib.sha256(visitor.encode()).hexdigest(), 'engines': engines,
                        'limits': {**limits, 'upload_count': 50, 'job_count': 50}})
    return {'schema': 'brainsnn.world.tenants.v1', 'tenants': tenants}


def enabled_engines(adapters_file):
    """The engines the worker serves: a tenant naming one it does not would stop the worker from starting."""
    with open(adapters_file) as stream:
        return [entry['id'] for entry in json.load(stream) if entry.get('enabled') and entry.get('license_reviewed')]


if __name__ == '__main__':
    engines = enabled_engines(os.environ['WORLD_ADAPTERS_FILE'])
    sys.stdout.write(json.dumps(registry(os.environ, int(os.environ.get('WORLD_STORAGE_BYTES', 20 * GIB)), engines), indent=1) + '\n')
