"""Explicit operator install: pinned source and hash-checked G1 assets, no sample datasets.

Run with the target Python 3.12 after installing requirements-headless.txt.
Runtime jobs themselves never download anything or execute arbitrary commands.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.request

from . import UPSTREAM_COMMIT, UPSTREAM_VERSION

REPO = 'https://github.com/NVIDIA/soma-retargeter.git'
G1 = 'soma_retargeter/assets/robotics/unitree/g1'
ZERO = 'soma_retargeter/assets/soma/soma_zero_frame0.bvh'
CONTACT = 'soma_retargeter/assets/soma/contact_processing/soma_contact_config.json'
REQUIRED_DISTRIBUTIONS = ('newton', 'warp-lang', 'numpy', 'scipy', 'tqdm', 'trimesh', 'pycollada', 'usd-core', 'defusedxml')


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], text=True, timeout=60).strip()


def install(root: Path):
    root = root.resolve()
    if (root / 'brainsnn-runtime.json').is_file() and not (root / '.git').exists():
        from .runtime import verify_runtime
        return verify_runtime(root)
    if root.exists() and (not root.is_dir() or any(root.iterdir())):
        raise ValueError('Use a new empty runtime destination; a full source checkout is not a distributable runtime.')
    root.parent.mkdir(parents=True, exist_ok=True)
    # Never check out the repository: ordinary (non-LFS) sample CSVs are restricted
    # too. Fetch metadata into a disposable directory, materialize only this exact
    # allowlist, and discard ALL Git objects before publishing the runtime.
    with tempfile.TemporaryDirectory(prefix='soma-install-', dir=root.parent) as temporary:
        source, payload = Path(temporary) / 'source', Path(temporary) / 'runtime'
        source.mkdir(); payload.mkdir()
        subprocess.run(['git', 'init', '--quiet', str(source)], check=True, timeout=30)
        git(source, 'remote', 'add', 'origin', REPO)
        subprocess.run(['git', '-C', str(source), 'fetch', '--depth=1', '--filter=blob:none', 'origin', UPSTREAM_COMMIT],
                       check=True, timeout=180)
        if git(source, 'rev-parse', 'FETCH_HEAD') != UPSTREAM_COMMIT:
            raise ValueError('Fetched source does not match the pinned commit.')
        tracked = git(source, 'ls-tree', '-r', '--name-only', UPSTREAM_COMMIT).splitlines()
        selected = [p for p in tracked if runtime_file_allowed(p)]
        # Resolve Git blobs serially: concurrent partial-clone lazy fetches can
        # contend on the object store lock. LFS HTTPS transfers can be parallel.
        blobs = {p: subprocess.check_output(['git', '-C', str(source), 'show', f'{UPSTREAM_COMMIT}:{p}'], timeout=60)
                 for p in selected}
        def materialize(path):
            current = blobs[path]
            if current.startswith(b'version https://git-lfs.github.com/spec/v1\n'):
                pointer = dict(line.split(' ', 1) for line in current.decode().splitlines())
                digest, size = pointer['oid'].split(':')[1], int(pointer['size'])
                if size > 32 * 1024**2:
                    raise ValueError('Pinned runtime asset exceeds the download budget.')
                url = f'https://media.githubusercontent.com/media/NVIDIA/soma-retargeter/{UPSTREAM_COMMIT}/{path}'
                with urllib.request.urlopen(url, timeout=60) as response:
                    current = response.read(size + 1)
                if len(current) != size or hashlib.sha256(current).hexdigest() != digest:
                    raise ValueError(f'Pinned asset checksum failed: {path}')
            target = payload / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(current)
            return path, hashlib.sha256(current).hexdigest()
        with ThreadPoolExecutor(max_workers=4) as pool:
            hashes = dict(pool.map(materialize, selected))
        receipt = {'schema': 'brainsnn.soma-runtime.v1', 'commit': UPSTREAM_COMMIT, 'version': UPSTREAM_VERSION,
                   'target': 'unitree_g1', 'files': hashes,
                   'dependencies': {name: importlib.metadata.version(name) for name in REQUIRED_DISTRIBUTIONS},
                   'sample_dataset_included': False, 'source_checkout_retained': False}
        (payload / 'brainsnn-runtime.json').write_text(json.dumps(receipt, indent=2) + '\n')
        os.replace(payload, root)
    return receipt


def runtime_file_allowed(path: str) -> bool:
    return ((path.startswith('soma_retargeter/') and path.endswith('.py'))
            or path.startswith(G1 + '/') or path in (ZERO, CONTACT, 'LICENSE', 'licenses/unitree-LICENSE.txt'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', type=Path, required=True)
    args = parser.parse_args()
    receipt = install(args.destination)
    print(json.dumps({'runtime': str(args.destination.resolve()), 'commit': receipt['commit'],
                      'verified_files': len(receipt['files']), 'sample_dataset_included': False,
                      'source_checkout_retained': False}))


if __name__ == '__main__':
    main()
