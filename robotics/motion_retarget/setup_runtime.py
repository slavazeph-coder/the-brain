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
from pathlib import Path
import subprocess
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
    if not root.exists():
        subprocess.run(['git', 'clone', '--filter=blob:none', '--no-checkout', REPO, str(root)], check=True, timeout=180)
        subprocess.run(['git', '-C', str(root), '-c', 'filter.lfs.smudge=', '-c', 'filter.lfs.required=false',
                        'checkout', UPSTREAM_COMMIT], check=True, timeout=180)
    if git(root, 'rev-parse', 'HEAD') != UPSTREAM_COMMIT:
        raise ValueError('Existing source checkout is not the required commit; use a new install directory.')
    # The fixed tree lists exactly the files the runtime can execute/read. Fetch LFS
    # objects via public HTTPS, checking their pointer hashes and sizes. No Git LFS
    # executable or bundled example motion corpus is needed.
    tracked = git(root, 'ls-tree', '-r', '--name-only', UPSTREAM_COMMIT).splitlines()
    selected = [p for p in tracked if (p.startswith('soma_retargeter/') and p.endswith('.py'))
                or p.startswith(G1 + '/') or p in (ZERO, CONTACT, 'LICENSE', 'licenses/unitree-LICENSE.txt')]
    def materialize(path):
        expected = subprocess.check_output(['git', '-C', str(root), 'show', f'{UPSTREAM_COMMIT}:{path}'], timeout=60)
        target = root / path
        if expected.startswith(b'version https://git-lfs.github.com/spec/v1\n'):
            pointer = dict(line.split(' ', 1) for line in expected.decode().splitlines())
            digest, size = pointer['oid'].split(':')[1], int(pointer['size'])
            if size > 32 * 1024**2:
                raise ValueError('Pinned runtime asset exceeds the download budget.')
            current = target.read_bytes() if target.is_file() and not target.is_symlink() else b''
            if len(current) != size or hashlib.sha256(current).hexdigest() != digest:
                url = f'https://media.githubusercontent.com/media/NVIDIA/soma-retargeter/{UPSTREAM_COMMIT}/{path}'
                with urllib.request.urlopen(url, timeout=60) as response:
                    current = response.read(size + 1)
                if len(current) != size or hashlib.sha256(current).hexdigest() != digest:
                    raise ValueError(f'Pinned asset checksum failed: {path}')
                target.write_bytes(current)
        else:
            current = target.read_bytes()
            if current != expected:
                raise ValueError(f'Upstream source modified: {path}')
        return path, hashlib.sha256(current).hexdigest()
    with ThreadPoolExecutor(max_workers=4) as pool:
        hashes = dict(pool.map(materialize, selected))
    receipt = {'schema': 'brainsnn.soma-runtime.v1', 'commit': UPSTREAM_COMMIT, 'version': UPSTREAM_VERSION,
               'target': 'unitree_g1', 'files': hashes,
               'dependencies': {name: importlib.metadata.version(name) for name in REQUIRED_DISTRIBUTIONS},
               'sample_dataset_downloaded': False}
    (root / 'brainsnn-runtime.json').write_text(json.dumps(receipt, indent=2) + '\n')
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', type=Path, required=True)
    args = parser.parse_args()
    receipt = install(args.destination)
    print(json.dumps({'runtime': str(args.destination.resolve()), 'commit': receipt['commit'],
                      'verified_files': len(receipt['files']), 'sample_dataset_downloaded': False}))


if __name__ == '__main__':
    main()
