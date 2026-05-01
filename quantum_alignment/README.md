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
| 4 | Bell-pair correlation | `|00> → H ⊗ I → CNOT(0,1) → RY(θ) on q0 → measure both`. Sweeps θ ∈ {0, π/4, π/2, 3π/4, π}. Ideal signed correlation `E(θ) = (P00+P11) − (P01+P10) = cos(θ)`. Hardware-grade sibling of the L102 browser-native Bell Pair Lab. |

## eml — universal continuous primitive

`eml.py` and `test_eml.py` ship Odrzywołek's single binary operator
`eml(x, y) = exp(x) − ln(y)` (arXiv:2603.21852). With the constant `1` it
generates the elementary library (`exp`, `ln`, `+`, `−`, `·`, `sin`,
`cos`, `√`, `e`, `π`, …). It sits next to the Qiskit suite because the
same "one primitive, all the math" idea links three universality stories:

| layer       | primitive                       | derives                            |
|-------------|---------------------------------|------------------------------------|
| classical   | `NAND(a, b)`                    | full Boolean logic                 |
| continuous  | `eml(x, y) = exp(x) − ln(y)`    | scientific calculator              |
| quantum     | `{H, CNOT, T}`                  | any unitary on n qubits (Solovay–Kitaev) |

The browser-native Layer 105 panel renders the same content as a live
calculator side-by-side with `Math.*`, with the eml composition tree
visible.

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

All three modes write the same four artifacts to `./results/<mode>/`:

- `results.csv` — one row per (experiment, parameter) with raw probabilities and error
- `phase_alignment_plot.png` — Experiment 1 plot
- `noise_depth_plot.png` — Experiment 3 plot
- `report.md` — plain-English explanation of what the data shows (now includes Experiment 4)

Pre-generated artifacts checked in for both `--mode ideal` (`results/ideal/`)
and `--mode noisy` (`results/noisy/`). `--mode real` is run by the user
against a live IBM account; nothing from a real-hardware run is checked
in.

### Ideal local simulator (no token required)

```bash
python quantum_alignment_tests.py --mode ideal --shots 4096 --out results/ideal
```

### Tests

```bash
python -m pytest -q                # fast lane (~3s, no AerSimulator round-trip)
python -m pytest -q -m slow        # slow lane: end-to-end ideal smoke
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
--skip-bell                 skip Experiment 4 (Bell-pair sweep)
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
- `requirements.txt` pins minimum versions for development convenience.
  For reproducible CI / hardware runs, `pip install -r requirements.lock`
  uses a frozen 2026-04-30 snapshot.
