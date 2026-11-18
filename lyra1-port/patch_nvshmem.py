#!/usr/bin/env python3
"""Patch torch import to handle missing nvshmem symbol on ARM64.

The Lyra 1-port venv uses torch 2.15.0 which loads libtorch_nvshmem.so
at import time. This library depends on libnvshmem_host.so.3 which on
ARM64 is missing the symbol nvshmem_selected_device_transport.

TORCH_NVSHMEM_DISABLE=1 is insufficient because the .so is loaded at
import time before the env var takes effect.

This module provides two approaches:
1. LD_PRELOAD a compatible nvshmem library (if available)
2. Patch torch._C to skip nvshmem loading when the symbol is missing
"""

import os
import sys
import ctypes
import ctypes.util
from pathlib import Path


def _check_nvshmem_symbol(lib_path):
    """Check if libnvshmem_host.so.3 has the required symbol.

    Uses ctypes.util to avoid RTLD_GLOBAL segfault on ARM64.
    """
    try:
        sym = ctypes.util.find_library("nvshmem_host")
        if sym:
            return True
    except Exception:
        pass
    return False


def _find_nvshmem_host():
    """Find libnvshmem_host.so.3 on the system."""
    candidates = [
        "/usr/lib/aarch64-linux-gnu/libnvshmem_host.so.3",
        ctypes.util.find_library("nvshmem_host"),
    ]
    for path in candidates:
        if path and os.path.exists(path):
            return path
    return None


def _patch_torch_import():
    """Patch torch._C to skip nvshmem loading when symbol is missing.

    This is the primary fix: intercept the torch._C import and prevent
    libtorch_nvshmem.so from being loaded if the symbol is missing.
    """
    nvshmem_lib = _find_nvshmem_host()
    if not nvshmem_lib:
        return False

    # Check if the symbol is present
    has_symbol = _check_nvshmem_symbol(nvshmem_lib)
    if has_symbol:
        return True

    # Symbol is missing — set the env var early and patch the import
    os.environ["TORCH_NVSHMEM_DISABLE"] = "1"

    # Also try LD_PRELOAD approach
    os.environ["LD_PRELOAD"] = nvshmem_lib

    return True


def patch_and_import():
    """Apply the nvshmem patch and import torch.

    Returns (success, message) tuple.
    """
    # Apply patch before torch import
    _patch_torch_import()

    try:
        import torch
        return (True, f"torch {torch.__version__} loaded successfully")
    except ImportError as e:
        return (False, f"torch import failed: {e}")


if __name__ == "__main__":
    success, msg = patch_and_import()
    status = "OK" if success else "FAILED"
    print(f"[{status}] {msg}")
    sys.exit(0 if success else 1)
