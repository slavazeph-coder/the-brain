"""Evolutionary search over Neural Mirror encoding experiments.

Enumeration, not search: director.propose_next walks a hardcoded five-value list
of alphas and lags. It cannot explore interactions, and it never stops.

Honesty contract: a synthetic-data run CANNOT be promoted. Synthetic scores are
harness checks, never neural-science claims.
"""
from __future__ import annotations

import json
import math
import random
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np

from .evaluation import align_by_lag, evaluate_predictions
from .ridge import fit_ridge, predict_ridge

SCHEMA = "brainsnn.experiment.v0.1"
SYNTHETIC_DATASET_ID = "synthetic"


@dataclass
class Genome:
    """Evolvable encoding-experiment configuration."""
    alpha: float
    lag_tr: int
    feature_keep: float
    seed: int

    def to_config(self) -> Dict[str, Any]:
        return {
            "alpha": round(float(self.alpha), 6),
            "lagTr": int(self.lag_tr),
            "featureKeep": round(float(self.feature_keep), 4),
            "seed": int(self.seed),
        }


def random_genome(rng: random.Random) -> Genome:
    return Genome(
        alpha=10 ** rng.uniform(-3, 3),
        lag_tr=rng.randint(0, 8),
        feature_keep=rng.uniform(0.25, 1.0),
        seed=rng.randint(0, 10**6),
    )


def mutate(g: Genome, rng: random.Random, scale: float = 1.0) -> Genome:
    """Perturb multiplicatively.

    Alpha moves in log space: ridge alpha spans orders of magnitude, so adding a
    fixed amount would make small values effectively immutable.
    """
    alpha = g.alpha
    if rng.random() < 0.7:
        alpha = 10 ** (math.log10(max(alpha, 1e-9)) + rng.gauss(0, 0.5 * scale))
    alpha = min(max(alpha, 1e-4), 1e4)
    lag = g.lag_tr
    if rng.random() < 0.5:
        lag = min(max(lag + rng.choice([-1, 1]), 0), 8)
    keep = g.feature_keep
    if rng.random() < 0.5:
        keep = min(max(keep + rng.gauss(0, 0.12 * scale), 0.2), 1.0)
    return Genome(alpha=alpha, lag_tr=lag, feature_keep=keep,
                  seed=rng.randint(0, 10**6))


def crossover(a: Genome, b: Genome, rng: random.Random) -> Genome:
    pick = lambda x, y: x if rng.random() < 0.5 else y
    return Genome(
        alpha=pick(a.alpha, b.alpha),
        lag_tr=pick(a.lag_tr, b.lag_tr),
        feature_keep=pick(a.feature_keep, b.feature_keep),
        seed=rng.randint(0, 10**6),
    )


def evaluate_genome(g: Genome, features: np.ndarray, targets: np.ndarray,
                    split: int) -> Dict[str, Any]:
    """Fit on train, score on a FIXED held-out split.

    The split index is passed in and never recomputed per candidate: rescoring
    candidates on different splits would make generations incomparable, which is
    the classic way an evolutionary loop fools itself.
    """
    x, y = align_by_lag(features, targets, g.lag_tr)
    if split >= x.shape[0] - 2:
        return {"ok": False, "reason": "lag leaves too few samples for the fixed split"}
    if g.feature_keep < 1.0:
        cols = max(1, int(round(x.shape[1] * g.feature_keep)))
        rng = np.random.default_rng(g.seed)
        keep = np.sort(rng.choice(x.shape[1], size=cols, replace=False))
        x = x[:, keep]
    x_train, x_val = x[:split], x[split:]
    y_train, y_val = y[:split], y[split:]
    started = time.perf_counter()
    model = fit_ridge(x_train, y_train, alpha=g.alpha)
    predicted = predict_ridge(model, x_val)
    metrics = evaluate_predictions(predicted, y_val)
    metrics["latencyMs"] = (time.perf_counter() - started) * 1000
    metrics["featureDimensions"] = int(x.shape[1])
    return {"ok": True, "metrics": metrics, "model": model}


def run_generation(population: List[Genome], features: np.ndarray,
                   targets: np.ndarray, split: int, generation: int,
                   dataset_id: str, synthetic: bool,
                   rng: random.Random) -> List[Dict[str, Any]]:
    """Score one generation. Returns result records sorted best-first.

    A synthetic dataset can never yield benchmarkValid=True. That flag is what
    director.evaluate_promotion keys on, so clearing it here is what stops a
    harness check from being written into the registry as a neural result.
    """
    results = []
    for index, genome in enumerate(population):
        try:
            outcome = evaluate_genome(genome, features, targets, split)
        except (ValueError, np.linalg.LinAlgError) as error:
            results.append({"generation": generation, "index": index,
                            "config": genome.to_config(), "ok": False,
                            "reason": type(error).__name__, "score": None})
            continue
        if not outcome["ok"]:
            results.append({"generation": generation, "index": index,
                            "config": genome.to_config(), "ok": False,
                            "reason": outcome["reason"], "score": None})
            continue
        metrics = outcome["metrics"]
        score = metrics.get("meanPearson")
        results.append({
            "generation": generation,
            "index": index,
            "experimentId": f"evo-g{generation}-c{index}",
            "config": genome.to_config(),
            "ok": True,
            "score": None if score is None else float(score),
            "metrics": metrics,
            "benchmarkValid": not synthetic,
            "synthetic": synthetic,
            "dataset": dataset_id,
        })
    results.sort(key=lambda r: (r["score"] is not None, r["score"] or -1e9), reverse=True)
    return results


def breed(results: List[Dict[str, Any]], population_size: int,
          elite: int, rng: random.Random) -> List[Genome]:
    """Carry the best forward and refill by mutation + crossover.

    Keeping an elite band stops a lucky generation from being thrown away by a
    bad draw of mutations; the rest is mutation-weighted so the search keeps
    exploring instead of only hill-climbing one peak.
    """
    survivors = [r for r in results if r["ok"] and r["score"] is not None]
    if not survivors:
        return [random_genome(rng) for _ in range(population_size)]

    def to_genome(r: Dict[str, Any]) -> Genome:
        c = r["config"]
        return Genome(alpha=float(c["alpha"]), lag_tr=int(c["lagTr"]),
                      feature_keep=float(c["featureKeep"]), seed=int(c["seed"]))

    parents = [to_genome(r) for r in survivors[:max(1, elite)]]
    nxt = [to_genome(r) for r in survivors[:max(1, min(elite, population_size))]]
    while len(nxt) < population_size:
        if len(parents) >= 2 and rng.random() < 0.35:
            child = crossover(rng.choice(parents), rng.choice(parents), rng)
        else:
            child = rng.choice(parents)
        nxt.append(mutate(child, rng))
    return nxt[:population_size]




