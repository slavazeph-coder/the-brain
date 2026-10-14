"""Run inside the pinned OpenPI inference environment, separate from LIBERO.

This wrapper verifies checkpoint contents before loading the model, then adds
that identity to OpenPI's initial WebSocket metadata. It does not infer a robot
policy's identity from an operator-written string alone.
"""
import argparse
import importlib.util
import os
from pathlib import Path
import subprocess

try:
    from .checkpoint_manifest import verify
except ImportError:
    from checkpoint_manifest import verify

OPENPI_REVISION = "215abfb217dbac7d5f1273282331b9b1866c0479"
CHECKPOINT = "gs://openpi-assets/checkpoints/pi05_libero/"


def warm_up(policy):
    """Compile with synthetic inputs before admitting bounded live requests.

    This is a loading check, not a LIBERO episode or a benchmark result.
    """
    import numpy as np

    result = policy.infer({"observation/state": np.zeros(8, dtype=np.float64),
                          "observation/image": np.zeros((224, 224, 3), dtype=np.uint8),
                          "observation/wrist_image": np.zeros((224, 224, 3), dtype=np.uint8),
                          "prompt": "put the bowl on the plate"})
    actions = np.asarray(result.get("actions"))
    if actions.ndim != 2 or actions.shape[0] < 5 or actions.shape[1] != 7 or not np.isfinite(actions).all():
        raise RuntimeError("Policy warm-up returned an invalid LIBERO action chunk.")
    policy.reset()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True, help="Local downloaded pi05_libero checkpoint directory")
    parser.add_argument("--manifest", required=True, help="Manifest generated before deployment")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8010)
    args = parser.parse_args()
    checkpoint_revision = verify(args.checkpoint, args.manifest)
    spec = importlib.util.find_spec("openpi")
    if spec is None:
        raise SystemExit("Run this script using the pinned OpenPI environment.")
    location = Path(spec.origin).parent if spec.origin else Path(next(iter(spec.submodule_search_locations)))
    source_revision = subprocess.check_output(["git", "-C", str(location), "rev-parse", "HEAD"], text=True).strip()
    if source_revision != OPENPI_REVISION:
        raise SystemExit("OpenPI source revision does not match the arena profile.")
    subprocess.run(["git", "-C", str(location), "diff", "--exit-code", "HEAD", "--", "."], check=True,
                   stdout=subprocess.DEVNULL)

    # JAX otherwise reserves most of the GPU before the first inference, which
    # conflicts with an existing resident BrainSNN text model on a shared 4090.
    # This reduces preallocation; it is not a hard memory cap or admission gate.
    os.environ.setdefault("XLA_PYTHON_CLIENT_PREALLOCATE", "false")
    import jax
    if not any(device.platform == "gpu" for device in jax.devices()):
        raise SystemExit("A working JAX GPU device is required; CPU fallback is not enabled.")

    from openpi.policies import policy_config
    from openpi.serving import websocket_policy_server
    from openpi.training import config

    policy = policy_config.create_trained_policy(config.get_config("pi05_libero"), str(Path(args.checkpoint).resolve()))
    print("Compiling policy with synthetic inputs; this is not a robot validation run.", flush=True)
    warm_up(policy)
    metadata = dict(policy.metadata)
    metadata["brainsnn"] = {"profileId": "panda-pi05-libero", "checkpoint": CHECKPOINT,
                            "checkpointRevision": checkpoint_revision, "config": "pi05_libero",
                            "openpiRevision": OPENPI_REVISION, "actionSize": 7}
    print("Serving verified BrainSNN pi05 LIBERO profile:", checkpoint_revision, flush=True)
    websocket_policy_server.WebsocketPolicyServer(policy=policy, host=args.host, port=args.port,
                                                  metadata=metadata).serve_forever()


if __name__ == "__main__":
    main()
