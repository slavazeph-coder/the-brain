"""nand.py — the Boolean side of the universality bridge.

Companion to ``eml.py``. NAND alone is functionally complete on the
domain {0, 1}: every Boolean function is expressible as a circuit of
NAND gates and constants.

Together with eml (continuous) and {H, CNOT, T} (quantum), this module
makes the three-way story machine-checked from inside the Qiskit suite:

    classical:  NAND
    continuous: eml(x, y) = exp(x) - ln(y)
    quantum:    {H, CNOT, T}
"""

from __future__ import annotations


# ---------- core primitive --------------------------------------------------


def nand(a: int, b: int) -> int:
    return 0 if (a and b) else 1


# ---------- derived gates ---------------------------------------------------


def not_(a: int) -> int:
    """NOT a = NAND(a, a)."""

    return nand(a, a)


def and_(a: int, b: int) -> int:
    """AND(a, b) = NOT(NAND(a, b))."""

    return not_(nand(a, b))


def or_(a: int, b: int) -> int:
    """OR(a, b) = NAND(NOT a, NOT b)."""

    return nand(not_(a), not_(b))


def nor_(a: int, b: int) -> int:
    return not_(or_(a, b))


def xor_(a: int, b: int) -> int:
    """Classic 4-NAND XOR.

        t1 = NAND(a, b)
        t2 = NAND(a, t1)
        t3 = NAND(b, t1)
        y  = NAND(t2, t3)
    """

    t1 = nand(a, b)
    t2 = nand(a, t1)
    t3 = nand(b, t1)
    return nand(t2, t3)


def xnor_(a: int, b: int) -> int:
    return not_(xor_(a, b))


def mux_(sel: int, a: int, b: int) -> int:
    """2-to-1 MUX: returns a if sel == 0, else b."""

    return or_(and_(not_(sel), a), and_(sel, b))


# ---------- catalog --------------------------------------------------------


NAND_DERIVATIONS = [
    {"id": "not", "label": "NOT a", "arity": 1, "fn": not_, "rhs": "NAND(a, a)"},
    {"id": "and", "label": "a AND b", "arity": 2, "fn": and_, "rhs": "NAND(NAND(a, b), NAND(a, b))"},
    {"id": "or", "label": "a OR b", "arity": 2, "fn": or_, "rhs": "NAND(NAND(a, a), NAND(b, b))"},
    {"id": "nor", "label": "a NOR b", "arity": 2, "fn": nor_, "rhs": "NOT(OR(a, b))"},
    {"id": "xor", "label": "a XOR b", "arity": 2, "fn": xor_, "rhs": "4-NAND classic"},
    {"id": "xnor", "label": "a XNOR b", "arity": 2, "fn": xnor_, "rhs": "NOT(XOR(a, b))"},
    {"id": "mux", "label": "MUX(sel, a, b)", "arity": 3, "fn": mux_, "rhs": "OR(AND(NOT sel, a), AND(sel, b))"},
]


# Re-export the canonical bridge data from eml.py so the two modules
# can never drift. nand.py adds nothing the bridge needs that eml.py
# doesn't already carry.
from eml import UNIVERSALITY_BRIDGE  # noqa: E402,F401
