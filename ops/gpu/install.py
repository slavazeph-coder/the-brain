#!/usr/bin/env python3
"""Install runtime files only. Never install packages, download models, or start jobs."""
import argparse
import os
from pathlib import Path
import secrets
import shutil

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--destination', default='/workspace/slava/brainsnn-gpu-runtime')
args = parser.parse_args()
os.umask(0o077)
source, dest = Path(__file__).resolve().parent, Path(args.destination).resolve()
dest.mkdir(parents=True, exist_ok=True)
for name in ('runtime.py', 'vllm_launch.py', 'llamacpp_launch.py', 'checkpoint.py', 'evaluate_queue.py',
             'evaluation-cases.jsonl', 'runtime.env.example', 'README.md', 'host-recovery.md'):
    if source != dest:
        shutil.copy2(source / name, dest / name)
for name in ('state', 'logs', 'checkpoints', 'cache'):
    (dest / name).mkdir(mode=0o700, exist_ok=True)
config = dest / 'runtime.env'
if not config.exists():
    value = (source / 'runtime.env.example').read_text().replace('__RUNTIME_DIR__', str(dest))
    while 'GENERATE_ON_INSTALL' in value:
        value = value.replace('GENERATE_ON_INSTALL', secrets.token_urlsafe(32), 1)
    config.write_text(value)
    config.chmod(0o600)
print(f'Installed files at {dest}; private runtime.env preserved/created. No workload started.')
