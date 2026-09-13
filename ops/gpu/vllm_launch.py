#!/usr/bin/env python3
"""Validated, localhost-only vLLM launch; called with runtime's filtered environment."""
import hashlib
import json
import os
from pathlib import Path
import re
import sys


def verify_file(path, digest, label):
    path = Path(path)
    if not path.is_absolute() or not path.is_file() or not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest):
        raise ValueError(f'{label} requires an absolute file and full SHA256')
    actual = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            actual.update(chunk)
    if actual.hexdigest() != digest:
        raise ValueError(f'{label} failed SHA256 verification')
    return path


def verify_snapshot(model, revision, manifest_path):
    """Verify a parent-prepared file manifest before loading a local model snapshot."""
    manifest = Path(manifest_path)
    if not manifest.is_absolute() or not manifest.is_file() or manifest.stat().st_size > 1024 * 1024:
        raise ValueError('MODEL_MANIFEST must be an absolute JSON file under 1 MiB')
    value = json.loads(manifest.read_text())
    if not isinstance(value, dict) or value.get('revision') != revision or not isinstance(value.get('files'), list):
        raise ValueError('MODEL_MANIFEST must match MODEL_REVISION and contain files')
    seen = set()
    for record in value['files']:
        if not isinstance(record, dict) or not isinstance(record.get('path'), str):
            raise ValueError('Invalid model manifest record')
        relative = Path(record['path'])
        if not relative.parts or relative.is_absolute() or '..' in relative.parts or str(relative) in seen:
            raise ValueError('Unsafe or duplicate model manifest path')
        seen.add(str(relative))
        verify_file(model / relative, record.get('sha256', ''), 'Model file')
    # Ensure every loadable file is verified; an unlisted config/shard must not
    # silently change the model under a stable evaluation revision.
    required = {str(path.relative_to(model)) for path in model.rglob('*') if path.is_file()
                and path.suffix in ('.safetensors', '.json', '.jinja', '.model', '.txt', '.bin', '.py')}
    if not required or 'config.json' not in seen or not any(name.endswith('.safetensors') for name in seen) \
            or not required.issubset(seen):
        raise ValueError('MODEL_MANIFEST omits model, tokenizer or configuration files')


def command(env):
    model = env.get('MODEL_PATH', '').strip()
    if not model:
        raise ValueError('Choose MODEL_PATH before enabling inference')
    revision = env.get('MODEL_REVISION', '')
    local = Path(model).is_dir()
    if not local and (env.get('ALLOW_MODEL_DOWNLOAD') != '1' or not re.fullmatch(r'[0-9a-f]{40}', revision)):
        raise ValueError('Remote model requires explicit download enablement and a full commit MODEL_REVISION')
    if local:
        if not Path(model).is_absolute() or not re.fullmatch(r'[0-9a-f]{40}', revision):
            raise ValueError('Local model requires an absolute snapshot path and full commit MODEL_REVISION')
        if env.get('MODEL_MANIFEST'):
            verify_snapshot(Path(model), revision, env['MODEL_MANIFEST'])
    executable = env.get('VLLM_EXECUTABLE', '')
    if not Path(executable).is_absolute() or not Path(executable).is_file() or not os.access(executable, os.X_OK):
        raise ValueError('VLLM_EXECUTABLE must be an installed absolute executable')
    memory = float(env.get('GPU_MEMORY_UTILIZATION', '0.6'))
    length = int(env.get('MAX_MODEL_LEN', '8192'))
    if not 0.1 <= memory <= 0.9 or not 512 <= length <= 32768:
        raise ValueError('Check memory utilization (0.1..0.9) and context length (512..32768)')
    dtype = env.get('VLLM_DTYPE', 'bfloat16')
    sequences = int(env.get('VLLM_MAX_NUM_SEQS', '1'))
    batched = int(env.get('VLLM_MAX_BATCHED_TOKENS') or length)
    if dtype not in ('bfloat16', 'float16') or not 1 <= sequences <= 2 or not length <= batched <= 32768:
        raise ValueError('Use bfloat16/float16, 1..2 sequences and context-length..32768 batched tokens')
    args = [executable, 'serve', model, '--host', '127.0.0.1', '--port', env['BACKEND_PORT'],
            '--served-model-name', env['SERVED_MODEL_NAME'], '--max-model-len', str(length),
            '--gpu-memory-utilization', str(memory), '--max-num-seqs', str(sequences),
            '--max-num-batched-tokens', str(batched), '--dtype', dtype,
            '--enforce-eager', '--disable-custom-all-reduce', '--generation-config', 'vllm',
            '--disable-log-requests']
    if not local:
        args += ['--revision', revision]
    if env.get('CHAT_TEMPLATE_PATH'):
        template = verify_file(env['CHAT_TEMPLATE_PATH'], env.get('CHAT_TEMPLATE_SHA256', ''), 'Chat template')
        if template.stat().st_size > 1024 * 1024:
            raise ValueError('Chat template exceeds 1 MiB')
        args += ['--chat-template', str(template)]
    # Intentionally never enable trust_remote_code or arbitrary additional CLI flags.
    return args


def execution_environment(env):
    result = dict(env)
    result['VLLM_API_KEY'] = result.pop('BACKEND_API_KEY')
    # Initial rollout targets the tested older driver path: no V1 compilation,
    # CUDA graphs or unreviewed selection inherited from a shell environment.
    result['VLLM_USE_V1'] = '0'
    result['VLLM_ATTENTION_BACKEND'] = 'FLASH_ATTN'
    result['VLLM_NO_USAGE_STATS'] = '1'
    result['DO_NOT_TRACK'] = '1'
    if 'VLLM_LD_LIBRARY_PATH' in result:
        value = result.pop('VLLM_LD_LIBRARY_PATH')
        for entry in value.split(':') if value else []:
            path = Path(entry)
            if not path.is_absolute() or not path.is_dir() or 'stubs' in path.parts:
                raise ValueError('VLLM_LD_LIBRARY_PATH requires existing absolute non-stub library directories')
        if value:
            result['LD_LIBRARY_PATH'] = value
        else:
            result.pop('LD_LIBRARY_PATH', None)
    return result


if __name__ == '__main__':
    try:
        args = command(os.environ)
        environment = execution_environment(os.environ)
    except (ValueError, KeyError, OSError) as error:
        sys.exit(str(error))
    os.execve(args[0], args, environment)
