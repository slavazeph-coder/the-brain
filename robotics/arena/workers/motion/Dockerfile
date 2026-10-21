# GPU motion worker (e.g. the RTX 4090): the upstream vLLM serving image plus BrainSNN's authenticated entry point.
# Build from robotics/arena:   docker build -f workers/motion/Dockerfile -t brainsnn-motion-worker .
# Run (key required beyond loopback; see docs/motion-worker.md for the TLS front and memory share):
#   docker run --gpus all --ipc=host -p 127.0.0.1:8000:8000 --env-file /etc/brainsnn/motion.env \
#     -v brainsnn-motion-cache:/root/.cache brainsnn-motion-worker
# An older NVIDIA driver can build on the CUDA 12.9 variant: --build-arg VLLM_TAG=v0.30.0-cu129
ARG VLLM_TAG=v0.30.0
FROM vllm/vllm-openai:${VLLM_TAG}
ENV PYTHONUNBUFFERED=1 \
    MOTION_GENERATOR_REVISION=96497d69a31cc89da209f224bd9c1fee1834b864
# The base image has vLLM, PyTorch and CUDA; add only what it lacks, as upstream does, so none of its pins move.
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir scipy reachy-mini-rust-kinematics==1.0.3 \
    && pip install --no-cache-dir --no-deps \
       "git+https://github.com/pham-tuan-binh/reachy-motion-generator@${MOTION_GENERATOR_REVISION}"
WORKDIR /opt/brainsnn
COPY workers/motion workers/motion
EXPOSE 8000
ENTRYPOINT ["python3", "-m", "workers.motion.app", "--host", "0.0.0.0", "--port", "8000"]
CMD ["--bundle", "medium=binhpham/reachy-mini-motion-planner-4b@1b60d8f16b85473ceb20e3b62e464780c532b519"]
