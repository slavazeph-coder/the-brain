"""Pytest harness for the Qiskit alignment suite.

Covers the pure-Python helpers (counts aggregation, probability math,
circuit construction, CSV serialization) and an end-to-end smoke run on
the ideal AerSimulator.

The slow end-to-end test is marked ``@pytest.mark.slow`` so the
fast-feedback loop stays sub-second; run with::

    python -m pytest -q
    python -m pytest -q -m slow            # include the e2e ideal run
"""

from __future__ import annotations

import math
import os
import tempfile

import pytest

import quantum_alignment_tests as qat


# ---------- pure-Python helpers --------------------------------------------


def test_first_bit_counts_single_qubit():
    counts = {"0": 800, "1": 200}
    z, o = qat._first_bit_counts(counts)
    assert (z, o) == (800, 200)


def test_first_bit_counts_with_register_spaces():
    counts = {"0 0": 700, "0 1": 100, "1 0": 50, "1 1": 150}
    # _first_bit_counts looks at the *rightmost* (lowest-index) bit
    z, o = qat._first_bit_counts(counts)
    assert z == 700 + 50, f"expected 750 zeros, got {z}"
    assert o == 100 + 150


def test_last_bit_counts_two_register_string():
    # qiskit prints high bit first; "1 0" means clbit[1]=1, clbit[0]=0
    counts = {"0 0": 500, "1 0": 500}
    z, o = qat._last_bit_counts(counts)
    # last_bit_counts looks at the leftmost char of the stripped string
    assert z == 500
    assert o == 500


def test_joint_2bit_counts():
    counts = {"00": 100, "01": 50, "10": 25, "11": 75}
    out = qat._joint_2bit_counts(counts)
    assert out == {"00": 100, "01": 50, "10": 25, "11": 75}


def test_joint_2bit_counts_with_spaces():
    counts = {"0 0": 100, "0 1": 50, "1 0": 25, "1 1": 75}
    out = qat._joint_2bit_counts(counts)
    assert out == {"00": 100, "01": 50, "10": 25, "11": 75}


def test_probabilities_normalises():
    assert qat.probabilities(800, 200) == (0.8, 0.2)
    assert qat.probabilities(0, 0) == (0.0, 0.0)


# ---------- circuit construction -------------------------------------------


def test_phase_circuit_has_h_rz_h_measure():
    qc = qat.phase_circuit(math.pi / 4)
    names = [op.operation.name for op in qc.data]
    # gate sequence ignoring barriers
    assert names == ["h", "rz", "h", "measure"]


def test_observation_circuit_a_is_hh_measure():
    qc = qat.observation_circuit_a()
    names = [op.operation.name for op in qc.data]
    assert names == ["h", "h", "measure"]


def test_observation_circuit_b_has_mid_circuit_measure():
    qc = qat.observation_circuit_b()
    names = [op.operation.name for op in qc.data]
    # H, measure, H, measure
    assert names == ["h", "measure", "h", "measure"]


def test_noise_depth_circuit_has_2n_x_gates():
    qc = qat.noise_depth_circuit(3)
    names = [op.operation.name for op in qc.data if op.operation.name != "barrier"]
    # H, x, x, x, x, x, x, H, measure  (3 pairs = 6 X)
    assert names.count("x") == 6
    assert names[0] == "h"
    assert names[-1] == "measure"


def test_bell_circuit_has_h_cx_measure():
    qc = qat.bell_circuit(0.0)
    names = [op.operation.name for op in qc.data]
    # H on qubit 0, CNOT(0,1), measure both
    assert names == ["h", "cx", "measure", "measure"]


def test_bell_circuit_with_theta_includes_ry():
    qc = qat.bell_circuit(math.pi / 4)
    names = [op.operation.name for op in qc.data]
    assert names == ["h", "cx", "ry", "measure", "measure"]


# ---------- Row + CSV ------------------------------------------------------


def test_csv_round_trip(tmp_path):
    rows = [
        qat.Row(
            experiment="phase_alignment",
            backend_label="aer-ideal",
            mode="ideal",
            label="0",
            parameter=0.0,
            shots=1024,
            p0=1.0,
            p1=0.0,
            expected_p0=1.0,
            error=0.0,
        )
    ]
    p = tmp_path / "results.csv"
    qat.write_csv(rows, str(p))
    body = p.read_text()
    assert body.startswith(",".join(qat.CSV_FIELDS))
    assert "phase_alignment" in body
    assert "1024" in body


# ---------- end-to-end ideal smoke -----------------------------------------


@pytest.mark.slow
def test_ideal_end_to_end(tmp_path):
    """Run all 4 experiments on the ideal AerSimulator at low shots and assert
    the closed-form predictions hold within shot noise.
    """

    backend = qat.make_ideal_backend()
    shots = 2048

    phase_rows = qat.run_phase_experiment(backend, shots)
    obs_rows = qat.run_observation_experiment(backend, shots)
    depth_rows = qat.run_noise_depth_experiment(backend, shots)
    bell_rows = qat.run_bell_experiment(backend, shots)

    # Phase: max error should be ~ shot noise
    max_phase_err = max(r.error for r in phase_rows)
    assert max_phase_err < 0.05, f"phase err {max_phase_err}"

    # Observation: A near 1.0, B near 0.5
    a = next(r for r in obs_rows if r.label == "A_no_mid_measure")
    b = next(r for r in obs_rows if r.label == "B_mid_measure")
    assert abs(a.p0 - 1.0) < 0.05
    assert abs(b.p0 - 0.5) < 0.05

    # Noise depth: ideal sim should keep p(0) ≈ 1 even at depth 64
    deepest = depth_rows[-1]
    assert deepest.p0 > 0.95

    # Bell: at theta=0 correlation is +1, at theta=pi it is -1
    corr_rows = {r.label: r for r in bell_rows if r.label.endswith("|corr")}
    assert corr_rows["0|corr"].p0 > 0.95
    assert corr_rows["pi|corr"].p0 < -0.95


def test_select_backend_rejects_real_without_token(monkeypatch):
    monkeypatch.delenv("IBM_QUANTUM_TOKEN", raising=False)
    args = qat.parse_args(["--mode", "real"])
    with pytest.raises(SystemExit):
        qat.select_backend(args)


def test_parse_args_defaults():
    args = qat.parse_args([])
    assert args.mode == "ideal"
    assert args.shots == 4096
    assert args.skip_observation is False
    assert args.skip_bell is False


def test_parse_args_skip_flags():
    args = qat.parse_args(["--skip-observation", "--skip-bell"])
    assert args.skip_observation is True
    assert args.skip_bell is True
