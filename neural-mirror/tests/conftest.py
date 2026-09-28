from __future__ import annotations

import warnings

import pytest


def make_experiment(experiment_id: str = "mirror-0001", **overrides):
    base = {
        "schemaVersion": "brainsnn.experiment.v0.1",
        "id": experiment_id,
        "parentId": None,
        "hypothesis": "unit-test hypothesis",
        "status": "PROPOSED",
        "model": {"family": "ridge"},
        "dataset": {"id": "algonauts-2025", "split": "held-out-validation", "license": "research-only"},
        "config": {"alpha": 1.0, "lagTr": 3},
        "metrics": {"meanPearson": 0.5},
        "checkpointPath": None,
        "benchmarkValid": True,
        "dataLeakageDetected": False,
        "promoted": False,
        "failureReason": None,
    }
    base.update(overrides)
    return base


@pytest.fixture()
def registry(tmp_path):
    from brainsnn_mirror.registry import connect_registry

    return connect_registry(tmp_path / "registry.sqlite")


@pytest.fixture()
def make_exp():
    return make_experiment
