# Run a ten-episode robot evaluation

The first executable pack is ten sequential Panda / π₀.₅ LIBERO episodes. It uses your existing private policy and physics worker, exports a verified recording for every completed episode, and writes a resumable campaign ledger and a small report for the Arena. This does not provision compute or run the browser's toy-grid scripts.

The default pack runs `libero_spatial:0` through `libero_spatial:9`, each at seed 7. A task success and a genuine 220-step horizon miss both complete an episode. An inference/renderer error, incomplete archive or interrupted attempt does not. This pack is a BrainSNN execution check, not an official aggregate LIBERO score or a physical-robot validation.

## Before starting

Complete the one-episode pilot in the RTX 4090 handoff or the separately qualified GB10 environment first. Keep the resulting `summary.json`, `capabilities.json` and `benchmark-recording.json` together outside git. The runner checks the saved complete execution chain and requires the current worker's pinned checkpoint and exact profile to agree. Warm-up logs and scripted practice do not pass this gate.

Keep the existing text service, drivers and environments intact. The GB10 now runs a resident Hermes/Ollama text model in a separate deployment; its successful text inference does not qualify OpenPI or EGL. Do not unload that model to make room for this pack. The 4090 procedure remains separate, and port 8010 stays private.

Use one Uvicorn process and one session at a time. The runner requires the operator's command token in `ARENA_TOKEN`. It never puts that token in the exported plan or report. The output directory must be outside the source checkout or extracted worker kit. Use private durable storage with enough free space for the complete recordings.

## Run the default pack

From `robotics/arena`, or the extracted worker kit root:

```bash
python scripts/run-campaign.py \
  --url http://127.0.0.1:8081 \
  --origin https://www.brainsnn.com \
  --pilot /path/outside-git/arena-evidence/first-run \
  --out /path/outside-git/arena-evidence/spatial-smoke-10 \
  --max-seconds 600 \
  --campaign-max-seconds 7200 \
  --max-output-bytes 536870912
```

Those are execution limits: ten minutes per episode, two hours for the campaign and 512 MiB of retained output. They are not a provider spending ceiling or a prediction of throughput. If an archive cannot fit, the runner must stop rather than claim a complete handoff. Download/model compilation time is separate from the measured episode time. The policy process remains loaded between episodes; session creation still incurs renderer/environment initialization.

Resume the same output directory with the same arguments plus `--resume`. Saved results and bundles are checked before completed work is skipped. An attempt whose result was not committed before an interruption is labelled interrupted, not silently re-run or billed as a second successful episode. No automatic retries are performed. Inspect errors before deliberately starting a separate replacement campaign.

The runner closes only its own sessions. It does not stop a policy server, restart the text service, reset a GPU, change drivers or allocate another machine. Closing a session releases its renderer; it does not unload policy weights.

## Run a selected-task plan

Arena → Evaluation packs still exports a draft recipe and seed plan. Choose Panda / π₀.₅ LIBERO, a supported exact task, Locked run, one worker and at most ten episodes. Supply that exported file with `--plan /path/plan.json` to the command above. This tests consecutive seeds for the selected task; it is different from the default ten-task smoke pack.

The runner rejects unsupported robots/models, practice protocols, multiple workers, retries and plans larger than ten episodes. User-entered pilot timing and budget fields in a draft are not trusted execution measurements. The runner's wall-time and storage caps do not implement the draft's requested USD spending limit.

## Read the result

Open Arena → Evaluation packs → Import campaign report and choose the small `report.json` from the output directory. The report shows completed task successes and horizon misses, plus infrastructure errors, partial recordings, interrupted attempts and unattempted cases. Its paths point to local per-case files; importing a report does not fetch those paths or upload data.

The report is an unsigned summary, so it cannot independently prove execution. Use Open recording to inspect the original bundle for a case. Check both consumed policy cameras, chosen controller inputs, subsequent states, the bound task outcome and the checkpoint revision. The durable per-case bundle is the evidence; a displayed percentage alone is insufficient.

Record total wall time, startup overhead, storage bytes, inference latency, actual machine cost and operator time. Keep misses separate from execution failures. Ten valid episodes are the next capacity measurement, not enough evidence to promise a 1,000- or 100,000-episode delivery date.

## Episode count and coverage

This worker selects a suite-provided initial state using `seed % len(initial_states)`. More seeds can revisit the same initial state. The report therefore distinguishes attempted/completed episodes from observed task/initial-state conditions. Different policy-start state hashes can also reflect settling variation rather than new task definitions. A repeated state is a repeated test, not another distinct scene.

The eventual paid unit should state the checkpoint, task/condition matrix, number of valid completed episodes, retention, delivery window and treatment of execution errors. Baseline-versus-candidate comparisons consume two policy rollouts for each paired condition. Large packs need measured throughput and genuinely useful condition coverage before they can be quoted.
