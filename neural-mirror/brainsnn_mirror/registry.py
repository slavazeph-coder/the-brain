from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

SCHEMA_VERSION = "brainsnn.experiment.v0.1"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect_registry(path: str | Path) -> sqlite3.Connection:
    db_path = Path(path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS experiments (
          id TEXT PRIMARY KEY,
          schema_version TEXT NOT NULL,
          parent_id TEXT,
          hypothesis TEXT NOT NULL,
          status TEXT NOT NULL,
          model_family TEXT NOT NULL,
          dataset_id TEXT NOT NULL,
          split_id TEXT NOT NULL,
          dataset_license TEXT NOT NULL,
          config_json TEXT NOT NULL,
          metrics_json TEXT,
          checkpoint_path TEXT,
          benchmark_valid INTEGER NOT NULL DEFAULT 0,
          leakage_detected INTEGER NOT NULL DEFAULT 0,
          promoted INTEGER NOT NULL DEFAULT 0,
          failure_reason TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS lessons (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          experiment_id TEXT NOT NULL,
          lesson TEXT NOT NULL,
          do_not_retry_until TEXT,
          created_at TEXT NOT NULL
        )
        """
    )
    connection.commit()
    return connection


def _row_to_experiment(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "schemaVersion": row["schema_version"],
        "id": row["id"],
        "parentId": row["parent_id"],
        "hypothesis": row["hypothesis"],
        "status": row["status"],
        "model": {"family": row["model_family"]},
        "dataset": {
            "id": row["dataset_id"],
            "split": row["split_id"],
            "license": row["dataset_license"],
        },
        "config": json.loads(row["config_json"] or "{}"),
        "metrics": json.loads(row["metrics_json"] or "{}"),
        "checkpointPath": row["checkpoint_path"],
        "benchmarkValid": bool(row["benchmark_valid"]),
        "dataLeakageDetected": bool(row["leakage_detected"]),
        "promoted": bool(row["promoted"]),
        "failureReason": row["failure_reason"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def upsert_experiment(connection: sqlite3.Connection, experiment: Dict[str, Any]) -> None:
    now = utc_now()
    created = experiment.get("createdAt") or now
    connection.execute(
        """
        INSERT INTO experiments (
          id, schema_version, parent_id, hypothesis, status, model_family,
          dataset_id, split_id, dataset_license, config_json, metrics_json,
          checkpoint_path, benchmark_valid, leakage_detected, promoted,
          failure_reason, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          parent_id=excluded.parent_id,
          hypothesis=excluded.hypothesis,
          status=excluded.status,
          model_family=excluded.model_family,
          dataset_id=excluded.dataset_id,
          split_id=excluded.split_id,
          dataset_license=excluded.dataset_license,
          config_json=excluded.config_json,
          metrics_json=excluded.metrics_json,
          checkpoint_path=excluded.checkpoint_path,
          benchmark_valid=excluded.benchmark_valid,
          leakage_detected=excluded.leakage_detected,
          promoted=excluded.promoted,
          failure_reason=excluded.failure_reason,
          updated_at=excluded.updated_at
        """,
        (
            experiment["id"],
            experiment.get("schemaVersion", SCHEMA_VERSION),
            experiment.get("parentId"),
            experiment.get("hypothesis", ""),
            experiment.get("status", "PROPOSED"),
            experiment.get("model", {}).get("family", "ridge"),
            experiment.get("dataset", {}).get("id", "unconfigured"),
            experiment.get("dataset", {}).get("split", "validation"),
            experiment.get("dataset", {}).get("license", "unknown"),
            json.dumps(experiment.get("config", {}), sort_keys=True),
            json.dumps(experiment.get("metrics", {}), sort_keys=True),
            experiment.get("checkpointPath"),
            int(bool(experiment.get("benchmarkValid"))),
            int(bool(experiment.get("dataLeakageDetected"))),
            int(bool(experiment.get("promoted"))),
            experiment.get("failureReason"),
            created,
            now,
        ),
    )
    connection.commit()


def list_experiments(connection: sqlite3.Connection, limit: int = 100) -> List[Dict[str, Any]]:
    rows = connection.execute(
        "SELECT * FROM experiments ORDER BY created_at DESC LIMIT ?", (max(1, int(limit)),)
    ).fetchall()
    return [_row_to_experiment(row) for row in rows]


def current_champion(connection: sqlite3.Connection) -> Optional[Dict[str, Any]]:
    row = connection.execute(
        "SELECT * FROM experiments WHERE promoted=1 ORDER BY updated_at DESC LIMIT 1"
    ).fetchone()
    return _row_to_experiment(row) if row else None


def promote_experiment(connection: sqlite3.Connection, experiment_id: str) -> None:
    connection.execute("UPDATE experiments SET promoted=0, status=CASE WHEN status='PROMOTED' THEN 'EVALUATED' ELSE status END")
    connection.execute(
        "UPDATE experiments SET promoted=1, status='PROMOTED', updated_at=? WHERE id=?",
        (utc_now(), experiment_id),
    )
    connection.commit()


def add_lesson(connection: sqlite3.Connection, experiment_id: str, lesson: str, do_not_retry_until: str | None = None) -> None:
    connection.execute(
        "INSERT INTO lessons (experiment_id, lesson, do_not_retry_until, created_at) VALUES (?, ?, ?, ?)",
        (experiment_id, lesson[:4000], do_not_retry_until, utc_now()),
    )
    connection.commit()
