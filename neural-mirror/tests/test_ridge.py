from __future__ import annotations

import numpy as np
import pytest

from brainsnn_mirror.ridge import fit_ridge, load_ridge, predict_ridge, save_ridge


def synthetic(samples=120, features=12, parcels=8, seed=7):
    rng = np.random.default_rng(seed)
    x = rng.normal(size=(samples, features))
    w = rng.normal(scale=0.5, size=(features, parcels))
    y = x @ w + rng.normal(scale=0.05, size=(samples, parcels))
    return x, y


def test_fit_recovers_linear_signal():
    x, y = synthetic()
    model = fit_ridge(x[:96], y[:96], alpha=1.0)
    predicted = predict_ridge(model, x[96:])
    pred_c = predicted - predicted.mean(axis=0, keepdims=True)
    true_c = y[96:] - y[96:].mean(axis=0, keepdims=True)
    num = (pred_c * true_c).sum(axis=0)
    den = np.sqrt((pred_c**2).sum(axis=0) * (true_c**2).sum(axis=0))
    mean_r = float(np.mean(num / den))
    assert mean_r > 0.9


def test_constant_feature_does_not_divide_by_zero():
    x, y = synthetic()
    x[:, 3] = 42.0
    model = fit_ridge(x, y, alpha=1.0)
    assert model.x_scale[3] == 1.0
    out = predict_ridge(model, x)
    assert np.all(np.isfinite(out))


def test_validation_errors():
    x, y = synthetic()
    with pytest.raises(ValueError):
        fit_ridge(x[:10], y[:12])  # mismatched sample counts
    with pytest.raises(ValueError):
        fit_ridge(x[:, 0], y)  # 1D features
    with pytest.raises(ValueError):
        fit_ridge(x[:3], y[:3])  # too few samples
    with pytest.raises(ValueError):
        fit_ridge(x, y, alpha=-1.0)


def test_predict_rejects_wrong_width():
    x, y = synthetic()
    model = fit_ridge(x, y)
    with pytest.raises(ValueError):
        predict_ridge(model, x[:, :5])


def test_save_load_roundtrip(tmp_path):
    x, y = synthetic()
    model = fit_ridge(x, y, alpha=2.5)
    path = tmp_path / "model.npz"
    save_ridge(model, str(path))
    loaded = load_ridge(str(path))
    assert loaded.alpha == pytest.approx(2.5)
    assert np.allclose(loaded.coefficients, model.coefficients)
    assert np.allclose(loaded.x_mean, model.x_mean)
    assert np.allclose(predict_ridge(loaded, x), predict_ridge(model, x))
