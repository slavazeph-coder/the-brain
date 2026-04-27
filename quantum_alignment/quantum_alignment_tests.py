"""Quantum alignment test suite.

Runs three experiments that probe the *physical* meaning of "alignment" in a
quantum computer:

1. Phase alignment / interference  (single-qubit Mach-Zehnder via H-RZ-H)
2. Observation collapse            (measurement in the middle of a circuit)
3. Decoherence / noise accumulation (deepening identity-equivalent X-X chains)

This is *not* a test of literal parallel universes. "Multiverse alignment" is
treated here as a metaphor for coherent quantum phase relationships and the
interference patterns they produce.

Three execution modes are supported:

    --mode ideal   AerSimulator with no noise.
    --mode noisy   AerSimulator with a noise model derived from a synthetic
                   IBM-like fake backend (no IBM account or token required).
    --mode real    Real IBM Quantum hardware via qiskit-ibm-runtime. Requires
                   the IBM_QUANTUM_TOKEN environment variable.

Outputs (under --out, default ./results):

    results.csv               raw counts and probabilities for every shot batch
    phase_alignment_plot.png  p(0)/p(1)/error vs theta (Experiment 1)
    noise_depth_plot.png      p(0)/p(1)/error vs X-X depth (Experiment 3)
    report.md                 plain-English summary of what the data shows
"""

from __future__ import annotations

import argparse
import csv
import math
import os
import sys
from dataclasses import dataclass, field
from typing import Callable, Iterable

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from qiskit import QuantumCircuit, transpile
from qiskit_aer import AerSimulator


# ---------------------------------------------------------------------------
# Backend selection
# ---------------------------------------------------------------------------


@dataclass
class Backend:
    """Bundle of (label, sampler) used by the rest of the script."""

    label: str
    mode: str
    run: Callable[[QuantumCircuit, int], dict[str, int]]
    supports_mid_measure: bool = True
    notes: list[str] = field(default_factory=list)


def make_ideal_backend() -> Backend:
    sim = AerSimulator()

    def run(circuit: QuantumCircuit, shots: int) -> dict[str, int]:
        tqc = transpile(circuit, sim)
        result = sim.run(tqc, shots=shots).result()
        return result.get_counts()

    return Backend(label="aer-ideal", mode="ideal", run=run)


def make_noisy_backend(seed: int = 42) -> Backend:
    """Noisy AerSimulator built from a synthetic IBM-like fake backend.

    We use ``qiskit.providers.fake_provider.GenericBackendV2`` because it ships
    with qiskit core and does not require ``qiskit-ibm-runtime`` (which would
    in turn require the IBM cloud SDK). ``AerSimulator.from_backend`` extracts
    a noise model from the fake backend's calibration data.
    """

    from qiskit.providers.fake_provider import GenericBackendV2

    fake = GenericBackendV2(num_qubits=5, seed=seed)
    sim = AerSimulator.from_backend(fake)

    def run(circuit: QuantumCircuit, shots: int) -> dict[str, int]:
        tqc = transpile(circuit, sim, optimization_level=0, seed_transpiler=seed)
        result = sim.run(tqc, shots=shots).result()
        return result.get_counts()

    return Backend(
        label=f"aer-noisy({fake.name})",
        mode="noisy",
        run=run,
        notes=[
            "Noise model derived from synthetic fake backend "
            f"{fake.name!r} (qiskit GenericBackendV2).",
        ],
    )


