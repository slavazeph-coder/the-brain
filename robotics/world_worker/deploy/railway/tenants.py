"""The hosted worker's tenant registry: brainsnn.com's owner sessions and its visitor sessions, each on its own tenant.
Only SHA-256 hashes are written; the credentials stay in the environment.

The credentials derive from WORLD_SITE_PASSCODE exactly as the site's worldWorkerProxy.js derives them, so the two
services share one secret. WORLD_WORKER_SITE_OWNER_TOKEN / WORLD_WORKER_SITE_VISITOR_TOKEN override that.

usage: python tenants.py > tenants.json  (also reads WORLD_STORAGE_BYTES, and WORLD_ADAPTERS_FILE for the engines)
"""
from __future__ import annotations
import base64
import hashlib
import hmac
import json
import os
import re
import sys

CREDENTIAL = re.compile(r'^[A-Za-z0-9_-]{43,128}$')
GIB = 1024 ** 3


def derived_credential(passcode, tenant):
    """The site's derivedCredential(): HMAC-SHA256 of the tenant label, keyed by the passcode, as unpadded base64url."""
    digest = hmac.new(passcode.encode(), f'brainsnn.world.{tenant}.v1'.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b'=').decode()


def registry(env, storage_bytes, engines):
    passcode = env.get('WORLD_SITE_PASSCODE', '')
    derive = lambda tenant: derived_credential(passcode, tenant) if len(passcode) >= 12 else ''
    owner = env.get('WORLD_WORKER_SITE_OWNER_TOKEN') or derive('site-owner')
    visitor = env.get('WORLD_WORKER_SITE_VISITOR_TOKEN') or derive('site-visitors')
    if not CREDENTIAL.fullmatch(owner):
        raise ValueError('Set WORLD_SITE_PASSCODE (12 characters or more, the same value as the site), '
                         'or WORLD_WORKER_SITE_OWNER_TOKEN.')
    # One job at a time per tenant; a two-minute 4K video needs most of the 4 GiB upload allowance.
    limits = {'upload_count': 24, 'upload_bytes': 4 * GIB, 'job_count': 24, 'active_jobs': 1, 'storage_bytes': storage_bytes}
    tenants = [{'id': 'site-owner', 'token_sha256': hashlib.sha256(owner.encode()).hexdigest(), 'engines': engines, 'limits': limits}]
    if visitor:
        if not CREDENTIAL.fullmatch(visitor) or visitor == owner:
            raise ValueError('WORLD_WORKER_SITE_VISITOR_TOKEN must be its own 43-128 character credential.')
        # Visitors share one tenant, so its limits are what all visitors together can hold. They stay well inside the
        # worker's global caps (50 uploads, 6 GiB of reservations), so the owner can always upload a 2 GiB video.
        tenants.append({'id': 'site-visitors', 'token_sha256': hashlib.sha256(visitor.encode()).hexdigest(), 'engines': engines,
                        'limits': {**limits, 'upload_count': 20, 'upload_bytes': 2 * GIB, 'job_count': 20,
                                   'storage_bytes': storage_bytes // 2}})
    return {'schema': 'brainsnn.world.tenants.v1', 'tenants': tenants}


def enabled_engines(adapters_file):
    """The engines the worker serves: a tenant naming one it does not would stop the worker from starting."""
    with open(adapters_file) as stream:
        return [entry['id'] for entry in json.load(stream) if entry.get('enabled') and entry.get('license_reviewed')]


if __name__ == '__main__':
    engines = enabled_engines(os.environ['WORLD_ADAPTERS_FILE'])
    sys.stdout.write(json.dumps(registry(os.environ, int(os.environ.get('WORLD_STORAGE_BYTES', 20 * GIB)), engines), indent=1) + '\n')
