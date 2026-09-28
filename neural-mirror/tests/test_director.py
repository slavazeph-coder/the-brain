from __future__ import annotations

from brainsnn_mirror.director import evaluate_promotion, propose_next


def test_invalid_benchmark_cannot_promote(make_exp):
    verdict = evaluate_promotion(make_exp(benchmarkValid=False))
    assert verdict["promote"] is False


def test_leakage_cannot_promote(make_exp):
    verdict = evaluate_promotion(make_exp(dataLeakageDetected=True))
    assert verdict["promote"] is False


def test_missing_score_cannot_promote(make_exp):
    verdict = evaluate_promotion(make_exp(metrics={}))
    assert verdict["promote"] is False


def test_first_valid_candidate_promotes(make_exp):
    verdict = evaluate_promotion(make_exp(metrics={"meanPearson": 0.3}))
    assert verdict["promote"] is True


def test_weaker_candidate_cannot_replace_champion(make_exp):
    champion = make_exp("champ", metrics={"meanPearson": 0.8})
    candidate = make_exp("weak", metrics={"meanPearson": 0.7})
    verdict = evaluate_promotion(candidate, champion)
    assert verdict["promote"] is False


def test_tiny_improvement_below_delta_is_rejected(make_exp):
    champion = make_exp("champ", metrics={"meanPearson": 0.8})
    candidate = make_exp("near", metrics={"meanPearson": 0.8005})
    verdict = evaluate_promotion(candidate, champion, min_delta=0.002)
    assert verdict["promote"] is False


def test_stronger_candidate_with_ok_latency_promotes(make_exp):
    champion = make_exp("champ", metrics={"meanPearson": 0.5, "latencyMs": 100})
    candidate = make_exp("strong", metrics={"meanPearson": 0.6, "latencyMs": 110})
    verdict = evaluate_promotion(candidate, champion)
    assert verdict["promote"] is True


def test_latency_regression_blocks_promotion(make_exp):
    champion = make_exp("champ", metrics={"meanPearson": 0.5, "latencyMs": 100})
    candidate = make_exp("strong-slow", metrics={"meanPearson": 0.7, "latencyMs": 200})
    verdict = evaluate_promotion(candidate, champion)
    assert verdict["promote"] is False


def test_propose_next_on_empty_registry(registry):
    proposal = propose_next(registry)
    assert proposal["schemaVersion"] == "brainsnn.research-proposal.v0.1"
    assert proposal["requiresApproval"] is True
    assert proposal["proposedExperiment"]["config"]["alpha"] == 1.0
    assert proposal["proposedExperiment"]["config"]["lagTr"] == 3


def test_propose_next_avoids_tried_configs(registry, make_exp):
    from brainsnn_mirror.registry import upsert_experiment

    upsert_experiment(
        registry,
        make_exp("mirror-0001", config={"alpha": 1.0, "lagTr": 3}),
    )
    proposal = propose_next(registry)
    config = proposal["proposedExperiment"]["config"]
    assert config["alpha"] != 1.0
    assert config["lagTr"] != 3