def make_real_backend(token: str, backend_name: str | None) -> Backend:
    """Real IBM Quantum backend via qiskit-ibm-runtime.

    ``token`` is *only* used to instantiate the service; it is never logged or
    written to disk by this script.
    """

    # Lazy import: keeps simulator-only runs working even if qiskit-ibm-runtime
    # (and its IBM cloud SDK dependency tree) is not importable.
    from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2

    service = QiskitRuntimeService(channel="ibm_quantum", token=token)
    if backend_name:
        backend = service.backend(backend_name)
    else:
        backend = service.least_busy(operational=True, simulator=False)

    sampler = SamplerV2(mode=backend)

    def run(circuit: QuantumCircuit, shots: int) -> dict[str, int]:
        tqc = transpile(circuit, backend=backend, optimization_level=1)
        job = sampler.run([tqc], shots=shots)
        result = job.result()
        # SamplerV2 result -> per-circuit PubResult; default classical register
        # is named "meas" when QuantumCircuit.measure_all is used and "c" when
        # we declared the register ourselves below.
        pub = result[0]
        data = pub.data
        register_name = next(iter(data.__dict__)) if hasattr(data, "__dict__") else "c"
        bit_array = getattr(data, register_name)
        return bit_array.get_counts()

    return Backend(
        label=f"ibm-real({backend.name})",
        mode="real",
        run=run,
        # Most modern IBM backends support mid-circuit measurement, but
        # individual devices vary. Caller can override via CLI if needed.
        supports_mid_measure=True,
        notes=[f"Running on IBM backend {backend.name!r}."],
    )


# ---------------------------------------------------------------------------
# Circuit builders
# ---------------------------------------------------------------------------


def phase_circuit(theta: float) -> QuantumCircuit:
    """|0> -> H -> RZ(theta) -> H -> Measure."""
    qc = QuantumCircuit(1, 1, name=f"phase_{theta:.4f}")
    qc.h(0)
    qc.rz(theta, 0)
    qc.h(0)
    qc.measure(0, 0)
    return qc


def observation_circuit_a() -> QuantumCircuit:
    """A: |0> -> H -> H -> Measure   (no mid-circuit observation)."""
    qc = QuantumCircuit(1, 1, name="obs_A")
    qc.h(0)
    qc.h(0)
    qc.measure(0, 0)
    return qc


def observation_circuit_b() -> QuantumCircuit:
    """B: |0> -> H -> Measure -> H -> Measure (mid-circuit collapse)."""
    qc = QuantumCircuit(1, 2, name="obs_B")
    qc.h(0)
    qc.measure(0, 0)  # collapse
    qc.h(0)
    qc.measure(0, 1)  # final readout
    return qc


def noise_depth_circuit(num_xx_pairs: int) -> QuantumCircuit:
    """|0> -> H -> (X X) * n -> H -> Measure.

    Each X-X pair is the identity, so the *ideal* output is always |0>. Any
    drift away from p(0)=1 on real or noisy hardware is gate noise + decoherence.
    """
    qc = QuantumCircuit(1, 1, name=f"noise_{num_xx_pairs}")
    qc.h(0)
    for _ in range(num_xx_pairs):
        qc.x(0)
        qc.x(0)
        qc.barrier()
    qc.h(0)
    qc.measure(0, 0)
    return qc


# ---------------------------------------------------------------------------
# Counts analysis
# ---------------------------------------------------------------------------


def _last_bit_counts(counts: dict[str, int]) -> tuple[int, int]:
    """Sum counts of the *final* classical bit (Qiskit prints little-endian).

    For circuit B (two classical bits) only the second measurement is the
    "after re-prepared superposition" outcome -- that's the bit we care about.
    """
    zeros = 0
    ones = 0
    for bitstring, count in counts.items():
        # strip any spaces inserted between registers
        stripped = bitstring.replace(" ", "")
        # leftmost char in qiskit's printed string is the highest-index bit;
        # the *final* measurement of obs_B writes bit index 1, which is the
        # leftmost char. For single-bit circuits both ends agree.
        bit = stripped[0]
        if bit == "0":
            zeros += count
        else:
            ones += count
    return zeros, ones


def _first_bit_counts(counts: dict[str, int]) -> tuple[int, int]:
    zeros = 0
    ones = 0
    for bitstring, count in counts.items():
        stripped = bitstring.replace(" ", "")
        bit = stripped[-1]
        if bit == "0":
            zeros += count
        else:
            ones += count
    return zeros, ones


def probabilities(zeros: int, ones: int) -> tuple[float, float]:
    total = zeros + ones
    if total == 0:
        return 0.0, 0.0
    return zeros / total, ones / total


