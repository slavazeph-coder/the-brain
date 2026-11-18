#!/usr/bin/env python3
"""Deep inspect lyra_static.pt structure."""
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
    mod = sd.get('module', sd)
    print(f'module type: {type(mod).__name__}')
    if isinstance(mod, dict):
        keys = list(mod.keys())
        print(f'module keys ({len(keys)}): {keys[:30]}')
        t2d = [(k, v.shape) for k, v in mod.items() if hasattr(v, 'shape') and v.ndim == 2]
        print(f'2D tensors: {len(t2d)}')
        for k, s in t2d[:10]:
            print(f'  {k}: {s}')
        t34 = [(k, v.shape) for k, v in mod.items() if hasattr(v, 'shape') and v.ndim >= 3]
        print(f'3D+ tensors: {len(t34)}')
        for k, s in t34[:10]:
            print(f'  {k}: {s}')
        # Count total params
        total = sum(v.numel() for k, v in mod.items() if hasattr(v, 'numel'))
        print(f'Total params: {total:,}')
    else:
        print(f'module is not dict: {mod}')
else:
    print(f'sd shape: {sd.shape if hasattr(sd, "shape") else "N/A"}')
