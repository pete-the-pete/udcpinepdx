"""SQLite connection helper.

Opens a connection in WAL mode with foreign keys enforced and the schema
applied. The schema is idempotent (CREATE ... IF NOT EXISTS), so connect()
is safe to call against a fresh or an existing database.

A single connection is shared across threads (check_same_thread=False);
all access is serialized by the Store's lock — see store.py.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

_SCHEMA = Path(__file__).with_name("schema.sql")


def connect(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    # WAL: safe concurrent reads + crash resilience. A no-op for :memory:.
    conn.execute("PRAGMA journal_mode=WAL")
    # SQLite does not enforce foreign keys unless asked, per-connection.
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(_SCHEMA.read_text())
    conn.commit()
    return conn
