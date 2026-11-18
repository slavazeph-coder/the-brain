"""Install the exact official OpenSim CPU wheel into an isolated Python 3.12 venv."""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import urllib.request

from . import VERSION, NATIVE_BUILD

WHEELS = {
    'Darwin': ('opensim-4.6-2-cp312-cp312-macosx_15_0_universal2.whl', '4dfb85d175bcdb0bb4a6c567d8cf12f30afcbcec342bd356513a82403089df16'),
    'Linux': ('opensim-4.6-2-cp312-cp312-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl', '6bb4983097323e60326f6f102ee9f385e470deba6cb3a666219bf27aacbefb6d'),
}
DEPENDENCIES = {'numpy': '2.4.3', 'scipy': '1.17.1', 'defusedxml': '0.7.1'}


def receipt_path():
    return Path(sys.prefix) / 'brainsnn-opensim-runtime.json'


def package_hashes():
    distribution = importlib.metadata.distribution('opensim')
    result = {}
    for relative in distribution.files or []:
        text = str(relative)
        if not text.startswith('opensim/') or '__pycache__' in text:
            continue
        path = Path(distribution.locate_file(relative))
        if path.is_symlink() or not path.is_file():
            raise RuntimeError('Unexpected OpenSim package file.')
        result[text] = hashlib.sha256(path.read_bytes()).hexdigest()
    if len(result) < 10:
        raise RuntimeError('Incomplete OpenSim package.')
    return result


def verify_runtime():
    path = receipt_path()
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 256 * 1024:
        raise RuntimeError('Install and qualify the pinned OpenSim runtime first.')
    receipt = json.loads(path.read_text())
    if receipt.get('schema') != 'brainsnn.opensim-runtime.v1' or receipt.get('version') != VERSION:
        raise RuntimeError('Wrong OpenSim runtime receipt.')
    wheel = WHEELS.get(platform.system())
    if not wheel or receipt.get('wheel_sha256') != wheel[1] or receipt.get('files') != package_hashes():
        raise RuntimeError('OpenSim runtime package changed or is not the pinned platform wheel.')
    if importlib.metadata.version('opensim') != VERSION:
        raise RuntimeError('Wrong OpenSim version.')
    for name, version in DEPENDENCIES.items():
        if importlib.metadata.version(name) != version:
            raise RuntimeError(f'Wrong native-analysis dependency: {name}.')
    import opensim
    build = opensim.GetVersionAndDate()
    if not build.startswith(NATIVE_BUILD):
        raise RuntimeError('OpenSim native build differs from the qualified wheel.')
    return receipt


def install():
    if sys.version_info[:2] != (3, 12) or sys.prefix == sys.base_prefix:
        raise RuntimeError('Use a separate Python 3.12 virtual environment.')
    system = platform.system()
    if system not in WHEELS or (system == 'Linux' and platform.machine() not in ('x86_64', 'AMD64')):
        raise RuntimeError('Qualified platforms are macOS 15+ and Linux x86-64, Python 3.12.')
    filename, expected = WHEELS[system]
    with urllib.request.urlopen('https://pypi.org/pypi/opensim/4.6/json', timeout=30) as response:
        metadata = json.load(response)
    matches = [item for item in metadata['urls'] if item['filename'] == filename and item['digests']['sha256'] == expected]
    if len(matches) != 1 or not matches[0]['url'].startswith('https://files.pythonhosted.org/'):
        raise RuntimeError('Official wheel does not match the pinned digest.')
    with tempfile.TemporaryDirectory(prefix='brainsnn-opensim-') as directory:
        wheel = Path(directory) / filename
        with urllib.request.urlopen(matches[0]['url'], timeout=60) as response:
            raw = response.read(100 * 1024**2 + 1)
        if len(raw) > 100 * 1024**2 or hashlib.sha256(raw).hexdigest() != expected:
            raise RuntimeError('OpenSim wheel checksum mismatch.')
        wheel.write_bytes(raw)
        subprocess.run([sys.executable, '-m', 'pip', 'install', '--no-cache-dir',
                        *[f'{name}=={version}' for name, version in DEPENDENCIES.items()]], check=True, timeout=300)
        subprocess.run([sys.executable, '-m', 'pip', 'install', '--no-cache-dir', '--no-deps', '--force-reinstall', str(wheel)], check=True, timeout=300)
    import opensim
    receipt = {'schema': 'brainsnn.opensim-runtime.v1', 'version': VERSION,
               'native_build': opensim.GetVersionAndDate(), 'wheel': filename, 'wheel_sha256': expected,
               'dependencies': DEPENDENCIES, 'files': package_hashes()}
    receipt_path().write_text(json.dumps(receipt, indent=2) + '\n')
    return verify_runtime()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    receipt = verify_runtime() if args.verify_only else install()
    print(json.dumps({key: receipt[key] for key in ('version', 'native_build', 'wheel', 'wheel_sha256')}))


if __name__ == '__main__':
    main()
