#!/usr/bin/env python3
"""Validated, localhost-only vLLM launch; called with runtime's filtered environment."""
import os
from pathlib import Path
import re
import sys


def command(env):
    model = env.get('MODEL_PATH', '').strip()
    if not model:
        raise ValueError('Choose MODEL_PATH before enabling inference')
    revision = env.get('MODEL_REVISION', '')
    local = Path(model).is_dir()
    if not local and (env.get('ALLOW_MODEL_DOWNLOAD') != '1' or not re.fullmatch(r'[0-9a-f]{40}', revision)):
        raise ValueError('Remote model requires explicit download enablement and a full commit MODEL_REVISION')
    executable = env.get('VLLM_EXECUTABLE', '')
    if not Path(executable).is_file() or not os.access(executable, os.X_OK):
        raise ValueError('VLLM_EXECUTABLE must be an installed absolute executable')
    memory = float(env.get('GPU_MEMORY_UTILIZATION', '0.6'))
    length = int(env.get('MAX_MODEL_LEN', '8192'))
    if not 0.1 <= memory <= 0.9 or not 512 <= length <= 32768:
        raise ValueError('Check memory utilization (0.1..0.9) and context length (512..32768)')
    args = [executable, 'serve', model, '--host', '127.0.0.1', '--port', env['BACKEND_PORT'],
            '--served-model-name', env['SERVED_MODEL_NAME'], '--max-model-len', str(length),
            '--gpu-memory-utilization', str(memory), '--max-num-seqs', '2', '--disable-log-requests']
    if not local:
        args += ['--revision', revision]
    # Intentionally never enable trust_remote_code or arbitrary additional CLI flags.
    return args


if __name__ == '__main__':
    try:
        args = command(os.environ)
    except (ValueError, KeyError) as error:
        sys.exit(str(error))
    os.environ['VLLM_API_KEY'] = os.environ.pop('BACKEND_API_KEY')
    os.execv(args[0], args)
