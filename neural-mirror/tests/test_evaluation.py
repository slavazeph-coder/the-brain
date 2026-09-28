from __future__ import annotations

import numpy as np
import pytest

from brainsnn_mirror.evaluation import (
    align_by_lag,
    evaluate_predictions,
    pearson_per_parcel,
    summarize_correlations,
)


def test_pearson_known_answers():
    true = np.arange(20, dtype=float).reshape(10, 2)
    perfect = pearson_per_parcel(true, true)
    assert np.allclose(perfect, 1.0)
    anti = pearson_per_parcel(-true, true)
    assert np.allclose(anti, -1.0)


def test_pearson_constant_column_is_nan_not_error():
    a = np.ones((6, 2))
    b = np.tile(np.arange(6, dtype=float).reshape(6, 1), (1, 2))
    out = pearson_per_parcel(a, b)
    assert np.all(np.isnan(out))


def test_pearson_shape_mismatch_raises():
    with pytest.raises(ValueError):
        pearson_per_parcel(np.zeros((4, 2)), np.zeros((4, 3)))


def test_align_by_lag_shifts_targets():
    x = np.arange(10, dtype=float).reshape(5, 2)
    y = np.arange(10, 20, dtype=float).reshape(5, 2)
    ax, ay = align_by_lag(x, y, lag_tr=2)
    assert np.array_equal(ax, x[:-2])
    assert np.array_equal(ay, y[2:])


def test_align_by_lag_validation():
    x = np.zeros((5, 2))
    y = np.zeros((5, 2))
    assert align_by_lag(x, y, 0)[0] is x
    with pytest.raises(ValueError):
        align_by_lag(x, y, lag_tr=-1)
    with pytest.raises(ValueError):
        align_by_lag(x, y, lag_tr=4)
    with pytest.raises(ValueError):
        align_by_lag(x, np.zeros((6, 2)), lag_tr=1)


def test_summarize_all_nan_gives_none_fields():
    summary = summarize_correlations(np.array([np.nan, np.nan]))
    assert summary["meanPearson"] is None
    assert summary["validParcelCount"] == 0
    assert summary["totalParcelCount"] == 2


def test_summarize_counts_finite_only():
    summary = summarize_correlations(np.array([0.8, -0.2, np.nan, 0.4]))
    assert summary["validParcelCount"] == 3
    assert summary["totalParcelCount"] == 4
    assert summary["positiveParcelFraction"] == pytest.approx(2 / 3)


def test_evaluate_predictions_shape_and_none_entries():
    rng = np.random.default_rng(3)
    pred = rng.normal(size=(30, 5))
    recorded = pred + rng.normal(scale=0.1, size=(30, 5))
    result = evaluate_predictions(pred, recorded)
    assert len(result["perParcelPearson"]) == 5
    assert result["validParcelCount"] == 5
    assert result["meanPearson"] > 0.9
