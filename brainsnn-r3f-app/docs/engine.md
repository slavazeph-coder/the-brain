# BrainSNN engine

BrainSNN analyzes content, helps revise it, and produces inspectable comparison records for people and agents. The office is a view of work using the engine. XIO's commercial experiment is one workload, not the product identity.

## Available now

- `/app`: analyze and improve content; save scans and versions.
- `/engine`: compare original and candidate text with the same deterministic scorer, inspect source-linked signals, and download a review record.
- `/evidence`: inspect the current detector evaluation and its limitations.
- `/missions`: define bounded proof missions and inspect recorded attempts.

The comparison endpoint does not invoke a paid model, store submitted text, verify external facts, accept work or promote context. It returns the submitted texts to the caller; keep exported records private when inputs are private. HTTP requests send the inputs to the BrainSNN server. The stdio MCP tool runs the same comparison locally.

## HTTP comparison

`POST https://www.brainsnn.com/api/engine/compare`

```json
{
  "original": "Guaranteed results! Act now.",
  "candidate": "Test the workflow and review the measured limitations.",
  "limits": { "maxTrustDrop": 0, "maxPressureIncrease": 0 }
}
```

Each text must be a nonempty string of at most 8,000 UTF-16 code units. The body cap is 64 KB; the existing general API limit applies. Limits are optional: trust-drop allowance is 0–100 points; manipulation-pressure increase allowance is 0–1. Invalid values fail instead of silently disabling a check.

Input must be well-formed Unicode: lone UTF-16 surrogates are rejected so UTF-8 replacement cannot collapse different submitted strings to the same input hash. Valid surrogate pairs and literal replacement characters are preserved.

The result is `brainsnn.engine-comparison.v1` with original/candidate SHA-256 hashes, exact source text, heuristic signal deltas, per-check results, runtime, and source quotations with UTF-16 offsets. Quotation previews inherit the analyzer's 18-segment cap and have a 320-code-point limit; `findingsTruncated` identifies incomplete previews. Full input text is retained in the returned record.

`signalsWithinLimits` means only that the chosen **model-signal** limits passed. `decision` remains `REVIEW_REQUIRED`; factual verification, market measurement, work acceptance and context promotion remain false. These scores are neither customer-response probabilities nor neural measurements. Inspect factual claims and measure the intended outcome independently.

Comparison IDs cover inputs, limits, measured output and source findings. Runtime/timestamps do not change identity. `engineRevision` is populated from a valid Railway git revision when available and otherwise remains null. Keep the exported record and source revision when reproducing an assessment.

Status codes: 200 comparison record; 400 invalid input; 413 oversized body; 429 rate limit; 500 failed local execution. Responses use `Cache-Control: no-store`.

## MCP

With Node.js 22.6 or newer, install the MCP package from the repository root:

```sh
cd brainsnn-r3f-app/mcp-server
npm ci
```

In your MCP client's stdio configuration, set the command to `node` and its argument to the absolute path of `index.mjs` in your checkout, for example:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/the-brain/brainsnn-r3f-app/mcp-server/index.mjs"]
}
```

Replace the example path with your actual checkout path. These local comparison and promotion checks require no model-provider credentials.

The existing `mcp-server/index.mjs` adds:

- **brain_compare** — the same input and comparison contract as HTTP, fully local.
- **brain_promotion_check** — evaluates supplied candidate/champion benchmark records against completion, trained-model, explicit-validity, leakage, dataset/split, score and latency requirements. It returns a decision check; it does not run a benchmark, authenticate its provenance, change a registry or deploy a model.

Candidate benchmarks must be evaluated or promoted, trained, valid, explicitly free of detected leakage, and have no failure reason. Pearson scores must be measured values in [-1,1]; latency must be measured and nonnegative. Zero is a measurement, while null, blanks and booleans are not. Candidate and champion must use the same dataset and split. Missing data blocks the check. The Python research registry is a separate path and is not made authoritative by this check.

## Next engine milestone

Versioned context packages that are actually consumed by subsequent tasks, with independently evaluated outcomes and reversible promotion. This is future work: the comparison tool does not train model weights, automatically turn saved records into memory, or operate a general autonomous worker company.

New-customer discovery can test that future loop. Prior-client outreach is excluded from the current repositioning task. Robotics and continuous streaming remain potential workloads with their original spending constraints intact.
