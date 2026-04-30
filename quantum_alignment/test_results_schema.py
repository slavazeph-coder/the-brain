"""Smoke test for results_schema.json — every row written by the suite
must validate against the schema, and the schema itself must be valid.

We do *not* require jsonschema as a runtime dep (it isn't in
requirements.txt); the test skips cleanly if it's not installed so the
fast lane stays portable.
"""

from __future__ import annotations

import csv
import json
import math
import os

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA_PATH = os.path.join(HERE, "results_schema.json")


def test_schema_file_is_valid_json():
    with open(SCHEMA_PATH) as f:
        schema = json.load(f)
    assert schema["$schema"].startswith("https://json-schema.org/")
    assert "experiment" in schema["required"]


def test_schema_lists_all_four_experiments():
    with open(SCHEMA_PATH) as f:
        schema = json.load(f)
    enum = schema["properties"]["experiment"]["enum"]
    assert set(enum) == {"phase_alignment", "observation", "noise_depth", "bell"}


def test_csv_columns_match_schema_required():
    """Every required schema property must appear as a CSV header column,
    and vice versa."""
    import quantum_alignment_tests as qat

    with open(SCHEMA_PATH) as f:
        schema = json.load(f)
    required = set(schema["required"])
    csv_cols = set(qat.CSV_FIELDS)
    assert required == csv_cols, (
        f"required - csv = {required - csv_cols} ; "
        f"csv - required = {csv_cols - required}"
    )


def test_committed_ideal_results_validate(tmp_path):
    """If jsonschema is available, validate every row of the committed
    results/ideal/results.csv against the schema."""
    jsonschema = pytest.importorskip("jsonschema")

    with open(SCHEMA_PATH) as f:
        schema = json.load(f)

    csv_path = os.path.join(HERE, "results", "ideal", "results.csv")
    if not os.path.exists(csv_path):
        pytest.skip(f"no committed CSV at {csv_path}")
    with open(csv_path) as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            # CSV gives strings; schema accepts number-or-string for the
            # numeric fields so NaN passes. Normalise integer fields.
            row["shots"] = int(row["shots"])
            for k in ("parameter", "p0", "p1", "expected_p0", "error"):
                v = row[k]
                # Try float; keep as string if it parses to NaN (schema
                # allows string for those fields).
                try:
                    fv = float(v)
                    row[k] = fv if not math.isnan(fv) else "nan"
                except ValueError:
                    pass
            jsonschema.validate(row, schema)
