"""Tests for the eml expression CLI / REPL."""

import math

import pytest

from eml_cli import evaluate, tokenize, main


def close(a, b, eps=1e-8):
    assert abs(a - b) <= eps, f"{a} !≈ {b}"


def test_tokenize_handles_numbers_names_ops():
    toks = tokenize("exp(1) + sin(pi/2)")
    kinds = [t[0] for t in toks]
    assert kinds == ["name", "(", "num", ")", "+", "name", "(", "name", "/", "num", ")"]


def test_evaluate_constants():
    close(evaluate("e"), math.e)
    close(evaluate("pi"), math.pi)
    close(evaluate("zero"), 0)


def test_evaluate_unary_calls():
    close(evaluate("exp(1)"), math.e)
    close(evaluate("ln(e)"), 1, eps=1e-9)
    close(evaluate("sin(0)"), 0, eps=1e-9)
    close(evaluate("cos(0)"), 1, eps=1e-9)
    close(evaluate("sqrt(4)"), 2, eps=1e-9)


def test_evaluate_binary_calls():
    close(evaluate("add(1, 2)"), 3, eps=1e-8)
    close(evaluate("sub(5, 3)"), 2, eps=1e-9)
    close(evaluate("mul(2, 3)"), 6, eps=1e-8)
    close(evaluate("eml(1, 1)"), math.e)


def test_evaluate_arithmetic_via_operators():
    close(evaluate("1 + 2"), 3, eps=1e-8)
    close(evaluate("5 - 3"), 2, eps=1e-9)
    close(evaluate("2 * 3"), 6, eps=1e-8)
    close(evaluate("8 / 2"), 4, eps=1e-9)


def test_evaluate_precedence():
    close(evaluate("1 + 2 * 3"), 7, eps=1e-7)
    close(evaluate("(1 + 2) * 3"), 9, eps=1e-7)


def test_evaluate_boolean_calls():
    assert evaluate("nand(1, 1)") == 0
    assert evaluate("and_(1, 1)") == 1
    assert evaluate("or_(0, 1)") == 1
    assert evaluate("xor_(1, 1)") == 0
    assert evaluate("not_(0)") == 1
    assert evaluate("mux_(1, 0, 1)") == 1


def test_unknown_function_errors():
    with pytest.raises(ValueError):
        evaluate("bogus(1)")


def test_unknown_identifier_errors():
    with pytest.raises(ValueError):
        evaluate("unknown_constant")


def test_empty_expression_errors():
    with pytest.raises(ValueError):
        evaluate("")


def test_main_one_shot_returns_zero(capsys):
    rc = main(["exp(0)"])
    out = capsys.readouterr().out.strip()
    assert rc == 0
    close(float(out), 1)


def test_main_unknown_expression_returns_one(capsys):
    rc = main(["bogus(1)"])
    err = capsys.readouterr().err
    assert rc == 1
    assert "error" in err.lower()
