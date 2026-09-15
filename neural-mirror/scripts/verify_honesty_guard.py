"""Prove the honesty guard: synthetic runs must never be promoted."""
import json, sys
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from brainsnn_mirror.director import evaluate_promotion
from brainsnn_mirror.evolution import run_generation, random_genome
from brainsnn_mirror.registry import connect_registry, current_champion, promote_experiment, upsert_experiment
import random

rng = random.Random(7)
x = np.random.default_rng(7).normal(size=(400, 24))
y = x @ np.random.default_rng(8).normal(scale=0.4, size=(24, 64)) + np.random.default_rng(9).normal(scale=0.5, size=(400, 64))

pop = [random_genome(rng) for _ in range(4)]
res = run_generation(pop, x, y, 320, 0, "synthetic", True, rng)
best = next(r for r in res if r.get("ok"))
print("synthetic best score:", round(best["score"], 4), "benchmarkValid:", best["benchmarkValid"])

exp = {"id": "honesty-check", "hypothesis": "guard test", "status": "EVALUATED",
       "model": {"family": "ridge"}, "dataset": {"id": "synthetic", "split": "held-out", "license": "generated"},
       "config": best["config"], "metrics": best["metrics"],
       "benchmarkValid": best["benchmarkValid"], "dataLeakageDetected": False}
decision = evaluate_promotion(exp, None)
print("promotion decision:", decision)
assert decision["promote"] is False, "GUARD FAILED: synthetic result was promotable"
print("GUARD OK: synthetic result refused promotion")
