"""eml command-line REPL.

Tiny interactive evaluator for the universal continuous primitive
``eml(x, y) = exp(x) - ln(y)``. Supports a one-shot evaluation
(``python -m eml_cli '2 + 3'``) and an interactive mode
(``python -m eml_cli`` with no args).

Allowed expression vocabulary (a thin lambda-like grammar so the demo
stays auditable, no ``eval``):

    numbers:        decimal literals, plus the named constants e, pi, zero
    eml-derived:    exp(x), ln(x), neg(x), add(a, b), sub(a, b), mul(a, b),
                    sqrt(x), sin(x), cos(x), pow(a, k)
    bridge:         eml(x, y), nand(a, b), and_, or_, xor_, not_, mux_

The point is to make the eml derivations live and inspectable from the
shell. We do not allow arbitrary Python — every name is a registered
function from eml / nand. Inputs that don't parse return a useful error.
"""

from __future__ import annotations

import argparse
import math
import re
import sys
from typing import Any, Callable

from eml import (
    EML_E,
    EML_PI,
    EML_ZERO,
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
)
from nand import and_, mux_, nand, not_, or_, xor_


# ---------- registry ------------------------------------------------------


CONSTANTS: dict[str, Any] = {
    "e": EML_E,
    "pi": EML_PI,
    "zero": EML_ZERO,
}


FUNCTIONS: dict[str, Callable[..., Any]] = {
    "eml": eml,
    "exp": eml_exp,
    "ln": eml_ln,
    "neg": eml_neg,
    "add": eml_add,
    "sub": eml_sub,
    "mul": eml_mul_positive,
    "sqrt": eml_sqrt,
    "sin": eml_sin,
    "cos": eml_cos,
    "pow": eml_pow,
    "nand": nand,
    "and_": and_,
    "or_": or_,
    "not_": not_,
    "xor_": xor_,
    "mux_": mux_,
}


# ---------- minimal expression parser -------------------------------------


_TOKEN_RE = re.compile(
    r"\s*(?:(?P<num>-?\d+(?:\.\d+)?)"
    r"|(?P<name>[A-Za-z_][A-Za-z0-9_]*)"
    r"|(?P<op>[+\-*/^()])"
    r"|(?P<comma>,))"
)


def tokenize(src: str) -> list[tuple[str, str]]:
    pos = 0
    out: list[tuple[str, str]] = []
    while pos < len(src):
        m = _TOKEN_RE.match(src, pos)
        if not m:
            if src[pos].isspace():
                pos += 1
                continue
            raise ValueError(f"unexpected character {src[pos]!r} at {pos}")
        if m.group("num") is not None:
            out.append(("num", m.group("num")))
        elif m.group("name") is not None:
            out.append(("name", m.group("name")))
        elif m.group("op") is not None:
            out.append((m.group("op"), m.group("op")))
        elif m.group("comma") is not None:
            out.append((",", ","))
        pos = m.end()
    return out


class Parser:
    """Recursive-descent over: expr -> term { ('+'|'-') term }*
                              term -> power { ('*'|'/') power }*
                              power -> atom { '^' power }
                              atom -> num | name '(' args ')' | name | '(' expr ')'
                              args -> expr { ',' expr }*
    """

    def __init__(self, tokens: list[tuple[str, str]]) -> None:
        self.tokens = tokens
        self.i = 0

    def peek(self) -> tuple[str, str] | None:
        return self.tokens[self.i] if self.i < len(self.tokens) else None

    def eat(self, expected: str | None = None) -> tuple[str, str]:
        tok = self.tokens[self.i]
        if expected and tok[0] != expected:
            raise ValueError(f"expected {expected!r}, got {tok!r}")
        self.i += 1
        return tok

    def parse(self) -> Any:
        v = self.expr()
        if self.peek() is not None:
            raise ValueError(f"unexpected trailing token {self.peek()}")
        return v

    def expr(self) -> Any:
        v = self.term()
        while True:
            tok = self.peek()
            if tok and tok[0] in ("+", "-"):
                self.eat()
                rhs = self.term()
                v = eml_add(v, rhs) if tok[0] == "+" else eml_sub(v, rhs)
            else:
                return v

    def term(self) -> Any:
        v = self.power()
        while True:
            tok = self.peek()
            if tok and tok[0] in ("*", "/"):
                self.eat()
                rhs = self.power()
                if tok[0] == "*":
                    # multiplication via eml only when both positive; fall
                    # back to native * otherwise (and surface the limitation)
                    if v > 0 and rhs > 0:
                        v = eml_mul_positive(v, rhs)
                    else:
                        v = v * rhs
                else:
                    v = v / rhs
            else:
                return v

    def power(self) -> Any:
        v = self.atom()
        tok = self.peek()
        if tok and tok[0] == "^":
            self.eat()
            rhs = self.power()
            v = eml_pow(v, rhs) if v > 0 else math.pow(v, rhs)
        return v

    def atom(self) -> Any:
        tok = self.eat()
        if tok[0] == "num":
            return float(tok[1])
        if tok[0] == "(":
            v = self.expr()
            self.eat(")")
            return v
        if tok[0] == "name":
            name = tok[1]
            if self.peek() and self.peek()[0] == "(":
                self.eat("(")
                args = [self.expr()]
                while self.peek() and self.peek()[0] == ",":
                    self.eat(",")
                    args.append(self.expr())
                self.eat(")")
                if name not in FUNCTIONS:
                    raise ValueError(f"unknown function {name!r}")
                return FUNCTIONS[name](*args)
            if name in CONSTANTS:
                return CONSTANTS[name]
            raise ValueError(f"unknown identifier {name!r}")
        raise ValueError(f"unexpected token {tok}")


def evaluate(src: str) -> Any:
    tokens = tokenize(src)
    if not tokens:
        raise ValueError("empty expression")
    return Parser(tokens).parse()


# ---------- entry points --------------------------------------------------


def repl() -> int:
    print("eml REPL — type an expression, blank line to quit.")
    print("Examples:  exp(1)   sub(1, 1)   sin(pi/2)   add(e, 1)   and_(1, 1)")
    while True:
        try:
            src = input("eml> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 0
        if not src:
            return 0
        try:
            v = evaluate(src)
        except Exception as exc:  # noqa: BLE001 — surface every error to user
            print(f"error: {exc}")
            continue
        if isinstance(v, float) and v.is_integer():
            print(int(v))
        else:
            print(v)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Tiny eml-only expression evaluator (Odrzywołek 2603.21852).",
    )
    parser.add_argument("expression", nargs="?", help="One-shot expression to evaluate. Drop into REPL if omitted.")
    args = parser.parse_args(argv)
    if args.expression is None:
        return repl()
    try:
        v = evaluate(args.expression)
    except Exception as exc:  # noqa: BLE001
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(v)
    return 0


if __name__ == "__main__":
    sys.exit(main())
