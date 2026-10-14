# Build from robotics/arena / downloaded kit root:
# docker build -f workers/arena/Dockerfile -t brainsnn-libero-worker .
# This is the physics/client container. The model server has its own OpenPI env.
FROM python:3.10.16-slim-bookworm
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 MUJOCO_GL=egl PYOPENGL_PLATFORM=egl \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility,graphics \
    LIBERO_CONFIG_PATH=/opt/libero-config \
    ARENA_LIBERO_REVISION=8f1084e3132a39270c3a13ebe37270a43ece2a01 \
    ARENA_OPENPI_REVISION=215abfb217dbac7d5f1273282331b9b1866c0479
RUN apt-get update && apt-get install -y --no-install-recommends \
    git build-essential libegl1 libgl1 libosmesa6 libglib2.0-0 libxrender1 libsm6 libxext6 libglfw3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/brainsnn
COPY workers/arena/requirements*.txt workers/arena/
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch==2.2.2 \
    && pip install -r workers/arena/requirements-simulation.txt
RUN git clone https://github.com/Lifelong-Robot-Learning/LIBERO.git /opt/LIBERO \
    && git -C /opt/LIBERO checkout "$ARENA_LIBERO_REVISION" \
    && pip install --no-deps -e /opt/LIBERO \
    && git clone https://github.com/Physical-Intelligence/openpi.git /opt/openpi \
    && git -C /opt/openpi checkout "$ARENA_OPENPI_REVISION" \
    && pip install --no-deps /opt/openpi/packages/openpi-client
RUN mkdir -p /opt/libero-config /opt/LIBERO/libero/datasets \
    && python -c "import yaml; from pathlib import Path; root='/opt/LIBERO/libero/libero'; Path('/opt/libero-config/config.yaml').write_text(yaml.safe_dump({'benchmark_root':root,'bddl_files':root+'/bddl_files','init_states':root+'/init_files','assets':root+'/assets','datasets':'/opt/LIBERO/libero/datasets'}))"
COPY workers/arena workers/arena
RUN useradd --create-home --uid 10001 arena \
    && chown -R arena:arena /opt/brainsnn /opt/libero-config /opt/LIBERO
USER arena
EXPOSE 8081
# The documented Linux host-network deployment exposes only loopback to its TLS proxy.
CMD ["uvicorn", "workers.arena.app:create_app", "--factory", "--host", "127.0.0.1", "--port", "8081", "--workers", "1"]
