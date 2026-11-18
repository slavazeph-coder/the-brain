#!/usr/bin/env python3
"""Test torch import with TORCH_NVSHMEM_DISABLE."""
import os
os.environ['TORCH_NVSHMEM_DISABLE'] = '1'
import torch
print(f"torch version: {torch.__version__}")
print(f"CUDA: {torch.cuda.is_available()}")
x = torch.randn(4, 4, device='cuda')
y = x @ x.T
print(f"CUDA matmul OK: {x.shape} @ {x.T.shape} -> {y.shape}")
