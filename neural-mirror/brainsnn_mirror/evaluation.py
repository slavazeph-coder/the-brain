from __future__ import annotations

import math
from typing import Dict, Tuple

import numpy as np


def align_by_lag(features: np.ndarray, targets: np.ndarray, lag_tr: int = 0) -> Tuple[np.ndarray, np.ndarray]:
    """Align earlier stimulus features to later recorded neural targets."""
    x = np.asarray(features, dtype=np.float64)
    y = np.asarray(targets, dtype=np.float64)
    if x.ndim != 2 or y.ndim != 2:
        raise ValueError("features and targets must both be 2D [time, dimension]")
    if x.shape[0] != y.shape[0]:
        raise ValueError("features and targets must have the same number of time samples before lag alignment")
    lag = int(lag_tr)
    if lag < 0:
        raise ValueError("lag_tr must be >= 0")
    if lag == 0:
        return x, y
    if lag >= x.shape[0] - 2:
        raise ValueError("lag_tr leaves too few samples")
    return x[:-lag], y[lag:]


def pearson_per_parcel(predicted: np.ndarray, recorded: np.ndarray) -> np.ndarray:
    pred = np.asarray(predicted, dtype=np.float64)
    true = np.asarray(recorded, dtype=np.float64)
    if pred.shape != true.shape or pred.ndim != 2:
        raise ValueError("predicted and recorded must share shape [time, parcels]")
    pred_centered = pred - pred.mean(axis=0, keepdims=True)
    true_centered = true - true.mean(axis=0, keepdims=True)
    numerator = np.sum(pred_centered * true_centered, axis=0)
    denominator = np.sqrt(np.sum(pred_centered ** 2, axis=0) * np.sum(true_centered ** 2, axis=0))
    with np.errstate(divide="ignore", invalid="ignore"):
        correlations = numerator / denominator
    correlations[~np.isfinite(correlations)] = np.nan
    return correlations


def summarize_correlations(correlations: np.ndarray) -> Dict[str, float | int | None]:
    values = np.asarray(correlations, dtype=np.float64)
    finite = values[np.isfinite(values)]
    if finite.size == 0:
        return {
            "meanPearson": None,
            "medianPearson": None,
            "positiveParcelFraction": None,
            "validParcelCount": 0,
            "totalParcelCount": int(values.size),
        }
    return {
        "meanPearson": float(np.mean(finite)),
        "medianPearson": float(np.median(finite)),
        "positiveParcelFraction": float(np.mean(finite > 0)),
        "validParcelCount": int(finite.size),
        "totalParcelCount": int(values.size),
    }


def evaluate_predictions(predicted: np.ndarray, recorded: np.ndarray) -> Dict[str, object]:
    correlations = pearson_per_parcel(predicted, recorded)
    summary = summarize_correlations(correlations)
    return {
        **summary,
        "perParcelPearson": [None if not math.isfinite(float(value)) else float(value) for value in correlations],
    }
