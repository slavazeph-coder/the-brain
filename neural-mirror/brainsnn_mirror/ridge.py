from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class RidgeModel:
    alpha: float
    x_mean: np.ndarray
    x_scale: np.ndarray
    y_mean: np.ndarray
    coefficients: np.ndarray


def fit_ridge(features: np.ndarray, targets: np.ndarray, alpha: float = 1.0) -> RidgeModel:
    x = np.asarray(features, dtype=np.float64)
    y = np.asarray(targets, dtype=np.float64)
    if x.ndim != 2 or y.ndim != 2 or x.shape[0] != y.shape[0]:
        raise ValueError("features and targets must be 2D arrays with matching time samples")
    if x.shape[0] < 4:
        raise ValueError("at least four training samples are required")
    regularization = float(alpha)
    if regularization < 0:
        raise ValueError("alpha must be >= 0")

    x_mean = x.mean(axis=0)
    x_scale = x.std(axis=0)
    x_scale[x_scale < 1e-12] = 1.0
    y_mean = y.mean(axis=0)
    xs = (x - x_mean) / x_scale
    yc = y - y_mean

    gram = xs.T @ xs
    system = gram + (regularization * np.eye(gram.shape[0], dtype=np.float64))
    coefficients = np.linalg.solve(system, xs.T @ yc)
    return RidgeModel(regularization, x_mean, x_scale, y_mean, coefficients)


def predict_ridge(model: RidgeModel, features: np.ndarray) -> np.ndarray:
    x = np.asarray(features, dtype=np.float64)
    if x.ndim != 2 or x.shape[1] != model.x_mean.shape[0]:
        raise ValueError("feature dimension does not match trained ridge model")
    xs = (x - model.x_mean) / model.x_scale
    return (xs @ model.coefficients) + model.y_mean


def save_ridge(model: RidgeModel, path: str) -> None:
    np.savez_compressed(
        path,
        alpha=np.asarray([model.alpha], dtype=np.float64),
        x_mean=model.x_mean,
        x_scale=model.x_scale,
        y_mean=model.y_mean,
        coefficients=model.coefficients,
    )


def load_ridge(path: str) -> RidgeModel:
    payload = np.load(path)
    return RidgeModel(
        alpha=float(payload["alpha"][0]),
        x_mean=payload["x_mean"],
        x_scale=payload["x_scale"],
        y_mean=payload["y_mean"],
        coefficients=payload["coefficients"],
    )
