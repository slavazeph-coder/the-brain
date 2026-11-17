#!/usr/bin/env python3
"""Test TORCH_NVSHMEM_DISABLE and LD_PRELOAD workarounds."""
import os
import sys
import subprocess

# Test 1: TORCH_NVSHMEM_DISABLE only
os.environ['TORCH_NVSHMEM_DISABLE'] = '1'
try:
    import torch
    print(f"Test 1 (TORCH_NVSHMEM_DISABLE=1): torch {torch.__version__} OK")
except ImportError as e:
    print(f"Test 1 (TORCH_NVSHMEM_DISABLE=1): FAILED - {e}")

# Test 2: Check if we can patch the .so with a stub
result = subprocess.run(
    ['objdump', '-T', 
     'lyra1-port/venv/lib/python3.14/site-packages/torch-2.15.0/torch/lib/libtorch_nvshmem.so'],
    capture_output=True, text=True
)
has_undef = False
for line in result.stdout.splitlines():
    if 'nvshmem_selected_device_transport' in line and '*UND*' in line:
        has_undef = True
        break

if has_undef:
    print("Test 2: nvshmem_selected_device_transport is UNDEFINED (confirmed)")
else:
    print("Test 2: nvshmem_selected_device_transport is DEFINED")

# Test 3: Check the NVSHMEM library version
result = subprocess.run(
    ['readelf', '-V', 
     '/usr/lib/aarch64-linux-gnu/libnvshmem_host.so.3'],
    capture_output=True, text=True
)
nvshmem_lines = [l for l in result.stdout.splitlines() if 'NVSHMEM' in l]
print(f"Test 3: NVSHMEM version info: {len(nvshmem_lines)} version entries")

# Test 4: Check if the symbol exists in the NVSHMEM lib
result = subprocess.run(
    ['nm', '-D', '/usr/lib/aarch64-linux-gnu/libnvshmem_host.so.3'],
    capture_output=True, text=True
)
has_symbol = False
for line in result.stdout.splitlines():
    if 'nvshmem_selected_device_transport' in line:
        has_symbol = True
        break
if has_symbol:
    print("Test 4: Symbol found in libnvshmem_host.so.3")
else:
    print("Test 4: Symbol MISSING in libnvshmem_host.so.3 (root cause)")
