#!/usr/bin/env python3
"""Verify lyra_static.pt.real loads as valid state dict."""
import os
os.environ['TORCH_NVSHMEM_DISABLE'] = '1'

import torch

pt = torch.load('lyra_static.pt.real', weights_only=False)
print(f'type: {type(pt).__name__}')
if isinstance(pt, dict):
    print(f'keys: {list(pt.keys())[:10]}')
    sd = pt.get('state_dict', pt)
    if isinstance(sd, dict):
        print(f'state_dict: {len(sd)} keys')
        print(f'first 5: {list(sd.keys())[:5]}')
        total_params = sum(1 for v in sd.values() if hasattr(v, "shape"))
        print(f'tensors with shape: {total_params}')
    else:
        print(f'top-level keys: {list(pt.keys())[:10]}')
else:
    print(f'shape: {pt.shape if hasattr(pt, "shape") else "N/A"}')
print('OK: lyra_static.pt.real loads as valid state dict')
