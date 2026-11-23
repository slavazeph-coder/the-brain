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
# What one job holds at once: the worker's 4 GiB job reservation beside a 2 GiB video, plus the scene step's cloud and
# finished outputs. A tenant with less storage can upload but never start a job.
ONE_JOB = 6.5 * GIB


def derived_credential(passcode, tenant):
    """The site's derivedCredential(): HMAC-SHA256 of the tenant label, keyed by the passcode, as unpadded base64url."""
    digest = hmac.new(passcode.encode(), f'brainsnn.world.{tenant}.v1'.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b'=').decode()


def registry(env, storage_bytes, engines):
    if storage_bytes < ONE_JOB:
        raise ValueError(f'WORLD_STORAGE_BYTES must be at least {int(ONE_JOB)} (an 8 GB volume): '
                         'each job reserves 4 GiB beside its video.')
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
        # worker's global caps (50 uploads, 6 GiB of reservations), so the owner can always upload a 2 GiB video. Their
        # storage is half the volume, but never less than one job; on a small volume they and the owner take turns.
        # Match the site's visitor allowlist at the worker too. Private replay,
        # naming/location and packaging engines stay with owner sessions.
        visitor_engines = [engine for engine in engines if engine in ('colmap-sparse', 'photo-metric', 'metric-depth-sequence', 'scene-usd')]
        tenants.append({'id': 'site-visitors', 'token_sha256': hashlib.sha256(visitor.encode()).hexdigest(), 'engines': visitor_engines,
                        'limits': {**limits, 'upload_count': 20, 'upload_bytes': 2 * GIB, 'job_count': 20,
                                   'storage_bytes': min(storage_bytes, max(int(ONE_JOB), storage_bytes // 2))}})
    # API organizations have dedicated worker identities. Keep their explicit
    # engine grants and limits through a Railway restart instead of silently
    # replacing the registry with only the two legacy website tenants.
    extra_raw = env.get('WORLD_PROJECT_WORKER_TENANTS_JSON', '')
    if extra_raw:
        if len(extra_raw.encode()) > 32768:
            raise ValueError('Project worker tenant configuration exceeds 32 KiB.')
        def unique(pairs):
            result = {}
            for key, value in pairs:
                if key in result: raise ValueError('Duplicate project worker tenant field.')
                result[key] = value
            return result
        entries = json.loads(extra_raw, object_pairs_hook=unique)
        if not isinstance(entries, list) or len(entries) > 98:
            raise ValueError('Project worker tenants must be an array of at most 98 entries.')
        owners = {entry['id'] for entry in tenants} | {'operator'}
        hashes = {entry['token_sha256'] for entry in tenants}
        maximum = {'upload_count': 50, 'upload_bytes': 4 * GIB, 'job_count': 50, 'active_jobs': 9, 'storage_bytes': storage_bytes}
        for entry in entries:
            if not isinstance(entry, dict) or set(entry) != {'id', 'token_sha256', 'engines', 'limits'}:
                raise ValueError('Project worker tenants need id, token_sha256, engines and limits.')
            owner_id, digest = entry['id'], entry['token_sha256']
            if (not isinstance(owner_id, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}', owner_id)
                    or owner_id in owners or not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest) or digest in hashes):
                raise ValueError('Project worker tenant IDs and credentials must be unique.')
            grants, bounds = entry['engines'], entry['limits']
            if (not isinstance(grants, list) or not grants or len(grants) > 17
                    or any(not isinstance(grant, str) or grant not in engines for grant in grants) or len(set(grants)) != len(grants)):
                raise ValueError('Project worker engines must be explicit enabled engine grants.')
            if (not isinstance(bounds, dict) or set(bounds) != set(maximum)
                    or any(type(value) is not int or not 1 <= value <= maximum[key] for key, value in bounds.items())):
                raise ValueError('Project worker tenants require explicit limits within worker capacity.')
            owners.add(owner_id); hashes.add(digest); tenants.append(entry)
    return {'schema': 'brainsnn.world.tenants.v1', 'tenants': tenants}


def enabled_engines(adapters_file):
    """The engines the worker serves: a tenant naming one it does not would stop the worker from starting."""
    with open(adapters_file) as stream:
        return [entry['id'] for entry in json.load(stream) if entry.get('enabled') and entry.get('license_reviewed')]


if __name__ == '__main__':
    engines = enabled_engines(os.environ['WORLD_ADAPTERS_FILE'])
    sys.stdout.write(json.dumps(registry(os.environ, int(os.environ.get('WORLD_STORAGE_BYTES', 20 * GIB)), engines), indent=1) + '\n')
