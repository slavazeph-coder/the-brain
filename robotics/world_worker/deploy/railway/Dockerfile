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
     robotics/world_worker/requirements-cad.txt robotics/world_worker/
# The worker, COLMAP and the CAD exports on Python 3.12 (their pinned numpy needs it).
RUN python3.12 -m venv /opt/worker && /opt/worker/bin/pip install --no-cache-dir \
      -r robotics/world_worker/requirements.txt -r robotics/world_worker/requirements-colmap.txt \
      -r robotics/world_worker/requirements-cad.txt
# Blender 4.2 as a Python module, which the scene engine runs as its `blender` (about 400 MB).
RUN python3.11 -m venv /opt/bpy && /opt/bpy/bin/pip install --no-cache-dir bpy==4.2.23

COPY robotics /app/robotics
RUN chmod 755 robotics/world_worker/deploy/railway/start.sh robotics/world_worker/deploy/railway/blender

# Uploads and job outputs live on the Railway volume mounted at /data; jobs are deleted after 24 hours.
ENV WORLD_WORKER_DIR=/data/worker PYTHONUNBUFFERED=1
CMD ["/app/robotics/world_worker/deploy/railway/start.sh"]
