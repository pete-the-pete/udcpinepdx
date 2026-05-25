"""db.connect: WAL-mode SQLite connection with the schema applied."""

from __future__ import annotations

import sqlite3

import pytest

from udcpine_backend.db import connect


def test_connect_creates_the_tables(tmp_path) -> None:
    conn = connect(str(tmp_path / "t.db"))
    tables = {
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    assert "firing" in tables
    assert "sample" in tables


def test_connect_is_idempotent(tmp_path) -> None:
    path = str(tmp_path / "t.db")
    connect(path).close()
    # Connecting again must not fail on already-existing tables.
    connect(path).close()


def test_foreign_keys_are_enforced(tmp_path) -> None:
    conn = connect(str(tmp_path / "t.db"))
    # A sample referencing a non-existent firing must be rejected.
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO sample (firing_id, t, temp_f) VALUES (999, '2026-01-01T00:00:00Z', 70.0)"
        )
        conn.commit()


def test_rows_are_dict_accessible(tmp_path) -> None:
    conn = connect(str(tmp_path / "t.db"))
    conn.execute(
        "INSERT INTO firing (started_at, ended_at, status) VALUES (?, ?, ?)",
        ("2026-01-01T00:00:00Z", None, "active"),
    )
    row = conn.execute("SELECT * FROM firing").fetchone()
    assert row["status"] == "active"  # row_factory gives name access
