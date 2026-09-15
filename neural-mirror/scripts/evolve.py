"""Run evolutionary search over Neural Mirror encoding experiments.

Usage (synthetic harness check -- NOT a scientific result):
    PYTHONPATH=. python scripts/evolve.py --generations 5 --population 12

Usage (real data, promotable):
    PYTHONPATH=. python scripts/evolve.py --features f.npy --targets t.npy \
        --dataset-id algonauts-2025 --generations 20

Synthetic runs record benchmarkValid=False, so the promotion gate rejects them
by construction. That is deliberate: a harness check must never become a
registry champion.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from brainsnn_mirror.director import evaluate_promotion
from brainsnn_mirror.evolution import (
    SYNTHETIC_DATASET_ID, breed, random_genome, run_generation,
)
from brainsnn_mirror.registry import (
    add_lesson, connect_registry, current_champion, promote_experiment,
    upsert_experiment,
)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Evolutionary Neural Mirror search.")
    p.add_argument("--features", default=None, help="[time, features] .npy (real data)")
    p.add_argument("--targets", default=None, help="[time, parcels] .npy (real data)")
    p.add_argument("--dataset-id", default=SYNTHETIC_DATASET_ID)
    p.add_argument("--dataset-license", default="generated-synthetic-harness-check")
    p.add_argument("--registry", default=str(ROOT / "artifacts" / "experiments.sqlite"))
    p.add_argument("--generations", type=int, default=5)
    p.add_argument("--population", type=int, default=12)
    p.add_argument("--elite", type=int, default=3)
    p.add_argument("--validation-fraction", type=float, default=0.2)
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--min-promotion-delta", type=float, default=0.002)
    p.add_argument("--report", default=None, help="write the full run as JSON here")
    p.add_argument("--allow-promotion", action="store_true",
                   help="Permit writes to the promotion gate. Refused for synthetic data.")
    return p.parse_args()


def synthetic_harness(seed: int, samples: int = 400, features: int = 24,
                      parcels: int = 64):
    rng = np.random.default_rng(seed)
    x = rng.normal(size=(samples, features))
    w = rng.normal(scale=0.4, size=(features, parcels))
    y = x @ w + rng.normal(scale=0.5, size=(samples, parcels))
    return x, y


def main() -> int:
    args = parse_args()
    synthetic = args.features is None or args.targets is None
    if synthetic:
        features, targets = synthetic_harness(args.seed)
        dataset_id, license_id = SYNTHETIC_DATASET_ID, args.dataset_license
    else:
        features = np.load(args.features)
        targets = np.load(args.targets)
        dataset_id, license_id = args.dataset_id, args.dataset_license

    if not 0.05 <= args.validation_fraction <= 0.5:
        raise ValueError("validation-fraction must be between 0.05 and 0.5")
    split = int(round(features.shape[0] * (1 - args.validation_fraction)))
    split = max(4, min(features.shape[0] - 3, split))

    rng = random.Random(args.seed)
    connection = connect_registry(args.registry)
    champion = current_champion(connection)
    population = [random_genome(rng) for _ in range(max(2, args.population))]
    history, baseline = [], champion

    for generation in range(args.generations):
        results = run_generation(population, features, targets, split, generation,
                                 dataset_id, synthetic, rng)
        history.append({"generation": generation, "results": results})
        best = results[0] if results else None
        if best and best.get("ok"):
            experiment = {
                "schemaVersion": "brainsnn.experiment.v0.1",
                "id": best["experimentId"],
                "parentId": champion.get("id") if champion else None,
                "hypothesis": f"Evolved generation {generation}: "
                              f"alpha={best['config']['alpha']}, lag={best['config']['lagTr']}.",
                "status": "EVALUATED",
                "model": {"family": "ridge", "version": "0.1.0", "trained": True},
                "dataset": {"id": dataset_id, "split": "chronological-held-out",
                            "license": license_id},
                "config": best["config"],
                "metrics": best["metrics"],
                "benchmarkValid": bool(best["benchmarkValid"]),
                "dataLeakageDetected": False,
                "promoted": False,
            }
            decision = evaluate_promotion(experiment, champion,
                                          min_delta=args.min_promotion_delta)
            upsert_experiment(connection, experiment)
            if decision["promote"] and args.allow_promotion and not synthetic:
                promote_experiment(connection, experiment["id"])
                champion = current_champion(connection)
            add_lesson(connection, experiment["id"],
                       f"gen{generation}: promote={decision['promote']} "
                       f"({decision['reason']})")
        population = breed(results, max(2, args.population), max(1, args.elite), rng)

    report = {
        "synthetic": synthetic,
        "dataset": dataset_id,
        "license": license_id,
        "fixedSplitIndex": split,
        "promotionAllowed": bool(args.allow_promotion and not synthetic),
        "baselineChampion": baseline.get("id") if baseline else None,
        "finalChampion": (current_champion(connection) or {}).get("id"),
        "generations": [
            {"generation": g["generation"],
             "best": next(({"score": r["score"], "config": r["config"]}
                           for r in g["results"] if r.get("ok")), None),
             "evaluated": sum(1 for r in g["results"] if r.get("ok")),
             "failed": sum(1 for r in g["results"] if not r.get("ok"))}
            for g in history
        ],
    }
    if args.report:
        Path(args.report).write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

