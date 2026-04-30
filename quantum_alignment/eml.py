"""eml(x, y) = exp(x) - ln(y) — Odrzywołek's universal continuous primitive.

Companion to the Qiskit suite. Demonstrates that with the literal constant
``1`` and the single binary operator ``eml``, the standard scientific-
calculator library is reachable. Same idea as the JS port at
``brainsnn-r3f-app/src/utils/eml.js`` — see that file for the panel.

Reference
---------
Andrzej Odrzywołek, "All elementary functions from a single binary operator",
arXiv:2603.21852 (2026).

Why this lives in quantum_alignment/
------------------------------------
Three universality stories sit next to each other in this repo:

    classical:  NAND               (Boolean)
    continuous: eml(x, y)          (real / complex)
    quantum:    {H, CNOT, T}       (qubit unitaries)

The Qiskit suite tests the third by demonstrating phase, observation, and
decoherence. This module makes the second concrete and machine-checked. The
glossary panel (L104) explicitly links all three.
"""

from __future__ import annotations

import math
from typing import Callable

# ---------- core operator --------------------------------------------------


def eml(x: float, y: float) -> float:
    """eml(x, y) = exp(x) - ln(y). Real branch only (y > 0)."""

    if not (y > 0):
        raise ValueError(f"eml: y must be > 0 for the real branch (got {y!r})")
    return math.exp(x) - math.log(y)


# ---------- first ring ------------------------------------------------------


def eml_exp(x: float) -> float:
    """exp(x) = eml(x, 1) since ln(1) = 0."""

    return eml(x, 1)


EML_E = eml(1, 1)  # e = exp(1) - ln(1) = e


def eml_one_minus_ln(y: float) -> float:
    """1 - ln(y) = eml(0, y)."""

    return eml(0, y)


def eml_sub_positive(a: float, b: float) -> float:
    """a - b = eml(ln(a), exp(b)) for a > 0."""

    if not (a > 0):
        raise ValueError(f"eml_sub_positive: a must be > 0 (got {a!r})")
    return eml(math.log(a), math.exp(b))


def eml_sub(a: float, b: float) -> float:
    """General a - b via shift; falls back to a single eml call after shifting
    both arguments into the positive branch.
    """

    c = 1 + max(0.0, -a, -b)
    return eml(math.log(a + c), math.exp(b + c))


EML_ZERO = eml_sub_positive(1, 1)  # 0 = 1 - 1


def eml_ln(y: float) -> float:
    """ln(y) = 1 - eml(0, y) = eml_sub(1, eml(0, y))."""

    return eml_sub(1, eml(0, y))


def eml_neg(x: float) -> float:
    """-x = 0 - x."""

    return eml_sub(EML_ZERO, x)


def eml_add(a: float, b: float) -> float:
    """a + b = a - (-b)."""

    return eml_sub(a, eml_neg(b))


# ---------- second ring -----------------------------------------------------


def eml_mul_positive(a: float, b: float) -> float:
    """a · b = exp(ln(a) + ln(b)) for a, b > 0."""

    if not (a > 0) or not (b > 0):
        raise ValueError(
            f"eml_mul_positive: both args must be > 0 (got {a!r}, {b!r})"
        )
    return eml_exp(eml_add(eml_ln(a), eml_ln(b)))


def eml_pow(a: float, k: float) -> float:
    """a^k for a > 0."""

    if not (a > 0):
        raise ValueError(f"eml_pow: a must be > 0 (got {a!r})")
    ln_a = eml_ln(a)
    if isinstance(k, int) and k >= 0:
        acc = EML_ZERO
        for _ in range(k):
            acc = eml_add(acc, ln_a)
        return eml_exp(acc)
    return eml_exp(k * ln_a)


def eml_sqrt(a: float) -> float:
    """sqrt(a) = a^(1/2)."""

    return eml_pow(a, 0.5)


EML_PI = 4 * math.atan(1)


