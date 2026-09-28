from __future__ import annotations

from brainsnn_mirror.registry import (
    add_lesson,
    current_champion,
    list_experiments,
    promote_experiment,
    upsert_experiment,
)


def test_connect_creates_schema(registry):
    tables = {
        row[0]
        for row in registry.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }
    assert {"experiments", "lessons"} <= tables


def test_upsert_inserts_then_updates_same_id(registry, make_exp):
    upsert_experiment(registry, make_exp("mirror-0001", metrics={"meanPearson": 0.4}))
    upsert_experiment(registry, make_exp("mirror-0001", metrics={"meanPearson": 0.6}, status="EVALUATED"))
    rows = list_experiments(registry)
    assert len(rows) == 1
    assert rows[0]["metrics"]["meanPearson"] == 0.6
    assert rows[0]["status"] == "EVALUATED"


def test_roundtrip_preserves_boolean_gates(registry, make_exp):
    upsert_experiment(
        registry,
        make_exp("mirror-0002", benchmarkValid=True, dataLeakageDetected=True, promoted=False),
    )
    row = list_experiments(registry)[0]
    assert row["benchmarkValid"] is True
    assert row["dataLeakageDetected"] is True
    assert row["promoted"] is False


def test_promote_demotes_previous_champion(registry, make_exp):
    upsert_experiment(registry, make_exp("mirror-a", status="PROMOTED", promoted=True))
    upsert_experiment(registry, make_exp("mirror-b", status="EVALUATED", promoted=False))
    promote_experiment(registry, "mirror-b")
    champion = current_champion(registry)
    assert champion["id"] == "mirror-b"
    rows = {row["id"]: row for row in list_experiments(registry)}
    assert rows["mirror-a"]["promoted"] is False
    assert rows["mirror-a"]["status"] == "EVALUATED"  # previous champion demoted cleanly
    assert rows["mirror-b"]["status"] == "PROMOTED"


def test_list_experiments_orders_newest_first(registry, make_exp):
    upsert_experiment(registry, make_exp("mirror-old", createdAt="2026-01-01T00:00:00+00:00"))
    upsert_experiment(registry, make_exp("mirror-new", createdAt="2026-06-01T00:00:00+00:00"))
    rows = list_experiments(registry)
    assert [row["id"] for row in rows] == ["mirror-new", "mirror-old"]


def test_add_lesson_truncates_and_stores(registry):
    long_lesson = "x" * 5000
    add_lesson(registry, "mirror-a", long_lesson, do_not_retry_until="2026-12-01")
    row = registry.execute("SELECT lesson, do_not_retry_until FROM lessons").fetchone()
    assert len(row["lesson"]) == 4000
    assert row["do_not_retry_until"] == "2026-12-01"
