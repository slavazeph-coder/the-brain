"""Exact-byte worker receipts. A signature is not independent model/host truth.

Signing is disabled unless an existing, persistent private key is explicitly
configured. No authentication credential or download-ticket key is reused.
"""
from __future__ import annotations

import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import time

PAYLOAD_SCHEMA = 'brainsnn.world.report-receipt.v1'
ENVELOPE_SCHEMA = 'brainsnn.world.signed-report-receipt.v1'
KEY_SCHEMA = 'brainsnn.world.report-key.v1'
DOMAIN = (PAYLOAD_SCHEMA + '\n').encode()
MAX_RECEIPT_BYTES = 64 * 1024
MAX_SCENARIO_BYTES = 4 * 1024 ** 2
MAX_ARTIFACT_BYTES = 256 * 1024 ** 2
SHA = re.compile(r'^[a-f0-9]{64}$')
ID = re.compile(r'^[a-f0-9]{32}$')
OWNER = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')
NAME = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$')


def exact(value, keys):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise ValueError('Unsupported receipt fields.')


def parse_json(raw, limit=MAX_RECEIPT_BYTES):
    if isinstance(raw, str):
        raw = raw.encode('utf-8')
    if not isinstance(raw, bytes) or len(raw) > limit:
        raise ValueError('Receipt JSON exceeds its byte limit.')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate JSON fields are unsupported.')
            result[key] = value
        return result
    def invalid(_):
        raise ValueError('Non-finite JSON numbers are unsupported.')
    try:
        return json.loads(raw, object_pairs_hook=unique, parse_constant=invalid)
    except (UnicodeError, RecursionError) as error:
        raise ValueError('Invalid receipt JSON.') from error


def encoded(raw):
    return base64.urlsafe_b64encode(raw).decode('ascii').rstrip('=')


def decoded(value, length):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', value) or len(value) != (length * 8 + 5) // 6:
        raise ValueError('Invalid receipt key or signature encoding.')
    raw = base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))
    if len(raw) != length or encoded(raw) != value:
        raise ValueError('Noncanonical receipt key or signature.')
    return raw


def digest(value):
    if not isinstance(value, str) or not SHA.fullmatch(value):
        raise ValueError('Expected a lowercase SHA-256 digest.')
    return value


def bounded_text(value, maximum):
    if (not isinstance(value, str) or not 1 <= len(value) <= maximum or not value.strip()
            or any(ord(char) < 32 or 0xD800 <= ord(char) <= 0xDFFF for char in value)):
        raise ValueError('Invalid receipt text.')


def positive(value, maximum):
    if type(value) is not int or not 1 <= value <= maximum:
        raise ValueError('Invalid receipt byte count.')


def validate_evidence(value):
    exact(value, ['authority', 'sources', 'artifacts'])
    if value['authority'] != 'worker-verified-bytes':
        raise ValueError('Unsupported evidence authority.')
    sources, artifacts = value['sources'], value['artifacts']
    if not isinstance(sources, list) or not 1 <= len(sources) <= 12 or not isinstance(artifacts, list) or not 1 <= len(artifacts) <= 32:
        raise ValueError('Receipt evidence exceeds record limits.')
    source_ids, names = set(), set()
    for source in sources:
        exact(source, ['id', 'kind', 'size', 'sha256'])
        if not isinstance(source['id'], str) or not ID.fullmatch(source['id']) or source['id'] in source_ids or source['kind'] not in ['image', 'video']:
            raise ValueError('Invalid or duplicate receipt source.')
        source_ids.add(source['id']); digest(source['sha256']); positive(source['size'], 200 * 1024 ** 2)
    for artifact in artifacts:
        exact(artifact, ['name', 'kind', 'size', 'sha256'])
        if not isinstance(artifact['name'], str) or not NAME.fullmatch(artifact['name']) or artifact['name'] in names:
            raise ValueError('Invalid or duplicate receipt artifact.')
        names.add(artifact['name']); digest(artifact['sha256']); positive(artifact['size'], 3 * 1024 ** 3)
        bounded_text(artifact['kind'], 40)
    return value