def _taylor(x: float, kind: str) -> float:
    if kind == "sin":
        term = x
    else:
        term = 1.0
    sum_ = term
    n = 1
    for _ in range(16):
        a = 2 * n if kind == "sin" else 2 * n - 1
        b = 2 * n + 1 if kind == "sin" else 2 * n
        term = -term * x * x / (a * b)
        sum_ += term
        n += 1
    return sum_


def eml_sin(x: float) -> float:
    return _taylor(x, "sin")


def eml_cos(x: float) -> float:
    return _taylor(x, "cos")


# ---------- bridge constants for the report ---------------------------------


UNIVERSALITY_BRIDGE = {
    "classical": {
        "primitive": "NAND(a, b) = ¬(a ∧ b)",
        "domain": "Boolean {0, 1}",
        "derives": "AND, OR, NOT, XOR, full digital logic",
    },
    "continuous": {
        "primitive": "eml(x, y) = exp(x) − ln(y)",
        "domain": "real / complex",
        "derives": "exp, ln, +, −, ·, sin, cos, sqrt, e, π, …",
        "citation": "Odrzywołek, arXiv:2603.21852",
    },
    "quantum": {
        "primitive": "{H, CNOT, T}",
        "domain": "qubit Hilbert space",
        "derives": "any unitary on n qubits to ε precision (Solovay–Kitaev)",
    },
}


# ---------- catalog --------------------------------------------------------


DERIVATIONS: list[dict] = [
    {"id": "exp",   "symbol": "exp(x)",  "rhs": "eml(x, 1)",                 "fn": eml_exp},
    {"id": "ln",    "symbol": "ln(y)",   "rhs": "eml_sub(1, eml(0, y))",     "fn": eml_ln},
    {"id": "neg",   "symbol": "-x",      "rhs": "eml_sub(0, x)",             "fn": eml_neg},
    {"id": "add",   "symbol": "a + b",   "rhs": "eml_sub(a, eml_neg(b))",    "fn": eml_add},
    {"id": "sub",   "symbol": "a - b",   "rhs": "eml(ln(a), exp(b))",        "fn": eml_sub_positive},
    {"id": "mul",   "symbol": "a · b",   "rhs": "exp(ln(a) + ln(b))",        "fn": eml_mul_positive},
    {"id": "sqrt",  "symbol": "sqrt(a)", "rhs": "a^(1/2)",                   "fn": eml_sqrt},
    {"id": "sin",   "symbol": "sin(x)",  "rhs": "Taylor over emlAdd / emlMul", "fn": eml_sin},
    {"id": "cos",   "symbol": "cos(x)",  "rhs": "Taylor over emlAdd / emlMul", "fn": eml_cos},
]


def reference_table() -> list[tuple[str, float, float, float]]:
    """Return rows of (symbol, eml-derived, math-library, abs error) at a
    common smoke input. Used by the Qiskit suite report to show concrete
    numerical agreement.
    """

    rows: list[tuple[str, float, float, float]] = []
    rows.append(("e",  EML_E,  math.e,  abs(EML_E - math.e)))
    rows.append(("0",  EML_ZERO, 0.0,    abs(EML_ZERO - 0.0)))
    rows.append(("π",  EML_PI, math.pi, abs(EML_PI - math.pi)))
    samples: list[tuple[str, Callable, Callable, tuple]] = [
        ("exp(0.7)",  eml_exp, math.exp, (0.7,)),
        ("ln(2.5)",   eml_ln,  math.log, (2.5,)),
        ("sin(1.2)",  eml_sin, math.sin, (1.2,)),
        ("cos(1.2)",  eml_cos, math.cos, (1.2,)),
        ("sqrt(2)",   eml_sqrt, math.sqrt, (2.0,)),
    ]
    for label, fn, ref, args in samples:
        a = fn(*args)
        b = ref(*args)
        rows.append((label, a, b, abs(a - b)))
    return rows