# ---------------------------------------------------------------------------
# Experiments
# ---------------------------------------------------------------------------


THETAS: list[tuple[str, float]] = [
    ("0", 0.0),
    ("pi/8", math.pi / 8),
    ("pi/4", math.pi / 4),
    ("pi/2", math.pi / 2),
    ("3pi/4", 3 * math.pi / 4),
    ("pi", math.pi),
]

NOISE_DEPTHS: list[int] = [0, 1, 2, 4, 8, 16, 32, 64]


@dataclass
class Row:
    experiment: str
    backend_label: str
    mode: str
    label: str
    parameter: float
    shots: int
    p0: float
    p1: float
    expected_p0: float
    error: float
    notes: str = ""


def run_phase_experiment(backend: Backend, shots: int) -> list[Row]:
    rows: list[Row] = []
    for name, theta in THETAS:
        # ideal probability of measuring 0 for H-RZ(theta)-H is cos(theta/2)^2
        expected_p0 = math.cos(theta / 2.0) ** 2
        counts = backend.run(phase_circuit(theta), shots)
        zeros, ones = _first_bit_counts(counts)
        p0, p1 = probabilities(zeros, ones)
        rows.append(
            Row(
                experiment="phase_alignment",
                backend_label=backend.label,
                mode=backend.mode,
                label=name,
                parameter=theta,
                shots=shots,
                p0=p0,
                p1=p1,
                expected_p0=expected_p0,
                error=abs(p0 - expected_p0),
            )
        )
    return rows


def run_observation_experiment(backend: Backend, shots: int) -> list[Row]:
    rows: list[Row] = []

    counts_a = backend.run(observation_circuit_a(), shots)
    zeros_a, ones_a = _first_bit_counts(counts_a)
    p0_a, p1_a = probabilities(zeros_a, ones_a)
    rows.append(
        Row(
            experiment="observation",
            backend_label=backend.label,
            mode=backend.mode,
            label="A_no_mid_measure",
            parameter=0,
            shots=shots,
            p0=p0_a,
            p1=p1_a,
            expected_p0=1.0,  # H H = I
            error=abs(p0_a - 1.0),
            notes="H then H -> identity, expect p(0)=1",
        )
    )

    if not backend.supports_mid_measure:
        rows.append(
            Row(
                experiment="observation",
                backend_label=backend.label,
                mode=backend.mode,
                label="B_mid_measure",
                parameter=0,
                shots=shots,
                p0=float("nan"),
                p1=float("nan"),
                expected_p0=0.5,
                error=float("nan"),
                notes=(
                    "Skipped: selected backend does not support mid-circuit "
                    "measurement. Run in --mode ideal or --mode noisy to see B."
                ),
            )
        )
        return rows

    counts_b = backend.run(observation_circuit_b(), shots)
    zeros_b, ones_b = _last_bit_counts(counts_b)
    p0_b, p1_b = probabilities(zeros_b, ones_b)
    rows.append(
        Row(
            experiment="observation",
            backend_label=backend.label,
            mode=backend.mode,
            label="B_mid_measure",
            parameter=0,
            shots=shots,
            p0=p0_b,
            p1=p1_b,
            expected_p0=0.5,  # collapse erases interference
            error=abs(p0_b - 0.5),
            notes="Mid-circuit measurement collapses the state; expect ~50/50",
        )
    )
    return rows


def run_noise_depth_experiment(backend: Backend, shots: int) -> list[Row]:
    rows: list[Row] = []
    for depth in NOISE_DEPTHS:
        counts = backend.run(noise_depth_circuit(depth), shots)
        zeros, ones = _first_bit_counts(counts)
        p0, p1 = probabilities(zeros, ones)
        # H (XX)^n H |0> = |0> ideally, regardless of n
        rows.append(
            Row(
                experiment="noise_depth",
                backend_label=backend.label,
                mode=backend.mode,
                label=f"xx_pairs={depth}",
                parameter=depth,
                shots=shots,
                p0=p0,
                p1=p1,
                expected_p0=1.0,
                error=abs(p0 - 1.0),
            )
        )
    return rows


