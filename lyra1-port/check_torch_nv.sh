#!/bin/bash
# Lyra port NVSHMEM fix: libnvshmem_host.so.3 on ARM64 is missing
# nvshmem_selected_device_transport symbol (known NVSHMEM compatibility issue).
# Workaround: set TORCH_NVSHMEM_DISABLE=1 and use LD_PRELOAD with the NVIDIA
# nvshmem lib that has the symbol, or fall back to system torch (2.13.0).
#
# Root cause: torch 2.15.0 ARM64 expects nvshmem_selected_device_transport@NVSHMEM
# but the system libnvshmem_host.so.3 (from nvidia/nvshmem package) doesn't export it.
#
# Options:
# 1. TORCH_NVSHMEM_DISABLE=1 + LD_PRELOAD (preferred for Lyra inference)
# 2. Use system torch 2.13.0 (no NVSHMEM dependency)
# 3. Patch libnvshmem_host.so.3 to add the missing symbol

cd /workspace/hermes-gb10/repos/the-brain

# Set NVSHMEM disable and preload the NVIDIA nvshmem lib
export TORCH_NVSHMEM_DISABLE=1
export LD_LIBRARY_PATH=lyra1-port/venv/lib/python3.14/site-packages/torch-2.15.0/torch/lib:${LD_LIBRARY_PATH}

# Check for the missing symbol
SYMBOL_CHECK=$(objdump -T lyra1-port/venv/lib/python3.14/site-packages/torch-2.15.0/torch/lib/libtorch_nvshmem.so 2>/dev/null | grep 'nvshmem_selected_device_transport' || true)
if echo "$SYMBOL_CHECK" | grep -q '\*UND\*'; then
    echo "WARNING: nvshmem_selected_device_transport is UNDEFINED in libtorch_nvshmem.so"
    echo "Using TORCH_NVSHMEM_DISABLE=1 workaround"
fi

# Run the torch check
lyra1-port/venv/bin/python3 -c "
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
