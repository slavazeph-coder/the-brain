#!/bin/sh
export TORCH_NVSHMEM_DISABLE=1
exec /workspace/hermes-gb10/repos/the-brain/lyra1-port/venv/bin/python "$@"
