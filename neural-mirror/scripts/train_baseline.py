from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from brainsnn_mirror.director import evaluate_promotion
from brainsnn_mirror.evaluation import align_by_lag, evaluate_predictions
from brainsnn_mirror.registry import connect_registry, current_champion, promote_experiment, upsert_experiment
from brainsnn_mirror.ridge import fit_ridge, predict_ridge, save_ridge


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train the first independent BrainSNN Neural Mirror ridge baseline.")
    parser.add_argument("--features", required=True, help=".npy feature matrix shaped [time, features]")
    parser.add_argument("--targets", required=True, help=".npy recorded neural target matrix shaped [time, parcels]")
    parser.add_argument("--registry", default=str(ROOT / "artifacts" / "experiments.sqlite"))
    parser.add_argument("--output-dir", default=str(ROOT / "artifacts" / "checkpoints"))
    parser.add_argument("--experiment-id", default=None)
    parser.add_argument("--parent-id", default=None)
    parser.add_argument("--dataset-id", default="algonauts-2025")
    parser.add_argument("--dataset-license", default="CC0-neural-data; verify-stimulus-rights-separately")
    parser.add_argument("--alpha", type=float, default=1.0)
    parser.add_argument("--lag-tr", type=int, default=3)
    parser.add_argument("--validation-fraction", type=float, default=0.2)
    parser.add_argument("--min-promotion-delta", type=float, default=0.002)
    parser.add_argument("--hypothesis", default="Establish a reproducible ridge encoding baseline against held-out recorded neural targets.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    started = time.perf_counter()
    features = np.load(args.features)
    targets = np.load(args.targets)
    features, targets = align_by_lag(features, targets, args.lag_tr)
    if not 0.05 <= args.validation_fraction <= 0.5:
        raise ValueError("validation-fraction must be between 0.05 and 0.5")
    split = int(round(features.shape[0] * (1 - args.validation_fraction)))
    split = max(4, min(features.shape[0] - 3, split))
    x_train, x_val = features[:split], features[split:]
    y_train, y_val = targets[:split], targets[split:]

    model = fit_ridge(x_train, y_train, alpha=args.alpha)
    predictions = predict_ridge(model, x_val)
    metrics = evaluate_predictions(predictions, y_val)
    elapsed_ms = (time.perf_counter() - started) * 1000
    metrics["latencyMs"] = elapsed_ms
    metrics["trainSamples"] = int(x_train.shape[0])
    metrics["validationSamples"] = int(x_val.shape[0])
    metrics["featureDimensions"] = int(features.shape[1])
    metrics["parcelCount"] = int(targets.shape[1])

    experiment_id = args.experiment_id or f"ridge-{int(time.time())}"
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    checkpoint = output_dir / f"{experiment_id}.npz"
    save_ridge(model, str(checkpoint))

    experiment = {
        "schemaVersion": "brainsnn.experiment.v0.1",
        "id": experiment_id,
        "parentId": args.parent_id,
        "hypothesis": args.hypothesis,
        "status": "EVALUATED",
        "model": {"family": "ridge", "version": "0.1.0", "trained": True},
        "dataset": {"id": args.dataset_id, "split": "chronological-held-out", "license": args.dataset_license},
        "config": {"alpha": args.alpha, "lagTr": args.lag_tr, "validationFraction": args.validation_fraction},
        "metrics": metrics,
        "checkpointPath": str(checkpoint),
        "benchmarkValid": True,
        "dataLeakageDetected": False,
        "promoted": False,
    }

    connection = connect_registry(args.registry)
    champion = current_champion(connection)
    decision = evaluate_promotion(experiment, champion, min_delta=args.min_promotion_delta)
    upsert_experiment(connection, experiment)
    if decision["promote"]:
        promote_experiment(connection, experiment_id)
        experiment["status"] = "PROMOTED"
        experiment["promoted"] = True

    report = {"experiment": experiment, "promotion": decision}
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
