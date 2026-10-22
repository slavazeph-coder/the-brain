"""Private, operator-provisioned identities; no signup or billing authority.

The bounded registry contains credential hashes, never plaintext credentials.
It is re-read for admission and downloads so removal/rotation revokes access.
Replace the file atomically when editing it. Invalid registries fail closed.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import hmac
import json
from pathlib import Path
import re

OPERATOR_OWNER = 'operator'
REGISTRY_SCHEMA = 'brainsnn.world.tenants.v1'
MIB = 1024 ** 2
OWNER = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')
DIGEST = re.compile(r'^[a-f0-9]{64}$')
CREDENTIAL = re.compile(r'^[A-Za-z0-9_-]{43,128}$')


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate tenant configuration field.')
        result[key] = value
    return result


@dataclass(frozen=True)
class Principal:
    owner_id: str
    credential_hash: str
    engines: frozenset[str]
    limits: dict[str, int]


class Identities:
    def __init__(self, operator_token: str, registry: str | None, engines, storage_limit: int):
        self.operator_token = operator_token
        self.engine_ids = frozenset(engines)
        self.registry = Path(registry) if registry else None
        if self.registry and not self.registry.is_absolute():
            raise ValueError('WORLD_TENANTS_FILE must be an absolute private file path.')
        self.maximum = {'upload_count': 50, 'upload_bytes': 2 * 1024 ** 3,
                        'job_count': 50, 'active_jobs': 9, 'storage_bytes': storage_limit}
        self.defaults = {'upload_count': 12, 'upload_bytes': min(512 * MIB, storage_limit - MIB),
                         'job_count': 12, 'active_jobs': 1, 'storage_bytes': min(6 * 1024 ** 3, storage_limit)}
        self.operator = Principal(OPERATOR_OWNER, hashlib.sha256(operator_token.encode()).hexdigest(),
                                  self.engine_ids, self.maximum | {'active_jobs': 50})
        # Legacy prepared jobs were bounded by global storage and the 50-job
        # retained count; the eight-slot queue applies only when starting them.
        self.read_registry()  # Reject bad trusted configuration before serving.

    def read_registry(self):
        if self.registry is None:
            return {}
        with self.registry.open('rb') as stream:
            raw = stream.read(65537)
        if len(raw) > 65536:
            raise ValueError('Tenant registry exceeds 64 KiB.')
        value = json.loads(raw, object_pairs_hook=unique_object)
        if (not isinstance(value, dict) or set(value) != {'schema', 'tenants'}
                or value['schema'] != REGISTRY_SCHEMA or not isinstance(value['tenants'], list)
                or len(value['tenants']) > 100):
            raise ValueError('Invalid tenant registry schema.')
        result, owners, hashes = {}, set(), {self.operator.credential_hash}
        for entry in value['tenants']:
            if (not isinstance(entry, dict) or set(entry) - {'id', 'token_sha256', 'enabled', 'engines', 'limits'}
                    or not {'id', 'token_sha256'} <= set(entry)):
                raise ValueError('Invalid tenant configuration fields.')
            owner, digest = entry['id'], entry['token_sha256']
            if (not isinstance(owner, str) or not OWNER.fullmatch(owner) or owner == OPERATOR_OWNER
                    or owner in owners or not isinstance(digest, str) or not DIGEST.fullmatch(digest) or digest in hashes):
                raise ValueError('Tenant IDs and credential hashes must be unique and valid.')
            owners.add(owner); hashes.add(digest)
            enabled, engines = entry.get('enabled', True), entry.get('engines', ['inspect'])
            if (type(enabled) is not bool or not isinstance(engines, list) or len(engines) > 17
                    or any(not isinstance(engine, str) or engine not in self.engine_ids for engine in engines)
                    or len(set(engines)) != len(engines)):
                raise ValueError('Invalid tenant engine allowlist or enabled flag.')
            limits = entry.get('limits', {})
            if (not isinstance(limits, dict) or set(limits) - set(self.maximum)
                    or any(type(amount) is not int or not 1 <= amount <= self.maximum[key]
                           for key, amount in limits.items())):
                raise ValueError('Tenant limits must be positive integers within worker caps.')
            if enabled:
                result[owner] = Principal(owner, digest, frozenset(engines), self.defaults | limits)
        return result

    def authenticate(self, authorization: str):
        if len(authorization) > 512:
            return None
        if hmac.compare_digest(authorization.encode(), ('Bearer ' + self.operator_token).encode()):
            return self.operator
        if not authorization.startswith('Bearer ') or not CREDENTIAL.fullmatch(authorization[7:]):
            return None
        digest = hashlib.sha256(authorization[7:].encode()).hexdigest()
        # No credential value appears in errors, public metadata, or the database.
        for principal in self.read_registry().values():
            if hmac.compare_digest(principal.credential_hash, digest):
                return principal
        return None

    def owner(self, owner_id: str):
        return self.operator if owner_id == OPERATOR_OWNER else self.read_registry().get(owner_id)

    def ticket_principal(self, owner_id: str, credential_hash: str):
        principal = self.owner(owner_id)
        if principal and isinstance(credential_hash, str) and hmac.compare_digest(principal.credential_hash, credential_hash):
            return principal
        return None
