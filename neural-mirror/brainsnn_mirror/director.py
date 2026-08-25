from __future__ import annotations

from typing import Any, Dict, Iterable, Optional

from .registry import current_champion, list_experiments


def _score(experiment: Optional[Dict[str, Any]]) -> Optional[float]:
    if not experiment:
        return None
    value = experiment.get("metrics", {}).get("meanPearson")
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def evaluate_promotion(
    candidate: Dict[str, Any],
    champion: Optional[Dict[str, Any]] = None,
    min_delta: float = 0.002,
    max_latency_increase_fraction: float = 0.25,
) -> Dict[str, Any]:
    if not candidate.get("benchmarkValid"):
        return {"promote": False, "reason": "candidate benchmark is not valid"}
    if candidate.get("dataLeakageDetected"):
        return {"promote": False, "reason": "data leakage was detected"}
    candidate_score = _score(candidate)
    if candidate_score is None:
        return {"promote": False, "reason": "candidate has no measured mean Pearson"}
    if not champion:
        return {"promote": True, "reason": "first valid benchmarked candidate"}
    champion_score = _score(champion)
    if champion_score is None:
        return {"promote": True, "reason": "current champion has no comparable measured score"}
    delta = candidate_score - champion_score
    if delta < float(min_delta):
        return {"promote": False, "reason": "benchmark improvement is below the configured promotion delta", "delta": delta}

    candidate_latency = candidate.get("metrics", {}).get("latencyMs")
    champion_latency = champion.get("metrics", {}).get("latencyMs")
    if candidate_latency is not None and champion_latency not in (None, 0):
        latency_increase = (float(candidate_latency) - float(champion_latency)) / float(champion_latency)
        if latency_increase > float(max_latency_increase_fraction):
            return {"promote": False, "reason": "latency regression exceeds the configured boundary", "delta": delta, "latencyIncrease": latency_increase}
    return {"promote": True, "reason": "candidate improves held-out mean Pearson within resource limits", "delta": delta}


def propose_next(connection, dataset_id: str = "algonauts-2025") -> Dict[str, Any]:
    history = list_experiments(connection, limit=100)
    champion = current_champion(connection)
    tried_alpha = {item.get("config", {}).get("alpha") for item in history}
    tried_lag = {item.get("config", {}).get("lagTr") for item in history}

    if not history:
        alpha, lag_tr = 1.0, 3
        hypothesis = "Establish the first reproducible ridge encoding baseline on held-out recorded neural targets."
    else:
        alpha = next((value for value in (1.0, 10.0, 0.1, 100.0, 0.01) if value not in tried_alpha), 1.0)
        lag_tr = next((value for value in (3, 2, 4, 1, 0) if value not in tried_lag), 3)
        hypothesis = f"Test ridge alpha={alpha} and lag={lag_tr} TR while holding the dataset split and feature set fixed."

    index = len(history) + 1
    return {
        "schemaVersion": "brainsnn.research-proposal.v0.1",
        "id": f"proposal-{index:04d}",
        "currentChampionId": champion.get("id") if champion else None,
        "hypothesis": hypothesis,
        "requiresApproval": True,
        "decisionAuthority": "held-out benchmark",
        "proposedExperiment": {
            "schemaVersion": "brainsnn.experiment.v0.1",
            "id": f"mirror-{index:04d}",
            "parentId": champion.get("id") if champion else None,
            "hypothesis": hypothesis,
            "status": "PROPOSED",
            "model": {"family": "ridge", "version": "0.1.0", "trained": False},
            "dataset": {"id": dataset_id, "split": "held-out-validation", "license": "verify-from-manifest"},
            "config": {"alpha": alpha, "lagTr": lag_tr, "featureSet": "precomputed-multimodal-v0", "seed": 7},
        },
    }
