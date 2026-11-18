#!/usr/bin/env python3
"""Test the exact fix: set TORCH_NVSHMEM_DISABLE at module level."""
import os
os.environ['TORCH_NVSHMEM_DISABLE'] = '1'

import torch
print(f'torch {torch.__version__} OK')
print(f'CUDA: {torch.cuda.is_available()}')
