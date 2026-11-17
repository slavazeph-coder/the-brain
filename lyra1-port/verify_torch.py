#!/usr/bin/env python3
"""Verify torch 2.15.0 import in lyra1-port venv."""
import sys
import os

# Ensure the lyra1-port venv site-packages is first
sys.path.insert(0, '/workspace/hermes-gb10/repos/the-brain/lyra1-port/venv/lib/python3.14/site-packages/torch-2.15.0')
sys.path.insert(0, '/workspace/hermes-gb10/repos/the-brain/lyra1-port/venv/lib/python3.14/site-packages')

import torch
print(f"torch version: {torch.__version__}")
print(f"CUDA available: {torch.cuda.is_available()}")
print(f"CUDA device count: {torch.cuda.device_count()}")
if torch.cuda.is_available():
    print(f"CUDA device: {torch.cuda.get_device_name(0)}")
    print(f"CUDA memory: {torch.cuda.get_device_properties(0).total_mem / 1024**3:.1f} GiB")

# Check compute capability
print(f"Compute capability: {torch.cuda.get_device_capability(0)}")

# Verify the static Lyra model path
import os
lyra_static = '/workspace/hermes-gb10/repos/the-brain/lyra1-port/lyra_static.pt'
if os.path.exists(lyra_static):
    size = os.path.getsize(lyra_static)
    print(f"lyra_static.pt: {size} bytes ({size/1024/1024:.1f} MB)")
else:
    print(f"lyra_static.pt not found at {lyra_static}")

# Check for the GEN3C static path module
gen3c_path = '/workspace/hermes-gb10/repos/the-brain/lyra1-port/venv/lib/python3.14/site-packages/torch-2.15.0/torch'
print(f"Torch dir: {gen3c_path}")
print(f"Torch _C.so exists: {os.path.exists(os.path.join(gen3c_path, '_C.cpython-314-aarch64-linux-gnu.so'))}")