# ---------------------------------------------------------------------------
# Persistence + plots + report
# ---------------------------------------------------------------------------


CSV_FIELDS = [
    "experiment",
    "backend_label",
    "mode",
    "label",
    "parameter",
    "shots",
    "p0",
    "p1",
    "expected_p0",
    "error",
    "notes",
]


def write_csv(rows: Iterable[Row], path: str) -> None:
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: getattr(row, k) for k in CSV_FIELDS})


def plot_phase(rows: list[Row], path: str, backend_label: str) -> None:
    phase_rows = [r for r in rows if r.experiment == "phase_alignment"]
    if not phase_rows:
        return
    thetas = [r.parameter for r in phase_rows]
    p0 = [r.p0 for r in phase_rows]
    p1 = [r.p1 for r in phase_rows]
    err = [r.error for r in phase_rows]
    expected = [r.expected_p0 for r in phase_rows]

    fig, ax = plt.subplots(figsize=(8, 5))
    ax.plot(thetas, p0, marker="o", label="p(0) measured")
    ax.plot(thetas, p1, marker="o", label="p(1) measured")
    ax.plot(thetas, expected, linestyle="--", label="p(0) ideal = cos^2(theta/2)")
    ax.plot(thetas, err, marker="x", label="|p(0) - ideal|")
    ax.set_xlabel("theta (radians)")
    ax.set_ylabel("probability")
    ax.set_title(f"Experiment 1: Phase alignment / interference  ({backend_label})")
    ax.set_xticks(thetas)
    ax.set_xticklabels([r.label for r in phase_rows])
    ax.set_ylim(-0.05, 1.05)
    ax.grid(True, alpha=0.3)
    ax.legend(loc="center right")
    fig.tight_layout()
    fig.savefig(path, dpi=140)
    plt.close(fig)


def plot_noise_depth(rows: list[Row], path: str, backend_label: str) -> None:
    depth_rows = [r for r in rows if r.experiment == "noise_depth"]
    if not depth_rows:
        return
    depths = [r.parameter for r in depth_rows]
    p0 = [r.p0 for r in depth_rows]
    p1 = [r.p1 for r in depth_rows]
    err = [r.error for r in depth_rows]

    fig, ax = plt.subplots(figsize=(8, 5))
    ax.plot(depths, p0, marker="o", label="p(0) measured")
    ax.plot(depths, p1, marker="o", label="p(1) measured")
    ax.plot(depths, err, marker="x", label="error = 1 - p(0)")
    ax.axhline(1.0, linestyle="--", alpha=0.5, label="ideal p(0)=1")
    ax.set_xscale("symlog", linthresh=1)
    ax.set_xlabel("number of X-X pairs (logical identity, real depth grows)")
    ax.set_ylabel("probability")
    ax.set_title(f"Experiment 3: Decoherence vs depth  ({backend_label})")
    ax.set_ylim(-0.05, 1.05)
    ax.grid(True, alpha=0.3, which="both")
    ax.legend(loc="center right")
    fig.tight_layout()
    fig.savefig(path, dpi=140)
    plt.close(fig)


