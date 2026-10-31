# brainsnn.com's own World Builder worker on Railway: CPU reconstruction (COLMAP) and the scene engine (Blender as a
# Python module), reached only by the site's server over Railway's private network. Build context: the repository root.
# Setup: robotics/world_worker/deploy/railway/README.md.
# Blender 4.2's bpy module is built for Python 3.11 only; Ubuntu 24.04 ships 3.12, so 3.11 comes from the official image.
FROM python:3.11-slim-bookworm AS python311
FROM ubuntu:24.04

# FFmpeg samples the walkthrough's frames; Python 3.12 runs the worker, COLMAP and the CAD exports (their pinned numpy
# needs it); bpy needs these X/GL libraries even headless.
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates ffmpeg python3.12 python3.12-venv \
      libgl1 libegl1 libx11-6 libxrender1 libxxf86vm1 libxfixes3 libxi6 libxkbcommon0 libsm6 libice6 libgomp1 \
      libssl3t64 libffi8 libsqlite3-0 libexpat1 libbz2-1.0 liblzma5 zlib1g \
    && rm -rf /var/lib/apt/lists/*
COPY --from=python311 /usr/local/bin/python3.11 /usr/local/bin/python3.11
COPY --from=python311 /usr/local/lib/libpython3.11.so.1.0 /usr/local/lib/
COPY --from=python311 /usr/local/lib/python3.11 /usr/local/lib/python3.11
RUN ldconfig && python3.11 -c 'import ssl, sqlite3, ctypes, lzma, bz2'

WORKDIR /app
COPY robotics/world_worker/requirements.txt robotics/world_worker/requirements-colmap.txt \
     robotics/world_worker/requirements-dense.txt robotics/world_worker/requirements-cad.txt robotics/world_worker/
# The worker, COLMAP (with ONNX Runtime for the scale model) and the CAD exports on Python 3.12 (their pinned numpy needs it).
RUN python3.12 -m venv /opt/worker && /opt/worker/bin/pip install --no-cache-dir \
      -r robotics/world_worker/requirements.txt -r robotics/world_worker/requirements-dense.txt \
      -r robotics/world_worker/requirements-cad.txt usd-core==25.8
# MoGe-2 ViT-B (MIT) for the estimated metric scale of each reconstruction (about 420 MB): the revision and hash pinned in
# metric_scale.py MODEL, checked here and again by the adapter before every use. Nothing is downloaded at run time.
RUN mkdir -p /opt/brainsnn-models && /opt/worker/bin/python -c "import hashlib, urllib.request; \
path = '/opt/brainsnn-models/moge-2-vitb-normal.onnx'; \
urllib.request.urlretrieve('https://huggingface.co/Ruicheng/moge-2-vitb-normal-onnx/resolve/2d247a122ada42ce700fe59273cd62e076da1f32/model.onnx', path); \
digest = hashlib.sha256(open(path, 'rb').read()).hexdigest(); \
assert digest == 'bbf14e07a30f11e69d36ab861590123f5598ababcbc8946a063eb4a966f35a21', digest"
# Blender 4.2 as a Python module, which the scene engine runs as its `blender` (about 400 MB).
RUN python3.11 -m venv /opt/bpy && /opt/bpy/bin/pip install --no-cache-dir bpy==4.2.23

# The bounded NVIDIA package is pinned, hash-checked, and outside the /data volume.
COPY robotics/world_worker/nvidia_pack.py /tmp/nvidia_pack.py
RUN /opt/worker/bin/python /tmp/nvidia_pack.py --workspace /opt/brainsnn-simready
COPY robotics /app/robotics
RUN chmod 755 robotics/world_worker/deploy/railway/start.sh robotics/world_worker/deploy/railway/blender

# Uploads and job outputs live on the Railway volume mounted at /data; jobs are deleted after 24 hours.
ENV WORLD_WORKER_DIR=/data/worker PYTHONUNBUFFERED=1
CMD ["/app/robotics/world_worker/deploy/railway/start.sh"]
