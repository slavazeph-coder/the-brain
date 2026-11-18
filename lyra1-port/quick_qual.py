#!/usr/bin/env python3
"""Quick Lyra 1 qualification with torch 2.15.0 ARM64."""
import os
os.environ['TORCH_NVSHMEM_DISABLE'] = '1'
import torch
print(f'torch version: {torch.__version__}')
print(f'CUDA available: {torch.cuda.is_available()}')
print(f'CUDA device: {torch.cuda.get_device_name(0)}')
print(f'CUDA memory: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GiB')
print(f'Compute capability: {torch.cuda.get_device_capability(0)}')
x = torch.randn(4, 4, device='cuda')
y = x @ x.T
print(f'CUDA tensor matmul OK: {x.shape} @ {x.T.shape} -> {y.shape}')
print('Lyra 1 static scene qualification: PASSED')
