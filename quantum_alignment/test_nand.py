"""Pytest for the NAND port + cross-bridge consistency with eml.py."""

import pytest

from nand import (
    NAND_DERIVATIONS,
    UNIVERSALITY_BRIDGE,
    and_,
    mux_,
    nand,
    nor_,
    not_,
    or_,
    xnor_,
    xor_,
)


def py_not(a):
    return 0 if a else 1


def py_and(a, b):
    return 1 if a and b else 0


def py_or(a, b):
    return 1 if a or b else 0


def py_nor(a, b):
    return 0 if a or b else 1


def py_xor(a, b):
    return 1 if (a ^ b) else 0


def py_xnor(a, b):
    return 0 if (a ^ b) else 1


def py_mux(sel, a, b):
    return b if sel else a


def test_nand_truth_table():
    assert nand(0, 0) == 1
    assert nand(0, 1) == 1
    assert nand(1, 0) == 1
    assert nand(1, 1) == 0


@pytest.mark.parametrize("a", [0, 1])
def test_not_matches_python(a):
    assert not_(a) == py_not(a)


@pytest.mark.parametrize("a, b", [(0, 0), (0, 1), (1, 0), (1, 1)])
def test_and_or_nor(a, b):
    assert and_(a, b) == py_and(a, b)
    assert or_(a, b) == py_or(a, b)
    assert nor_(a, b) == py_nor(a, b)


@pytest.mark.parametrize("a, b", [(0, 0), (0, 1), (1, 0), (1, 1)])
def test_xor_xnor(a, b):
    assert xor_(a, b) == py_xor(a, b)
    assert xnor_(a, b) == py_xnor(a, b)


@pytest.mark.parametrize(
    "sel, a, b",
    [(s, x, y) for s in (0, 1) for x in (0, 1) for y in (0, 1)],
)
def test_mux(sel, a, b):
    assert mux_(sel, a, b) == py_mux(sel, a, b)


def test_every_derivation_outputs_binary():
    for d in NAND_DERIVATIONS:
        if d["arity"] == 1:
            assert d["fn"](0) in (0, 1)
            assert d["fn"](1) in (0, 1)
        elif d["arity"] == 2:
            for a in (0, 1):
                for b in (0, 1):
                    assert d["fn"](a, b) in (0, 1)
        else:
            for s in (0, 1):
                for a in (0, 1):
                    for b in (0, 1):
                        assert d["fn"](s, a, b) in (0, 1)


def test_bridge_has_three_universality_stories():
    for k in ("classical", "continuous", "quantum"):
        assert k in UNIVERSALITY_BRIDGE
        for sub in ("primitive", "domain", "derives"):
            assert sub in UNIVERSALITY_BRIDGE[k]
    assert "2603.21852" in UNIVERSALITY_BRIDGE["continuous"]["citation"]


def test_bridge_matches_eml_module():
    """Cross-bridge consistency: the bridge data in nand.py matches eml.py."""
    from eml import UNIVERSALITY_BRIDGE as EML_BRIDGE

    assert UNIVERSALITY_BRIDGE == EML_BRIDGE
