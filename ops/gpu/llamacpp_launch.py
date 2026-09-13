#!/usr/bin/env python3
"""Validated, localhost-only llama.cpp launch; called with runtime's filtered environment.

Sibling to vllm_launch.py. Same contract: build a fixed argument list, bind to
loopback only, never accept arbitrary extra CLI flags. Selected by pointing
INFERENCE_COMMAND at this file instead of vllm_launch.py.

Why a second backend exists
---------------------------
The target host reports `Max CUDA: 12.2` (~535 driver). vLLM pins recent torch
and CUDA wheels, so the compatible vLLM line is narrow and must also be new
enough to read the model's separate `chat_template.jinja`. llama.cpp builds
against a much wider CUDA range and reads GGUF chat templates natively, which
removes both risks.

gpuInference.js validates each response and falls back when validation fails.
Do not enable the optional global JSON schema for BrainSNN: the adapter sends
response_format=json_object, and combining both grammars failed sampler
initialization in the real CPU smoke test. Output quality still needs evaluation.

Model identity
--------------
vLLM pins a remote repo with a 40-hex MODEL_REVISION. llama.cpp loads a local
GGUF file, so identity is pinned by content instead: set MODEL_SHA256 and the
file is hashed before launch. That is a stronger guarantee than a tag, and it
keeps the evaluation ledger's "model revision changes evaluation identity"
invariant meaningful.
"""
import hashlib
import os
from pathlib import Path
import re
import sys


def _hash_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def command(env):
    model = env.get('MODEL_PATH', '').strip()
    if not model:
        raise ValueError('Choose MODEL_PATH before enabling inference')
    model_path = Path(model)
    # llama.cpp serves a local GGUF. Remote fetching is intentionally not
    # delegated to the server process.
    if not model_path.is_file() or model_path.suffix != '.gguf':
        raise ValueError('MODEL_PATH must be an existing local .gguf file for the llama.cpp backend')

    expected = env.get('MODEL_SHA256', '').strip().lower()
    if expected:
        if not re.fullmatch(r'[0-9a-f]{64}', expected):
            raise ValueError('MODEL_SHA256 must be a full 64-hex sha256 digest')
        if _hash_file(model_path) != expected:
            raise ValueError('MODEL_PATH does not match MODEL_SHA256; refusing to serve an unverified model')
    elif env.get('ALLOW_UNPINNED_MODEL') != '1':
        raise ValueError('Set MODEL_SHA256 to pin the model, or ALLOW_UNPINNED_MODEL=1 to accept an unpinned file')

    executable = env.get('LLAMACPP_EXECUTABLE', '')
    if not Path(executable).is_file() or not os.access(executable, os.X_OK):
        raise ValueError('LLAMACPP_EXECUTABLE must be an installed absolute executable')

    length = int(env.get('MAX_MODEL_LEN', '8192'))
    if not 512 <= length <= 32768:
        raise ValueError('Check context length (512..32768)')
    layers = int(env.get('GPU_LAYERS', '99'))
    if not 0 <= layers <= 999:
        raise ValueError('GPU_LAYERS must be 0..999')
    parallel = int(env.get('BACKEND_PARALLEL', '2'))
    if not 1 <= parallel <= 8:
        raise ValueError('BACKEND_PARALLEL must be 1..8')

    args = [executable,
            '--host', '127.0.0.1', '--port', env['BACKEND_PORT'],
            '--model', str(model_path),
            '--alias', env['SERVED_MODEL_NAME'],
            '--ctx-size', str(length),
            '--parallel', str(parallel),
            '--n-gpu-layers', str(layers),
            # Read from a 0600 file rather than argv: a key passed as a flag is
            # visible to any user who can read /proc or run ps.
            '--api-key-file', env['BACKEND_API_KEY_FILE']]

    # Optional global grammar for other callers. Leave unset for BrainSNN's
    # per-request response_format=json_object; the two grammars conflict.
    schema_file = env.get('INFERENCE_JSON_SCHEMA_FILE', '').strip()
    if schema_file:
        schema_path = Path(schema_file)
        if not schema_path.is_file():
            raise ValueError('INFERENCE_JSON_SCHEMA_FILE is set but does not exist')
        args += ['--json-schema', schema_path.read_text(encoding='utf-8')]

    # Intentionally never accept arbitrary additional CLI flags.
    return args


if __name__ == '__main__':
    try:
        # The runtime hands the key through the environment. llama-server has no
        # environment option for it, so write it to a private file the child
        # reads, keeping it out of the process argument list.
        key = os.environ.pop('BACKEND_API_KEY')
        key_file = Path(os.environ.get('BACKEND_API_KEY_FILE')
                        or Path(__file__).resolve().parent / 'state' / 'backend-api-key')
        key_file.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(key_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
            handle.write(key + '\n')
        os.environ['BACKEND_API_KEY_FILE'] = str(key_file)
        args = command(os.environ)
    except (ValueError, KeyError) as error:
        sys.exit(str(error))
    os.execv(args[0], args)
