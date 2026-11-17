#!/bin/bash
cd /workspace/hermes-gb10/repos/the-brain
export LD_LIBRARY_PATH=lyra1-port/venv/lib/python3.14/site-packages/torch-2.15.0/torch/lib:$LD_LIBRARY_PATH
python3 -c "
import sys
sys.path.insert(0, 'lyra1-port/venv/lib/python3.14/site-packages/torch-2.15.0')
import torch
print(f'torch version: {torch.__version__}')
print(f'CUDA available: {torch.cuda.is_available()}')
print(f'CUDA device count: {torch.cuda.device_count()}')
if torch.cuda.is_available():
    print(f'CUDA device: {torch.cuda.get_device_name(0)}')
    print(f'CUDA memory: {torch.cuda.get_device_properties(0).total_mem / 1024**3:.1f} GiB')
print(f'Compute capability: {torch.cuda.get_device_capability(0)}')
import os
lyra_static = '/workspace/hermes-gb10/repos/the-brain/lyra1-port/lyra_static.pt'
if os.path.exists(lyra_static):
    size = os.path.getsize(lyra_static)
    print(f'lyra_static.pt: {size} bytes ({size/1024/1024:.1f} MB)')
else:
    print(f'lyra_static.pt not found')
"
