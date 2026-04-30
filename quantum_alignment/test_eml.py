"""Pytest for the eml universal-primitive port. Mirrors eml.test.mjs."""

import math

import pytest

from eml import (
    EML_E,
    EML_PI,
    EML_ZERO,
    UNIVERSALITY_BRIDGE,
    DERIVATIONS,
    eml,
    eml_add,
    eml_cos,
    eml_exp,
    eml_ln,
    eml_mul_positive,
    eml_neg,
    eml_pow,
    eml_sin,
    eml_sqrt,
    eml_sub,
    eml_sub_positive,
    reference_table,
)


def test_core_eml_definition():
    assert eml(1, 1) == pytest.approx(math.e)
    assert eml(0, 1) == pytest.approx(1.0)
    assert eml(0, math.e) == pytest.approx(0.0, abs=1e-12)


def test_core_rejects_nonpositive_y():
    with pytest.raises(ValueError):
        eml(0, 0)
    with pytest.raises(ValueError):
        eml(0, -1)


def test_first_ring_constants():
    assert EML_E == pytest.approx(math.e)
    assert EML_ZERO == pytest.approx(0.0, abs=1e-12)


@pytest.mark.parametrize("x", [-2, -0.5, 0, 0.5, 1, 2.7])
def test_eml_exp_matches_math(x):
    assert eml_exp(x) == pytest.approx(math.exp(x))


@pytest.mark.parametrize("y", [0.1, 0.5, 1.0, 2.0, 10.0, 1234.0])
def test_eml_ln_matches_math(y):
    assert eml_ln(y) == pytest.approx(math.log(y), abs=1e-9)


@pytest.mark.parametrize("a, b", [(1, 1), (2, 0.5), (10, -3), (0.7, 0.3)])
def test_eml_sub_positive(a, b):
    assert eml_sub_positive(a, b) == pytest.approx(a - b, abs=1e-9)


@pytest.mark.parametrize("a, b", [(0, 0), (-5, -7), (3, 8), (-1.2, 4.4)])
def test_eml_sub_general(a, b):
    assert eml_sub(a, b) == pytest.approx(a - b, abs=1e-9)


def test_neg_and_add():
    assert eml_neg(3) == pytest.approx(-3, abs=1e-9)
    assert eml_neg(-3) == pytest.approx(3, abs=1e-9)
    for a, b in [(2, 3), (-5, 5), (0.1, 0.2), (-7.7, 1.1)]:
        assert eml_add(a, b) == pytest.approx(a + b, abs=1e-8)


@pytest.mark.parametrize("a, b", [(2, 3), (0.5, 4), (10, 0.1)])
def test_mul_positive(a, b):
    assert eml_mul_positive(a, b) == pytest.approx(a * b, abs=1e-8)


def test_pow_integer_and_real():
    assert eml_pow(2, 3) == pytest.approx(8, abs=1e-7)
    assert eml_pow(3, 0) == pytest.approx(1, abs=1e-9)
    assert eml_pow(4, 0.5) == pytest.approx(2, abs=1e-9)
    assert eml_pow(2, 1.5) == pytest.approx(math.sqrt(8), abs=1e-9)


@pytest.mark.parametrize("a", [0.25, 1, 2, 9, 100])
def test_sqrt(a):
    assert eml_sqrt(a) == pytest.approx(math.sqrt(a), abs=1e-9)


def test_pi_matches():
    assert EML_PI == pytest.approx(math.pi)


@pytest.mark.parametrize("x", [-3, -1.5, -0.5, 0, 0.3, 1.2, 2.5, 3])
def test_taylor_trig_matches(x):
    assert eml_sin(x) == pytest.approx(math.sin(x), abs=1e-9)
    assert eml_cos(x) == pytest.approx(math.cos(x), abs=1e-9)


def test_universality_bridge_is_complete():
    for k in ("classical", "continuous", "quantum"):
        assert k in UNIVERSALITY_BRIDGE
        for sub in ("primitive", "domain", "derives"):
            assert sub in UNIVERSALITY_BRIDGE[k]
    assert "2603.21852" in UNIVERSALITY_BRIDGE["continuous"]["citation"]


def test_derivations_smoke():
    for d in DERIVATIONS:
        fn = d["fn"]
        if d["id"] in ("ln", "sub", "mul", "sqrt"):
            # positive-domain
            if d["id"] in ("sub", "mul"):
                got = fn(2, 1)
            else:
                got = fn(2)
        elif d["id"] == "add":
            got = fn(2, 3)
        else:
            got = fn(0.5)
        assert math.isfinite(got), f"{d['id']} returned {got}"


def test_reference_table_runs_and_agrees():
    rows = reference_table()
    assert any(label == "e" for label, *_ in rows)
    assert any(label == "π" for label, *_ in rows)
    for label, _a, _b, err in rows:
        assert err < 1e-9, f"{label}: error {err} too large"
