# Quantum Alignment Tests

A small Qiskit suite that probes the *physical* meaning of "alignment" in
quantum computing — phase coherence, observation collapse, and decoherence —
across an ideal simulator, a noisy simulator, and (optionally) real IBM
Quantum hardware.

> **Important framing.** "Multiverse alignment" is used here as a metaphor for
> *coherent quantum phase relationships and the interference patterns they
> produce*. This suite does **not** test, prove, or disprove literal parallel
> universes or the many-worlds interpretation. See [What this is **not**](#what-this-is-not).

## What is being tested

| # | Experiment | What it probes |
|---|---|---|
| 1 | Phase alignment / interference | `|0> → H → RZ(θ) → H → Measure`. Sweeps θ ∈ {0, π/8, π/4, π/2, 3π/4, π}. Ideal `p(0) = cos²(θ/2)`. |
| 2 | Observation collapse | Compares `H · H` (no mid-circuit measurement) against `H · Measure · H · Measure`. Mid-circuit measurement should destroy interference and push the final readout toward 50/50. |
| 3 | Decoherence vs. depth | `|0> → H → (X X)ⁿ → H → Measure` with n ∈ {0, 1, 2, 4, 8, 16, 32, 64}. Each `X X` is logical identity, so the ideal output is `p(0) = 1` for all n; any drift is gate noise + decoherence. |

## Setup

```bash
git clone <this repo>
cd quantum_alignment

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

`qiskit-ibm-runtime` is listed in `requirements.txt` for completeness, but the
ideal and noisy modes only need `qiskit`, `qiskit-aer`, `matplotlib`, and
`numpy`. The runtime package is imported lazily, only when you ask for
`--mode real`.

## Running

All three modes write the same artifacts to `./results/`:

- `results.csv` — one row per (experiment, parameter) with raw probabilities and error
- `phase_alignment_plot.png` — Experiment 1 plot
- `noise_depth_plot.png` — Experiment 3 plot
- `report.md` — plain-English explanation of what the data shows

### Ideal local simulator (no token required)

```bash
python quantum_alignment_tests.py --mode ideal --shots 4096
```

### Noisy simulator (no token required)

Uses `qiskit_aer.AerSimulator.from_backend(GenericBackendV2(...))` so that a
realistic noise model is applied without contacting IBM:

```bash
python quantum_alignment_tests.py --mode noisy --shots 4096
```

### Real IBM Quantum hardware

You need an IBM Quantum account and an API token. **Never hard-code the
token** and never commit it to git. The script reads it from the
`IBM_QUANTUM_TOKEN` environment variable.

Recommended ways to set it safely:

```bash
# Option A: prompt yourself, do not echo, do not store in shell history
read -s IBM_QUANTUM_TOKEN
export IBM_QUANTUM_TOKEN
python quantum_alignment_tests.py --mode real

# Option B: a per-project .envrc loaded by direnv (add .envrc to .gitignore!)
echo 'export IBM_QUANTUM_TOKEN="$(security find-generic-password -s ibm-quantum -w)"' > .envrc
direnv allow

# Option C: a system keyring / secret manager (1Password, macOS Keychain, etc.)
export IBM_QUANTUM_TOKEN="$(op read 'op://Personal/IBM Quantum/credential')"
python quantum_alignment_tests.py --mode real
```

To pin a specific backend (otherwise the script uses `least_busy`):

```bash
python quantum_alignment_tests.py --mode real --backend ibm_brisbane
```

If your selected backend does not support mid-circuit measurement, pass
`--skip-observation` and run Experiment 2 separately on the simulator. The
script also gracefully records a "skipped" row in `results.csv` for any
mid-measure circuit it could not execute.

## CLI reference

```
--mode {ideal,noisy,real}   execution backend (default: ideal)
--backend NAME              real-mode backend name (default: least_busy)
--shots N                   shots per circuit (default: 4096)
--seed N                    deterministic seed for noisy mode (default: 42)
--out PATH                  output directory (default: ./results)
--skip-observation          skip Experiment 2 (for backends with no mid-circuit measure)
```

## What this is **not**

- **Not a test of literal parallel universes.** Quantum mechanics is
  interpretation-agnostic; no single-qubit experiment can settle the
  many-worlds vs. Copenhagen vs. relational debate.
- **Not a hardware benchmark.** A handful of circuits at a few thousand shots
  cannot replace published quantum-volume / EPLG / RB numbers.
- **Not a randomness or cryptographic source.** The bits returned here are
  experimental data, not certified entropy.

## What this **is**

- A small, reproducible demo that quantum amplitudes have phase, that those
  phases interfere, that observation destroys interference, and that real
  hardware loses coherence as circuit depth grows.
- A scaffold you can extend with more circuits (entanglement, GHZ, Bell
  inequality, randomized benchmarking, …) using the same backend / CSV /
  report scaffolding.

## Security notes

- The token is **only** read from `IBM_QUANTUM_TOKEN` at runtime. The script
  does not log it, does not write it to disk, and does not include it in any
  output file or plot.
- `requirements.txt` pins minimum versions but does not freeze; in a
  production setting you should `pip freeze > requirements.lock` and check the
  lock file in.
