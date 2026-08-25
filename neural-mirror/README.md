# BrainSNN Neural Mirror research package

This directory is the independent research/training side of BrainSNN's Neural Mirror.

## Scientific contract

The production browser currently has a deterministic CPU architecture baseline that proves the dense temporal prediction contract. **That baseline is untrained and unvalidated**. It must not be described as fMRI prediction, measured brain activity, mind reading, diagnosis, or a medical scan.

This Python package is where trained candidates are fit against **recorded human neural targets** and promoted only after held-out evaluation.

- Neural Mirror: predicts/model-estimates neural-response representations.
- Brand Brain / Outcome Learning: learns descriptive relationships with real business outcomes.
- Those two layers stay separate. A neural representation does not itself mean CTR, ROAS, purchase intent, or persuasion success.
- TRIBE v2 is a research reference only under the current non-commercial release terms. Do not use TRIBE weights or outputs as commercial labels without appropriate permission/license review.

## First benchmark

The first target is the Algonauts Project 2025 / CNeuroMod challenge representation: multimodal movie stimuli with fMRI targets summarized into 1,000 Schaefer parcels for four subjects. See `datasets/algonauts_2025.json`.

The challenge neural data is permissive, but movie/TV stimulus rights are a separate provenance question. Track neural-data license, stimulus rights, feature-model license, and resulting commercial eligibility independently in every experiment.

## CPU-first baseline

Install:

```bash
cd neural-mirror
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Run the deterministic synthetic research self-test:

```bash
PYTHONPATH=. python scripts/self_test.py
```

The self-test generates synthetic data with a known linear relationship, trains Ridge on a train split, evaluates on held-out samples, checks the SQLite registry, promotes the valid candidate, and confirms a weaker candidate cannot replace it. Synthetic metrics are test metrics only; they are never neural-science claims.

## Train a real Ridge candidate

Prepare two `.npy` matrices:

- features: `[time, feature_dimension]`
- recorded neural targets: `[time, parcels]`

Then:

```bash
PYTHONPATH=. python scripts/train_baseline.py \
  --features /data/features.npy \
  --targets /data/targets.npy \
  --dataset-id algonauts-2025 \
  --alpha 1 \
  --lag-tr 3
```

The command:

1. aligns earlier stimulus features to later fMRI targets using the configured TR lag;
2. makes a chronological held-out validation split;
3. trains a multivariate Ridge encoding model on CPU;
4. predicts the held-out recorded parcel responses;
5. computes Pearson correlation per parcel plus mean/median/positive-parcel fraction;
6. stores the experiment, configuration, license metadata and checkpoint in SQLite;
7. compares the measured held-out score to the current champion;
8. promotes only when the benchmark and resource gates pass.

No benchmark value is hard-coded.

## Leaderboard

```bash
PYTHONPATH=. python scripts/leaderboard.py
```

The registry default is `artifacts/experiments.sqlite`. Model checkpoints default to `artifacts/checkpoints/` and should not be committed when large.

## Research Director

There are two compatible V0.1 control-plane implementations:

- production JS: `brainsnn-r3f-app/src/lib/researchDirector.js`
- research Python: `brainsnn_mirror/director.py`

The Director may propose experiments and retain lessons. It **does not decide scientific success**. Candidate promotion is based on objective held-out benchmark gates. Expensive training should require human approval.

Initial evolution path:

1. Ridge baseline with fixed/precomputed multimodal features.
2. Sweep regularization and hemodynamic lag while holding the split fixed.
3. Add modality ablations.
4. Add a small temporal/fusion model only after Ridge establishes the floor.
5. Add GPU-backed feature extraction/training behind the same experiment contract.

## GPU path

Nothing in the Ridge benchmark requires a GPU. Later GPU workers should replace/extend model and feature adapters, not change the experiment schema. Record device, runtime, VRAM, feature versions and cost on every GPU run.

## Commercial gating

A trained Neural Mirror representation should not affect Brand Brain's outcome-similarity calculation until all required gates are explicit:

- trained model;
- validated against recorded neural data;
- benchmark provenance present;
- compatible representation/reference mapping;
- commercial-use licensing/provenance cleared.

Until then BrainSNN can store/display the research provenance, but Brand Brain must exclude the Neural Mirror embedding from its commercial outcome fit.
