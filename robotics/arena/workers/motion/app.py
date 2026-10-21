"""BrainSNN Reachy Mini motion worker: Binh Pham's reachy-motion-generator API behind a bearer key.

The planner (fine-tuned Qwen) writes a motion recipe; the flow-matching generator turns it into
reachable 25 Hz Reachy Mini moves. Requests and responses are the upstream ``/generate-dense`` contract.

  # GPU (vLLM, the upstream engine unchanged), e.g. the RTX 4090
  MOTION_WORKER_KEY=... python -m workers.motion.app --host 0.0.0.0 \
      --bundle medium=binhpham/reachy-mini-motion-planner-4b@1b60d8f16b85473ceb20e3b62e464780c532b519
  # CPU (plain transformers, tens of seconds per request): local development and qualification
  python -m workers.motion.app --device cpu \
      --bundle low=binhpham/reachy-mini-motion-planner-0.8b@3561b10c2483c30307a2a2c4ab7d4a213206706d

The key is required unless the worker listens on loopback only. Nothing is stored.
"""
import argparse
import hmac
import ipaddress
import json
import os
import threading
import time

LOOPBACK = {"localhost"}
MAX_BODY = 16 * 1024


def is_loopback(host):
    if host in LOOPBACK:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def resolve_bundle(bundle):
    """A local directory, or a Hugging Face repo id with an optional ``@revision`` pin (downloaded once)."""
    if os.path.isdir(bundle):
        return bundle
    from huggingface_hub import snapshot_download
    repo, _, revision = bundle.partition("@")
    return snapshot_download(repo, revision=revision or None)


def parse_bundles(values):
    """``[effort=]bundle`` -> [(effort, bundle)]; the upstream server's own convention."""
    specs = []
    for value in values:
        effort, bundle = value.split("=", 1) if "=" in value.split("/")[0] else ("high", value)
        if effort not in ("high", "medium", "low") or not bundle:
            raise SystemExit(f"invalid --bundle {value!r}: expected [high|medium|low=]<repo id or directory>")
        specs.append((effort, bundle))
    if len({effort for effort, _ in specs}) != len(specs):
        raise SystemExit("each effort can be loaded once")
    return specs