def write_report(rows: list[Row], path: str, backend: Backend, shots: int) -> None:
    phase_rows = [r for r in rows if r.experiment == "phase_alignment"]
    obs_rows = [r for r in rows if r.experiment == "observation"]
    depth_rows = [r for r in rows if r.experiment == "noise_depth"]

    def fmt(p: float) -> str:
        if p != p:  # NaN
            return "n/a"
        return f"{p:.3f}"

    lines: list[str] = []
    lines.append("# Quantum Alignment Test Report")
    lines.append("")
    lines.append(f"- Backend: `{backend.label}`")
    lines.append(f"- Mode: `{backend.mode}`")
    lines.append(f"- Shots per circuit: {shots}")
    if backend.notes:
        lines.append("- Backend notes:")
        for note in backend.notes:
            lines.append(f"  - {note}")
    lines.append("")
    lines.append("## What this report tests")
    lines.append("")
    lines.append(
        "This suite probes three *physical* properties of quantum computation: "
        "phase coherence and interference, the effect of measurement on a "
        "superposition, and the accumulation of gate noise / decoherence as "
        "circuit depth grows. \"Multiverse alignment\" is used here as a "
        "metaphor for the coherent phase relationships that produce "
        "interference -- it is **not** a literal claim about parallel "
        "universes, and nothing here can prove or disprove the many-worlds "
        "interpretation."
    )
    lines.append("")

    # Experiment 1
    lines.append("## Experiment 1 -- Phase alignment / interference")
    lines.append("")
    lines.append(
        "Circuit: `|0> - H - RZ(theta) - H - Measure`. The first H spreads "
        "|0> into an equal superposition; RZ(theta) puts a relative phase "
        "between the two branches; the second H lets those branches "
        "interfere. The ideal outcome is `p(0) = cos^2(theta/2)`."
    )
    lines.append("")
    lines.append("| theta | p(0) measured | p(1) measured | p(0) ideal | |error| |")
    lines.append("|---|---|---|---|---|")
    for r in phase_rows:
        lines.append(
            f"| {r.label} | {fmt(r.p0)} | {fmt(r.p1)} | "
            f"{fmt(r.expected_p0)} | {fmt(r.error)} |"
        )
    lines.append("")
    if phase_rows:
        max_err = max(r.error for r in phase_rows)
        lines.append(
            f"Maximum deviation from the ideal interference pattern: "
            f"**{max_err:.3f}**. "
            f"On the ideal simulator this should be at the level of shot noise "
            f"(~1/sqrt(shots) ~= {1.0 / math.sqrt(shots):.3f}). On a noisy or "
            f"real backend it grows because gate errors and readout errors "
            f"smear the interference fringes."
        )
    lines.append("")

    # Experiment 2
    lines.append("## Experiment 2 -- Observation collapse")
    lines.append("")
    lines.append(
        "Two circuits are compared. **A** applies H then H with no measurement "
        "in between: H is its own inverse, so the qubit returns to |0> and we "
        "expect `p(0) = 1`. **B** measures *between* the two H gates. That "
        "mid-circuit measurement collapses the superposition to a definite "
        "|0> or |1>; the second H then turns whichever basis state we have "
        "into a fresh equal superposition, so the final readout is ~50/50. "
        "If A is near 1.0 and B is near 0.5, observation has demonstrably "
        "destroyed interference."
    )
    lines.append("")
    lines.append("| variant | p(0) | p(1) | expected p(0) | |error| | notes |")
    lines.append("|---|---|---|---|---|---|")
    for r in obs_rows:
        lines.append(
            f"| {r.label} | {fmt(r.p0)} | {fmt(r.p1)} | "
            f"{fmt(r.expected_p0)} | {fmt(r.error)} | {r.notes} |"
        )
    lines.append("")

    # Experiment 3
    lines.append("## Experiment 3 -- Decoherence / noise accumulation")
    lines.append("")
    lines.append(
        "Circuit: `|0> - H - (X X)^n - H - Measure`. Each `X X` pair is the "
        "identity, so the ideal outcome is always `p(0) = 1` regardless of n. "
        "Any drift toward `p(0) = 0.5` as n grows is *purely* gate noise and "
        "decoherence (T1/T2 relaxation, control errors, readout errors). On "
        "the ideal simulator the line should stay flat at 1.0; on a noisy or "
        "real backend it will sag toward 0.5."
    )
    lines.append("")
    lines.append("| X-X pairs | p(0) | p(1) | error = 1-p(0) |")
    lines.append("|---|---|---|---|")
    for r in depth_rows:
        lines.append(
            f"| {int(r.parameter)} | {fmt(r.p0)} | "
            f"{fmt(r.p1)} | {fmt(r.error)} |"
        )
    lines.append("")
    if depth_rows:
        deepest = depth_rows[-1]
        lines.append(
            f"At depth {int(deepest.parameter)} X-X pairs, p(0) is "
            f"**{fmt(deepest.p0)}** vs the ideal **1.0** "
            f"(error **{fmt(deepest.error)}**). "
            "The further this number is from 1.0, the more decoherence the "
            "device has accumulated over the run."
        )
    lines.append("")

    # Scope / disclaimer
    lines.append("## What this is NOT")
    lines.append("")
    lines.append(
        "- Not a test of literal parallel universes or the many-worlds "
        "interpretation. Quantum mechanics is interpretation-agnostic and "
        "no single-qubit experiment can settle that debate."
    )
    lines.append(
        "- Not a benchmark of any specific IBM device. We use a tiny number "
        "of circuits at modest shot counts; published quantum-volume / EPLG "
        "numbers are far more rigorous."
    )
    lines.append(
        "- Not a security or randomness test. Do not use these counts as a "
        "source of cryptographic entropy."
    )
    lines.append("")
    lines.append("## What this IS")
    lines.append("")
    lines.append(
        "- A reproducible demonstration that quantum amplitudes have phase, "
        "that phases interfere, that observation destroys interference, and "
        "that real hardware loses coherence as depth grows."
    )
    lines.append("")

    with open(path, "w") as f:
        f.write("\n".join(lines))


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def select_backend(args: argparse.Namespace) -> Backend:
    if args.mode == "ideal":
        return make_ideal_backend()
    if args.mode == "noisy":
        return make_noisy_backend(seed=args.seed)
    if args.mode == "real":
        token = os.environ.get("IBM_QUANTUM_TOKEN")
        if not token:
            raise SystemExit(
                "IBM_QUANTUM_TOKEN is not set. Export it (without quoting it "
                "into shell history -- prefer `read -s` or a secret manager) "
                "before running with --mode real, or pick --mode ideal/noisy."
            )
        return make_real_backend(token=token, backend_name=args.backend)
    raise SystemExit(f"Unknown mode: {args.mode!r}")


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--mode", choices=["ideal", "noisy", "real"], default="ideal")
    p.add_argument(
        "--backend",
        default=None,
        help="(real mode only) IBM backend name. Defaults to least_busy.",
    )
    p.add_argument("--shots", type=int, default=4096)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument(
        "--out",
        default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "results"),
        help="Output directory for CSV, plots, and report.",
    )
    p.add_argument(
        "--skip-observation",
        action="store_true",
        help="Skip Experiment 2 entirely (e.g., on a backend with no mid-circuit measurement support).",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    os.makedirs(args.out, exist_ok=True)

    backend = select_backend(args)
    np.random.seed(args.seed)

    print(f"[quantum_alignment] backend={backend.label} shots={args.shots}")

    rows: list[Row] = []
    print("[quantum_alignment] running Experiment 1: phase alignment...")
    rows.extend(run_phase_experiment(backend, args.shots))
    if args.skip_observation:
        print("[quantum_alignment] skipping Experiment 2 (per --skip-observation)")
    else:
        print("[quantum_alignment] running Experiment 2: observation collapse...")
        rows.extend(run_observation_experiment(backend, args.shots))
    print("[quantum_alignment] running Experiment 3: noise vs depth...")
    rows.extend(run_noise_depth_experiment(backend, args.shots))

    csv_path = os.path.join(args.out, "results.csv")
    phase_plot = os.path.join(args.out, "phase_alignment_plot.png")
    noise_plot = os.path.join(args.out, "noise_depth_plot.png")
    report_path = os.path.join(args.out, "report.md")

    write_csv(rows, csv_path)
    plot_phase(rows, phase_plot, backend.label)
    plot_noise_depth(rows, noise_plot, backend.label)
    write_report(rows, report_path, backend, args.shots)

    print(f"[quantum_alignment] wrote {csv_path}")
    print(f"[quantum_alignment] wrote {phase_plot}")
    print(f"[quantum_alignment] wrote {noise_plot}")
    print(f"[quantum_alignment] wrote {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
