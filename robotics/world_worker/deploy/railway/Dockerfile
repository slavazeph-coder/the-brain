# Private BrainSNN CPU worker and bounded NVIDIA Omniverse starter package.
FROM python:3.11-slim-bookworm AS python311
FROM ubuntu:24.04
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
RUN python3.12 -m venv /opt/worker && /opt/worker/bin/pip install --no-cache-dir \
      -r robotics/world_worker/requirements.txt -r robotics/world_worker/requirements-colmap.txt \
      -r robotics/world_worker/requirements-cad.txt usd-core==25.8
RUN python3.11 -m venv /opt/bpy && /opt/bpy/bin/pip install --no-cache-dir bpy==4.2.23
# Asset layer is pinned, hash-checked, and outside the /data volume.
COPY robotics/world_worker/nvidia_pack.py /tmp/nvidia_pack.py
RUN /opt/worker/bin/python /tmp/nvidia_pack.py --workspace /opt/brainsnn-simready
COPY robotics /app/robotics
RUN chmod 755 robotics/world_worker/deploy/railway/start.sh robotics/world_worker/deploy/railway/blender
ENV WORLD_WORKER_DIR=/data/worker PYTHONUNBUFFERED=1
CMD ["/app/robotics/world_worker/deploy/railway/start.sh"]