class AuthMiddleware:
    """Constant-time bearer check and a body cap before anything reaches the engine."""
    def __init__(self, app, key):
        self.app, self.expected = app, ("Bearer " + key).encode() if key else None

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers") or [])
        supplied = headers.get(b"authorization", b"")
        if self.expected is not None and not hmac.compare_digest(supplied, self.expected):
            return await self._reply(send, 401, {"detail": "unauthorized"})
        # Read the whole (bounded) body first, chunked or not, then replay it to the app.
        messages, total = [], 0
        while True:
            message = await receive()
            messages.append(message)
            if message["type"] != "http.request":
                break
            total += len(message.get("body", b""))
            if total > MAX_BODY:
                return await self._reply(send, 413, {"detail": "request too large"})
            if not message.get("more_body", False):
                break

        async def replay():
            return messages.pop(0) if messages else await receive()
        await self.app(scope, replay, send)

    @staticmethod
    async def _reply(send, status, body):
        payload = json.dumps(body).encode()
        await send({"type": "http.response.start", "status": status,
                    "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(payload)).encode())]})
        await send({"type": "http.response.body", "body": payload})


def cpu_engine(planners, generator, steps=8, cfg=1.5, expand_fc=2.0, expand_kdt=0.25, **_):
    """The upstream MotionEngine without CUDA graphs or device synchronisation; same planner, generator and reachability."""
    import torch
    from common.motion import FPS, to_move
    from common.reach import Reach
    from generator.sample import generate_batch, load
    from inference.engine import MotionEngine, _round

    class CpuMotionEngine(MotionEngine):
        def __init__(self):
            self.planners = planners
            self.default = "high" if "high" in planners else next(iter(planners))
            self.steps, self.cfg, self.fc, self.kdt = steps, cfg, expand_fc, expand_kdt
            self.lock = threading.Lock()
            self.net, self.stats, self.dev = load(generator, "cpu")
            self.reach = Reach()

        def dense(self, prompt, n=1, seed=0, effort=None, retries=2, batched_retries=False):
            with self.lock:
                effort, idea, rec, plans, planner_ms = self._plan(prompt, n, seed, effort, retries, batched_retries)
                t1 = time.perf_counter()
                with torch.no_grad():
                    trajs = generate_batch(self.net, self.stats, plans, self.dev, seeds=[seed * 1000 + i for i in range(n)],
                                           steps=self.steps, cfg=self.cfg)
                t2 = time.perf_counter()
                moves = [_round(self.reach.project(to_move(A, prompt))[0]) for A in trajs]
                t3 = time.perf_counter()
            gen_ms, reach_ms = round((t2 - t1) * 1e3), round((t3 - t2) * 1e3)
            return dict(prompt=prompt, effort=effort, idea=idea, recipe=rec, moves=moves,
                        durations_s=[round(len(A) / FPS, 2) for A in trajs],
                        timing_ms=dict(planner=planner_ms, generator=gen_ms, reachability=reach_ms,
                                       total=planner_ms + gen_ms + reach_ms))

    return CpuMotionEngine()


def build(specs, device, fp32=False, gpu_memory_utilization=None):
    """Load every planner once and the shared generator; returns the upstream FastAPI app with our engine."""
    from inference import server as upstream
    from inference.engine import MotionEngine, Planner

    planners, gen_cfg, generator = {}, None, None
    for effort, bundle in specs:
        root = resolve_bundle(bundle)
        with open(os.path.join(root, "serve.json")) as fh:
            cfg = json.load(fh)
        if device == "cpu":
            planner = Planner(os.path.join(root, "planner"), backend="hf", **cfg)
            # bf16 matmuls are slow on most CPUs; float32 trades memory (~4 bytes/parameter) for speed.
            if fp32:
                planner.llm = planner.llm.float()
        else:
            # vLLM reserves this fraction of the GPU up front; lower it when other services share the card.
            share = gpu_memory_utilization or (upstream.GPU_SHARE.get(effort, 0.3) if len(specs) > 1 else 0.80)
            planner = Planner(os.path.join(root, "planner"), backend="vllm", gpu_memory_utilization=share, **cfg)
        planners[effort] = planner
        gen_cfg = gen_cfg or cfg
        generator = generator or os.path.join(root, "generator.pt")
    upstream.engine = cpu_engine(planners, generator, **gen_cfg) if device == "cpu" else MotionEngine(planners, generator, **gen_cfg)
    return upstream.app, sorted(planners)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bundle", action="append", required=True, help="[effort=]bundle (Hugging Face repo id or directory)")
    ap.add_argument("--device", choices=["cuda", "cpu"], default="cuda")
    ap.add_argument("--fp32", action="store_true", help="CPU only: run the planner in float32")
    ap.add_argument("--gpu-memory-utilization", type=float, help="GPU only: fraction vLLM may reserve per planner")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    a = ap.parse_args(argv)
    key = os.environ.get("MOTION_WORKER_KEY", "").strip()
    if key and not 32 <= len(key) <= 256:
        raise SystemExit("MOTION_WORKER_KEY must be 32-256 characters")
    if not key and not is_loopback(a.host):
        raise SystemExit("set MOTION_WORKER_KEY before listening beyond loopback")
    if a.gpu_memory_utilization is not None and not 0.05 <= a.gpu_memory_utilization <= 0.95:
        raise SystemExit("--gpu-memory-utilization must be between 0.05 and 0.95")
    specs = parse_bundles(a.bundle)
    app, efforts = build(specs, a.device, a.fp32, a.gpu_memory_utilization)

    @app.get("/health")
    def health():
        return {"ok": True, "device": a.device, "efforts": efforts}

    import uvicorn
    print(f"ready: POST http://{a.host}:{a.port}/generate-dense ({a.device}; effort: {', '.join(efforts)})", flush=True)
    uvicorn.run(AuthMiddleware(app, key), host=a.host, port=a.port, log_level="warning")


if __name__ == "__main__":
    main()