def validate_payload(value):
    exact(value, ['schema', 'keyId', 'issuedAt', 'ownerId', 'job', 'evidence', 'scenario',
                  'metricVerified', 'policyExecuted', 'safetyCertified', 'independentHostAttestation'])
    if value['schema'] != PAYLOAD_SCHEMA or any(value[key] is not False for key in ['metricVerified', 'policyExecuted', 'safetyCertified', 'independentHostAttestation']):
        raise ValueError('Receipt cannot assert measurements, safety, policy execution or independent attestation.')
    digest(value['keyId'])
    if not isinstance(value['issuedAt'], str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z', value['issuedAt']):
        raise ValueError('Invalid receipt issue time.')
    datetime.fromisoformat(value['issuedAt'].replace('Z', '+00:00'))
    if not isinstance(value['ownerId'], str) or not OWNER.fullmatch(value['ownerId']):
        raise ValueError('Invalid receipt owner.')
    exact(value['job'], ['id', 'engine'])
    if not isinstance(value['job']['id'], str) or not ID.fullmatch(value['job']['id']):
        raise ValueError('Invalid receipt job.')
    bounded_text(value['job']['engine'], 64)
    validate_evidence(value['evidence'])
    exact(value['scenario'], ['sha256', 'geometrySha256', 'authority'])
    digest(value['scenario']['sha256'])
    if value['scenario']['geometrySha256'] is not None:
        digest(value['scenario']['geometrySha256'])
    if value['scenario']['authority'] != 'owner-declared':
        raise ValueError('Scenario linkage must remain owner-declared.')
    return value


def public_key_document(raw):
    if not isinstance(raw, bytes) or len(raw) != 32:
        raise ValueError('Expected a 32-byte Ed25519 public key.')
    return {'schema': KEY_SCHEMA, 'algorithm': 'Ed25519', 'keyId': hashlib.sha256(raw).hexdigest(), 'publicKey': encoded(raw)}


def file_digest(path, expected_size, *, expected_sha256=None, deadline=None, cancelled=None):
    """Read exact bounded regular-file bytes; refuse links and observed mutation."""
    positive(expected_size, 3 * 1024 ** 3)
    if expected_sha256 is not None: digest(expected_sha256)
    with os.fdopen(os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)), 'rb') as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size != expected_size:
            raise ValueError('Evidence file is missing or changed.')
        result, count = hashlib.sha256(), 0
        while True:
            if (cancelled is not None and cancelled.is_set()) or (deadline is not None and time.monotonic() >= deadline):
                raise TimeoutError('Evidence verification exceeded its deadline or was cancelled.')
            block = stream.read(min(1024 ** 2, expected_size - count + 1))
            if not block: break
            count += len(block)
            if count > expected_size: raise ValueError('Evidence file is oversized or changed.')
            result.update(block)
        after = os.fstat(stream.fileno())
    stamp = lambda info: (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
    if count != expected_size or stamp(before) != stamp(after) or stamp(after) != stamp(os.stat(path, follow_symlinks=False)):
        raise ValueError('Evidence changed during verification.')
    value = result.hexdigest()
    if expected_sha256 is not None and value != expected_sha256:
        raise ValueError('Evidence file hash no longer matches the completed job.')
    return value


def trusted_key_bytes(value):
    if isinstance(value, bytes):
        public_key_document(value)
        return value
    exact(value, ['schema', 'algorithm', 'keyId', 'publicKey'])
    if value['schema'] != KEY_SCHEMA or value['algorithm'] != 'Ed25519':
        raise ValueError('Unsupported trusted public key.')
    raw = decoded(value['publicKey'], 32)
    if public_key_document(raw)['keyId'] != value['keyId']:
        raise ValueError('Trusted key fingerprint mismatch.')
    return raw


class ReportSigner:
    def __init__(self, path):
        try:
            from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        except ImportError as error:
            raise RuntimeError('Configured report signing requires requirements-report-receipts.txt.') from error
        path = Path(path)
        if not path.is_absolute():
            raise ValueError('Report signing key path must be absolute.')
        flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0)
        with os.fdopen(os.open(path, flags), 'rb') as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size != 32 or (os.name == 'posix' and info.st_mode & 0o077):
                raise ValueError('Report signing key must be a private 32-byte regular file (mode 0600).')
            self._key = Ed25519PrivateKey.from_private_bytes(stream.read(33))
        self._public = public_key_document(self._key.public_key().public_bytes_raw())

    def public_key(self):
        return dict(self._public)

    def sign(self, payload):
        validate_payload(payload)
        if payload['keyId'] != self._public['keyId']:
            raise ValueError('Payload must name the configured signing key.')
        text = json.dumps(payload, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)
        raw = text.encode('utf-8')
        envelope = {'schema': ENVELOPE_SCHEMA, 'algorithm': 'Ed25519', 'keyId': self._public['keyId'],
                    'payloadText': text, 'payloadSha256': hashlib.sha256(raw).hexdigest(),
                    'signature': encoded(self._key.sign(DOMAIN + raw))}
        if len(json.dumps(envelope, ensure_ascii=False).encode()) > MAX_RECEIPT_BYTES:
            raise ValueError('Signed receipt exceeds 64 KiB.')
        return envelope


