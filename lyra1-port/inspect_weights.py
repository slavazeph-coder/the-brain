#!/usr/bin/env python3
"""Inspect lyra_static.pt structure."""
import os
import sys

os.environ['TORCH_NVSHMEM_DISABLE'] = '1'

import torch

pt = torch.load('lyra_static.pt', weights_only=False)
print(f'Type: {type(pt).__name__}')
print(f'Keys: {list(pt.keys())[:20]}')

sd = pt.get('state_dict', pt)
print(f'state_dict type: {type(sd).__name__}')

if isinstance(sd, dict):
    print(f'sd keys: {list(sd.keys())[:20]}')
    for k, v in sd.items():
        print(f'  {k}: type={type(v).__name__}, shape={v.shape if hasattr(v, "shape") else "N/A"}, dtype={v.dtype if hasattr(v, "dtype") else "N/A"}')
        if hasattr(v, 'shape'):
            print(f'    ndim={v.ndim}, numel={v.numel()}')
else:
    print(f'sd shape: {sd.shape if hasattr(sd, "shape") else "N/A"}')
    print(f'sd dtype: {sd.dtype if hasattr(sd, "dtype") else "N/A"}')
    print(f'sd numel: {sd.numel() if hasattr(sd, "numel") else "N/A"}')
