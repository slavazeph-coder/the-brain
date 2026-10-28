"""Bounded, immutable NVIDIA SimReady package download; never executes asset code.

Operator/build-time tool, not an endpoint accepting arbitrary URLs. Hashes each
file against the pinned Hugging Face tree (SHA-256 for LFS, Git blob ID otherwise)
and retains the original license, package manifest and all payloads/textures.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import tempfile
import urllib.parse
import urllib.request

REPO = 'nvidia/simready-assets'
REVISION = '653d91e182011f357cf1644013cc94ddf194d349'
ASSETS = ('CT_injection_system_a01', 'IV_pole_a01', 'IV_pole_a02', 'IV_pole_a04',
          'IV_pole_b01', 'IV_pole_b02', 'IV_pole_b03', 'TV_a01',
          'Xray_machine_HVgenerator_a01', 'Xray_machine_XrayArmRack_a01',
          'Xray_machine_buckyStand_a01', 'Xray_machine_buckyTable_a01')
MAX_FILES, MAX_BYTES = 2000, 1536 * 1024**2


def safe_relative(value: str) -> str:
    if not isinstance(value, str) or not value or '\\' in value or ':' in value or any(ord(c) < 32 for c in value):
        raise ValueError('Invalid asset path.')
    p = PurePosixPath(value)
    if p.is_absolute() or any(s in ('', '.', '..') for s in value.split('/')):
        raise ValueError('Asset path escapes package.')
    return value


class HTTPSOnly(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        u = urllib.parse.urlsplit(newurl)
        if u.scheme != 'https' or not u.hostname or not (u.hostname == 'huggingface.co' or u.hostname.endswith(('.huggingface.co', '.hf.co'))):
            raise ValueError('Asset redirect left the permitted HTTPS hosts.')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def open_url(url):
    return urllib.request.build_opener(HTTPSOnly()).open(urllib.request.Request(url, headers={'User-Agent':'BrainSNN-SimReady/1'}), timeout=90)


def listing(asset: str, opener=open_url) -> list[dict]:
    if asset not in ASSETS:
        raise ValueError('Asset is not in the pinned NVIDIA submission index.')
    base = f'https://huggingface.co/api/datasets/{REPO}/tree/{REVISION}/{asset}'
    url, result, seen_pages, paths = base + '?recursive=true&expand=false', [], set(), set()
    while url:
        if url in seen_pages or len(seen_pages) >= 10 or urllib.parse.urlsplit(url)._replace(query='', fragment='').geturl() != base:
            raise ValueError('Invalid or excessive listing pagination.')
        seen_pages.add(url)
        with opener(url) as response:
            data = response.read(2 * 1024**2 + 1)
            if len(data) > 2 * 1024**2:
                raise ValueError('Asset listing is oversized.')
            rows, link = json.loads(data), response.headers.get('Link', '')
        if not isinstance(rows, list):
            raise ValueError('Invalid Hugging Face tree.')
        for row in rows:
            path = safe_relative(row.get('path'))
            if not path.startswith(asset + '/'):
                raise ValueError('Listing contains a different package.')
            if row.get('type') == 'directory':
                continue
            if row.get('type') != 'file' or path in paths or type(row.get('size')) is not int or row['size'] < 0:
                raise ValueError('Invalid or duplicate file metadata.')
            digest = row.get('lfs', {}).get('oid') or row.get('oid', '')
            if not re.fullmatch(r'[0-9a-f]{64}' if row.get('lfs') else r'[0-9a-f]{40}', digest):
                raise ValueError('Missing source file hash.')
            paths.add(path); result.append(row)
        if len(result) > MAX_FILES or sum(r['size'] for r in result) > MAX_BYTES:
            raise ValueError('NVIDIA package exceeds import budget.')
        matches = re.findall(r'<([^>]+)>;\s*rel="next"', link)
        url = matches[0] if matches else None
    if not result or not any(r['path'] == asset + '/com.nvidia.simready.packaging.json' for r in result):
        raise ValueError('Package manifest absent.')
    return result


def fetch_file(row: dict, destination: Path, opener=open_url) -> dict:
    path = safe_relative(row['path'])
    url = f'https://huggingface.co/datasets/{REPO}/resolve/{REVISION}/' + urllib.parse.quote(path, safe='/')
    target = destination / path
    target.parent.mkdir(parents=True, exist_ok=True)
    h256 = hashlib.sha256(); hgit = hashlib.sha1(f"blob {row['size']}\0".encode()); size = 0
    with opener(url) as response, target.open('xb') as output:
        while block := response.read(1024**2):
            size += len(block)
            if size > row['size']:
                raise ValueError('Asset exceeds declared size.')
            h256.update(block); hgit.update(block); output.write(block)
    expected = row.get('lfs', {}).get('oid')
    if size != row['size'] or (h256.hexdigest() if expected else hgit.hexdigest()) != (expected or row['oid']):
        raise ValueError('Downloaded file hash or size mismatch: ' + path)
    return {'path':path, 'size':size, 'sha256':h256.hexdigest()}


def package_root(folder: Path) -> Path:
    roots = [p for p in (folder / 'simready_usd').glob('*') if p.is_file() and p.suffix in ('.usd','.usda','.usdc')]
    if len(roots) != 1:
        raise ValueError('Expected exactly one root USD in simready_usd.')
    return roots[0]


def download(asset: str, workspace: Path, opener=open_url) -> dict:
    """Fresh directory only. An incomplete package never gets published."""
    workspace = workspace.resolve(); workspace.mkdir(parents=True, exist_ok=True)
    if (workspace / asset).exists():
        raise ValueError('Refusing to overwrite an installed package.')
    rows = listing(asset, opener)
    with tempfile.TemporaryDirectory(prefix='.nvidia-', dir=workspace) as tmp:
        temp = Path(tmp)
        with ThreadPoolExecutor(max_workers=4) as pool:
            receipts = list(pool.map(lambda r: fetch_file(r, temp, opener), rows))
        folder = temp / asset
        manifest = json.loads((folder / 'com.nvidia.simready.packaging.json').read_text())
        if manifest.get('license') != 'CC-BY-4.0' or not str(manifest.get('package_id', '')).startswith(f'simready.hf.nvidia.simready-assets.{asset}.'):
            raise ValueError('NVIDIA package identity or license changed; review required.')
        for item in manifest.get('metadata', []):
            path = folder / '.metadata' / safe_relative(item['name'])
            if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != item['hash']['sha256']:
                raise ValueError('Package metadata hash mismatch.')
        root = package_root(folder).relative_to(folder).as_posix()
        if not (folder / '.metadata/LICENSE.txt').is_file():
            raise ValueError('Original asset license is missing.')
        folder.rename(workspace / asset)
    result = {'schema':'brainsnn.nvidia-download.v1', 'repo':REPO, 'revision':REVISION, 'asset':asset,
              'source_url':f'https://huggingface.co/datasets/{REPO}/resolve/{REVISION}/{asset}/com.nvidia.simready.packaging.json',
              'license':manifest['license'], 'author':'NVIDIA', 'root_usd':root,
              'package_id':manifest['package_id'], 'file_hashes_checked':True,
              'package_hash_reported':manifest.get('package_hash'), 'package_hash_recomputed':False,
              'files':receipts, 'bytes':sum(r['size'] for r in receipts), 'physics_tested':False}
    (workspace / (asset + '.receipt.json')).write_text(json.dumps(result, indent=2) + '\n')
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0]); p.add_argument('--asset', choices=ASSETS, default='IV_pole_a01')
    p.add_argument('--workspace', type=Path, required=True); a = p.parse_args()
    result = download(a.asset, a.workspace)
    print(json.dumps({k:result[k] for k in ('asset','revision','bytes','file_hashes_checked','physics_tested')}))


if __name__ == '__main__':
    main()