def make_payload(key_id, owner_id, job, evidence, scenario_sha256, geometry_sha256):
    return validate_payload({'schema': PAYLOAD_SCHEMA, 'keyId': key_id,
        'issuedAt': datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
        'ownerId': owner_id, 'job': {'id': job['id'], 'engine': job['engine']}, 'evidence': evidence,
        'scenario': {'sha256': scenario_sha256, 'geometrySha256': geometry_sha256, 'authority': 'owner-declared'},
        'metricVerified': False, 'policyExecuted': False, 'safetyCertified': False, 'independentHostAttestation': False})


def verify_receipt(envelope, expected_public_key, scenario_bytes=None):
    """Caller must independently trust this key; an embedded key is not authority."""
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    if isinstance(envelope, (bytes, str)):
        envelope = parse_json(envelope)
    else:
        parse_json(json.dumps(envelope, ensure_ascii=False, allow_nan=False))
    exact(envelope, ['schema', 'algorithm', 'keyId', 'payloadText', 'payloadSha256', 'signature'])
    if envelope['schema'] != ENVELOPE_SCHEMA or envelope['algorithm'] != 'Ed25519' or not isinstance(envelope['payloadText'], str):
        raise ValueError('Unsupported signed receipt.')
    raw_key = trusted_key_bytes(expected_public_key)
    key_id = public_key_document(raw_key)['keyId']
    if envelope['keyId'] != key_id:
        raise ValueError('Receipt key does not match the independently trusted key.')
    raw = envelope['payloadText'].encode('utf-8')
    if hashlib.sha256(raw).hexdigest() != envelope['payloadSha256']:
        raise ValueError('Receipt payload hash mismatch.')
    Ed25519PublicKey.from_public_bytes(raw_key).verify(decoded(envelope['signature'], 64), DOMAIN + raw)
    payload = validate_payload(parse_json(raw))
    if payload['keyId'] != key_id:
        raise ValueError('Signed key identifier mismatch.')
    if scenario_bytes is not None:
        if not isinstance(scenario_bytes, bytes) or hashlib.sha256(scenario_bytes).hexdigest() != payload['scenario']['sha256']:
            raise ValueError('Scenario file bytes do not match the signed owner declaration.')
    return payload


def init_key(private_path, public_path):
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    private_path, public_path = Path(private_path), Path(public_path)
    if not private_path.is_absolute() or not public_path.is_absolute() or private_path == public_path:
        raise ValueError('Use distinct absolute private/public key paths.')
    if private_path.exists() or public_path.exists():
        raise ValueError('Key initialization never overwrites an existing file.')
    key = Ed25519PrivateKey.generate()
    # O_EXCL also refuses dangling symlinks and races after the preflight.
    created = []
    try:
        for path, raw in [(private_path, key.private_bytes_raw()),
                          (public_path, json.dumps(public_key_document(key.public_key().public_bytes_raw()), indent=2).encode())]:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            created.append(path)
            with os.fdopen(fd, 'wb') as stream:
                stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    except Exception:
        for path in created:
            path.unlink(missing_ok=True)
        raise
    return public_key_document(key.public_key().public_bytes_raw())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    init = commands.add_parser('init-key', help='Create a persistent key pair once; never prints private bytes.')
    init.add_argument('--private-key', required=True); init.add_argument('--public-key', required=True)
    verify = commands.add_parser('verify', help='Verify with an independently trusted key and exact local scenario file.')
    verify.add_argument('--receipt', required=True); verify.add_argument('--trusted-public-key', required=True); verify.add_argument('--scenario', required=True)
    args = parser.parse_args()
    try:
        if args.command == 'init-key':
            print(json.dumps(init_key(args.private_key, args.public_key)))
        else:
            def read(path, limit):
                with Path(path).open('rb') as stream: raw = stream.read(limit + 1)
                if len(raw) > limit: raise ValueError('Verification input exceeds its size limit.')
                return raw
            payload = verify_receipt(read(args.receipt, MAX_RECEIPT_BYTES), parse_json(read(args.trusted_public_key, 1024)), read(args.scenario, MAX_SCENARIO_BYTES))
            print(json.dumps({'verified': True, 'keyId': payload['keyId'], 'jobId': payload['job']['id'],
                              'claim': 'Worker receipt and exact scenario hash verified. Measurements, model truth and host independence remain unverified.'}))
    except Exception:
        parser.exit(2, 'Receipt operation rejected: check the configured key, exact bytes and independently trusted fingerprint.\n')


if __name__ == '__main__':
    main()
