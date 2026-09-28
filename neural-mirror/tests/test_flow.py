"""End-to-end synthetic flow: train -> evaluate -> register -> promote -> refuse weaker.

Synthetic metrics are test metrics only; this file makes no neural-science claims.
"""

from __future__ import annotations

import numpy as np

from brainsnn_mirror.director import evaluate_promotion
from brainsnn_mirror.evaluation import evaluate_predictions
from brainsnn_mirror.registry import (
    current_champion,
    promote_experiment,
    upsert_experiment,
)
from brainsnn_mirror.ridge import fit_ridge, predict_ridge


def _train(samples=200, features=16, parcels=32, seed=11, noise=0.05):
    rng = np.random.default_rng(seed)
    x = rng.normal(size=(samples, features))
    w = rng.normal(scale=0.4, size=(features, parcels))
    y = x @ w + rng.normal(scale=noise, size=(samples, parcels))
    split = 160
    model = fit_ridge(x[:split], y[:split], alpha=1.0)
    predicted = predict_ridge(model, x[split:])
    metrics = evaluate_predictions(predicted, y[split:])
    return metrics


def test_full_promotion_flow(registry, make_exp):
    strong = _train(seed=11)
    assert strong["meanPearson"] is not None and strong["meanPearson"] > 0.9

    candidate = make_exp(
        "mirror-0001",
        status="EVALUATED",
        metrics={"meanPearson": strong["meanPearson"]},
    )
    verdict = evaluate_promotion(candidate)
    assert verdict["promote"] is True
    upsert_experiment(registry, candidate)
    promote_experiment(registry, "mirror-0001")
    assert current_champion(registry)["id"] == "mirror-0001"

    weak = _train(seed=12, noise=30.0)  # deliberately destroyed signal
    weaker = make_exp("mirror-0002", status="EVALUATED", metrics={"meanPearson": weak["meanPearson"] or 0.0})
    verdict = evaluate_promotion(weaker, current_champion(registry))
    assert verdict["promote"] is False
    assert current_champion(registry)["id"] == "mirror-0001"
