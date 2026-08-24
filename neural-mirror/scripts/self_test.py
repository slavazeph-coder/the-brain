from __future__ import annotations

import tempfile
from pathlib import Path

import numpy as np

from brainsnn_mirror.director import evaluate_promotion
from brainsnn_mirror.evaluation import evaluate_predictions
from brainsnn_mirror.registry import connect_registry, current_champion, promote_experiment, upsert_experiment
from brainsnn_mirror.ridge import fit_ridge, predict_ridge


def main() -> int:
    rng = np.random.default_rng(7)
    samples = 240
    features = 18
    parcels = 64
    x = rng.normal(size=(samples, features))
    weights = rng.normal(scale=0.4, size=(features, parcels))
    y = x @ weights + rng.normal(scale=0.05, size=(samples, parcels))

    split = 190
    model = fit_ridge(x[:split], y[:split], alpha=1.0)
    predicted = predict_ridge(model, x[split:])
    metrics = evaluate_predictions(predicted, y[split:])
    mean_r = metrics["meanPearson"]
    if mean_r is None or mean_r < 0.95:
        raise AssertionError(f"synthetic ridge benchmark unexpectedly weak: {mean_r}")

    with tempfile.TemporaryDirectory() as tmp:
        connection = connect_registry(Path(tmp) / "experiments.sqlite")
        first = {
            "id": "synthetic-strong",
            "hypothesis": "self-test",
            "status": "EVALUATED",
            "model": {"family": "ridge", "trained": True},
            "dataset": {"id": "synthetic", "split": "held-out", "license": "generated"},
            "config": {"alpha": 1.0},
            "metrics": {**metrics, "latencyMs": 10.0},
            "benchmarkValid": True,
            "dataLeakageDetected": False,
        }
        decision = evaluate_promotion(first, None)
        if not decision["promote"]:
            raise AssertionError(f"first valid candidate should promote: {decision}")
        upsert_experiment(connection, first)
        promote_experiment(connection, first["id"])
        champion = current_champion(connection)
        if champion is None or champion["id"] != first["id"]:
            raise AssertionError("registry failed to persist champion")

        weaker = {
            **first,
            "id": "synthetic-weaker",
            "metrics": {**metrics, "meanPearson": float(mean_r) - 0.02, "latencyMs": 10.0},
        }
        weaker_decision = evaluate_promotion(weaker, champion)
        if weaker_decision["promote"]:
            raise AssertionError("weaker candidate must not replace champion")

    print(f"NEURAL_MIRROR_SELF_TEST_OK meanPearson={mean_r:.4f} parcels={parcels}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
