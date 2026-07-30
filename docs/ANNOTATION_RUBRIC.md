# Annotation rubric

How to label content for the BrainSNN evaluation corpus, and how to check that
the labels mean anything.

## Why this exists

Scores like "Manipulation Risk 72" are only defensible if they can be checked
against judgements made independently of the engine. Two rules follow:

1. **Label ordinally, not numerically.** No one can say a sentence is "84%
   manipulative". People *can* reliably say that a phishing email carries more
   manipulation pressure than an understated luxury ad. So we label levels and
   evaluate rank agreement.
2. **Report agreement or don't claim reliability.** A single annotator's labels
   are one opinion. Every corpus release states Krippendorff's alpha per
   dimension (`src/lib/agreement.js`), using the *ordinal* distance so that
   confusing `low` with `extreme` counts more than confusing `low` with
   `moderate`.

Conventional reading of alpha: **≥ 0.8** rely on it, **0.667–0.8** tentative
only, **below that** do not draw conclusions.

## Dimensions and levels

Levels are `low` < `moderate` < `high` < `extreme`.

| Dimension | Question the annotator answers |
|---|---|
| `manipulationRisk` | How much does this push the reader toward action by means other than evidence — pressure, fear, shame, manufactured scarcity? |
| `trust` | How much does this give the reader to verify — specifics, numbers, named limits, checkable claims? |
| `urgency` | How strongly does it insist on acting *now*, whether or not the deadline is real? |
| `viralPull` | How likely is a reader to pass this on — curiosity gap, outrage, surprise, identity? |

### Anchors

- **Trust `extreme`** — states what is *not* known, or gives numbers a reader
  could check. *"Our sample was twelve companies, all under fifty people, so
  treat the number as directional."*
- **Trust `low`** — asks for belief while supplying nothing checkable, or
  deflects. *"We regret that some customers may have felt inconvenienced."*
- **Manipulation `extreme`** — fear or shame plus a deadline plus a demand.
  *"Verify within 24 hours or your account will be permanently deleted."*
- **Manipulation `low`** — makes its case and leaves the decision alone.
- **Urgency `high` but manipulation `low`** — a real deadline with a stated
  reason. *"Enrollment closes 30 November because the cohort starts in
  December."* This pair is the most common labelling mistake: urgency is not
  manipulation when the reason is given and true.

### Rules

- Judge the text as written, not the sender's presumed motives.
- Judge the whole passage, not the worst sentence in it.
- Never label your own writing.
- Two annotators minimum per item; three where the first two disagree by more
  than one level.

## Public corpora

Established human-labelled datasets are stronger evidence than anything we can
produce alone, because their labels come with published agreement figures and
baselines. The persuasion-technique tasks map most directly onto our work:

| Source | Maps onto |
|---|---|
| SemEval-2023 Task 3 (persuasion techniques) | `manipulationRisk`; per-technique detection |
| SemEval-2020 Task 11 (propaganda, PTC) | `manipulationRisk`; loaded language, appeal to fear, doubt |
| Webis Clickbait Corpus | `viralPull` |
| Public phishing corpora | `manipulationRisk`, `urgency` |

**These datasets are not vendored into this repository** — they carry their own
licences and are large. Fetch them into `datasets/` (gitignored), convert to
JSONL, and evaluate:

```
node scripts/eval-corpus.mjs datasets/persuasion.jsonl --dimension manipulationRisk
```

Each line: `{ "id": "...", "text": "...", "labels": { "manipulationRisk": 1 } }`

The script reports **AUC** (ranking), **Brier** (probabilistic accuracy) and
**ECE** with a reliability table (whether a score of 80 behaves like 80%).
Ranking and calibration come apart routinely — a scorer can order items
perfectly while its numbers mean nothing as percentages — so both are reported.

## Known gap

`firewallLayer.js` currently detects only four tactics (`forced-urgency`,
`fear-pressure`, `outrage-hook`, `certainty-theater`), each a regex-count
threshold, and only *fear-pressure* maps cleanly onto a published class
(*Appeal to Fear/Prejudice*). Building a detector against the full published
taxonomy is the substantive work these corpora should drive — not merely
validating what already exists.
