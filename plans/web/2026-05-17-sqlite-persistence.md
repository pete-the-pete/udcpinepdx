# SQLite Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **First execution step:** promote this file to
> `plans/web/2026-05-17-sqlite-persistence.md` and commit it.

## Context

Every slice so far runs on in-memory state — the firing `Store` keeps the
current firing and the *latest* sample only, all lost on restart. The
roadmap's Product 1 included SQLite; we deferred it. Pete has now chosen to
do SQLite **before** Drive persistence, so that firing/sample data — and
later the Drive upload queue — are genuinely durable. (Real Google Drive,
with a test-data cleanup story, is the follow-up plan after this one.)

This plan makes the firing `Store` SQLite-backed: firings and their full
sample series persist to a database file, and a server restart resumes an
active firing with its history intact.

**Goal:** Firing and sample data persist in a SQLite database; restarting the backend mid-firing resumes that firing with its sample history, and every firing's full sample series is queryable.

**Architecture:** A new `db.py` opens a WAL-mode SQLite connection and applies `schema.sql` (a `firing` table and a `sample` table). The `Store` is rewritten to write through to SQLite on every mutation while keeping its existing in-memory caches (`_firing`, `_latest_sample`) as a read-through optimization — SQLite is authoritative. On construction the `Store` rehydrates the active firing and its latest sample from the database. A new `samples(firing_id)` accessor returns a firing's full series (the Drive plan will consume it). The SSE pub/sub stays in-memory — it is ephemeral by nature. No wire-type changes, no frontend changes.

**Tech Stack:** Python stdlib `sqlite3`, WAL mode. No migration framework — `schema.sql` applied with `CREATE TABLE IF NOT EXISTS` at startup.

---

## Conscious decisions

1. **Plain `schema.sql` + `CREATE TABLE IF NOT EXISTS`, no Alembic.** One table-set, no migrations needed yet. A migration story is its own concern if the schema ever evolves (YAGNI).
2. **In-memory caches kept; SQLite is authoritative.** `_firing` and `_latest_sample` stay as read-through caches so `/api/state` and every 1 Hz sensor tick don't hit the DB for reads. Writes go to both, under the existing lock. This is the design doc's model ("SQLite is authoritative; in-memory firing + ring buffer").
3. **`sample` uses an autoincrement `id`, not the design doc's `(firing_id, t)` composite PK.** Tests drive the clock with a fixed value, so multiple samples can share a timestamp; a composite PK on `(firing_id, t)` would collide. A rowid PK + an index on `firing_id` is robust and 7,200 rows/firing needs no cleverness.
4. **Auth tables stay in-memory — out of scope.** `AuthStore` keeps its in-memory tokens/devices. Re-pairing after a restart is one click (the bootstrap link is reprinted every start); persisting devices is low-value and would double this plan's surface. A future plan can add it.
5. **No `pizza` or `upload_queue` tables.** Those belong to the pizza plan and the Drive plan respectively. Create tables when the code that uses them lands (YAGNI).
6. **Single shared connection, `check_same_thread=False`, serialized by the Store's existing lock.** The mock sensor thread and Flask request threads already funnel through `Store._lock`; one connection under that lock is correct and simple. WAL is enabled regardless — good habit, and it helps the moment any concurrent reader appears.
7. **DB path via `UDCPINE_DB_PATH` env, default a gitignored local file.** Tests use a pytest `tmp_path` file (exercises the real file path, not `:memory:`). The e2e backend uses `:memory:` so each run is hermetic.
8. **`temp_f`, not the design doc's `temp_c`** — consistent with the shipped `Sample` wire type.

## Out of scope (future plans)

- Real Google Drive persistence + a test-data cleanup story — the next plan.
- Auth-table persistence (`auth_token`, `paired_device`).
- `pizza` table — the pizza plan.
- `upload_queue` table — the Drive plan.
- Schema migrations / Alembic.
- Pi data-directory location (`/var/lib/udcpine/`) — a Pi-deployment concern.

---

## File structure

```
udcpinepdx/
├── plans/web/2026-05-17-sqlite-persistence.md   (NEW — promoted from the plan-mode scratch file)
├── .gitignore                                   (MODIFY — ignore *.db / WAL sidecars)
├── Makefile                                     (MODIFY — db-reset target + help line)
├── web/backend/
│   ├── Makefile.include                         (MODIFY — web-backend-db-reset)
│   ├── src/udcpine_backend/
│   │   ├── schema.sql                           (NEW — firing + sample tables)
│   │   ├── db.py                                (NEW — connect + apply schema)
│   │   ├── store.py                             (REWRITE — SQLite-backed)
│   │   └── app.py                               (MODIFY — resolve UDCPINE_DB_PATH)
│   └── tests/
│       ├── test_db.py                           (NEW)
│       ├── test_store.py                        (REWRITE — tmp_path db, rehydrate + samples)
│       └── test_api.py                          (MODIFY — store fixture gets a tmp db)
└── web/frontend/
    └── playwright.config.ts                     (MODIFY — backend uses an in-memory db)
```

---

## Task 1: `schema.sql` + `db.py` + `test_db.py`

**Files:**
- Create: `web/backend/src/udcpine_backend/schema.sql`
- Create: `web/backend/tests/test_db.py`
- Create: `web/backend/src/udcpine_backend/db.py`

- [ ] **Step 1: Write `web/backend/src/udcpine_backend/schema.sql`**

```sql
-- udcpine persistence schema. Applied idempotently at startup by db.py.

CREATE TABLE IF NOT EXISTS firing (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at  TEXT NOT NULL,
  ended_at    TEXT,
  status      TEXT NOT NULL CHECK (status IN ('active', 'ended'))
);

CREATE TABLE IF NOT EXISTS sample (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  firing_id   INTEGER NOT NULL REFERENCES firing(id),
  t           TEXT NOT NULL,
  temp_f      REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS sample_firing_idx ON sample(firing_id);
```

- [ ] **Step 2: Write the failing tests `web/backend/tests/test_db.py`**

```python
"""db.connect: WAL-mode SQLite connection with the schema applied."""

from __future__ import annotations

import sqlite3

import pytest

from udcpine_backend.db import connect


def test_connect_creates_the_tables(tmp_path) -> None:
    conn = connect(str(tmp_path / "t.db"))
    tables = {
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
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
```

- [ ] **Step 3: Run; verify failure**

Run: `cd web/backend && uv run pytest tests/test_db.py -v`
Expected: `ModuleNotFoundError: udcpine_backend.db`.

- [ ] **Step 4: Write `web/backend/src/udcpine_backend/db.py`**

```python
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
```

- [ ] **Step 5: Run tests**

Run: `cd web/backend && uv run pytest tests/test_db.py -v`
Expected: 4 PASS.

- [ ] **Step 6: Commit**

```bash
git add web/backend/src/udcpine_backend/schema.sql web/backend/src/udcpine_backend/db.py web/backend/tests/test_db.py
git commit -m "feat(web): SQLite schema + WAL connection helper"
```

---

## Task 2: Rewrite `Store` SQLite-backed

**Files:**
- Rewrite: `web/backend/src/udcpine_backend/store.py`
- Rewrite: `web/backend/tests/test_store.py`

The `Store` keeps its public surface (`firing`, `latest_sample`,
`start_firing`, `stop_firing`, `publish_sample`, `subscribe`,
`unsubscribe`) and its pub/sub behavior, and **adds** `samples(firing_id)`.
Two behavioral changes fall out of persistence:

- `__init__` now takes a `db_path` and rehydrates an active firing from it.
- `publish_sample` with **no active firing** is a no-op — a sample row
  needs a `firing_id`, and the mock sensor only publishes during a firing
  anyway. (Previously it updated `_latest_sample` even when idle.)

- [ ] **Step 1: Rewrite the tests `web/backend/tests/test_store.py`**

```python
"""Store: SQLite-backed in-memory-cached session state."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from udcpine_backend.store import Store
from udcpine_backend.time_source import Clock

T0 = datetime(2026, 5, 17, 18, 0, 0, tzinfo=timezone.utc)


class FixedClock(Clock):
    def __init__(self, when: datetime) -> None:
        self._when = when

    def now(self) -> datetime:
        return self._when


class AdvancingClock(Clock):
    """Returns T0, T0+1s, T0+2s, … — so successive samples get distinct
    timestamps, like a real 1 Hz sensor."""

    def __init__(self, start: datetime) -> None:
        self._start = start
        self._n = 0

    def now(self) -> datetime:
        t = self._start + timedelta(seconds=self._n)
        self._n += 1
        return t


@pytest.fixture()
def db_path(tmp_path) -> str:
    return str(tmp_path / "store.db")


def test_new_store_is_idle(db_path) -> None:
    s = Store(db_path, clock=FixedClock(T0))
    assert s.firing() is None
    assert s.latest_sample() is None


def test_start_firing_creates_active_firing(db_path) -> None:
    s = Store(db_path, clock=FixedClock(T0))
    firing = s.start_firing()
    assert firing.status == "active"
    assert firing.id >= 1
    assert firing.ended_at is None
    assert s.firing() == firing


def test_starting_while_active_returns_existing_firing(db_path) -> None:
    s = Store(db_path, clock=FixedClock(T0))
    first = s.start_firing()
    second = s.start_firing()
    assert first.id == second.id


def test_stop_firing_marks_ended(db_path) -> None:
    s = Store(db_path, clock=FixedClock(T0))
    s.start_firing()
    ended = s.stop_firing()
    assert ended is not None
    assert ended.status == "ended"
    assert ended.ended_at is not None
    assert s.firing() is None


def test_stop_while_idle_returns_none(db_path) -> None:
    s = Store(db_path, clock=FixedClock(T0))
    assert s.stop_firing() is None


def test_firing_ids_increment_across_sessions(db_path) -> None:
    s = Store(db_path, clock=FixedClock(T0))
    f1 = s.start_firing()
    s.stop_firing()
    f2 = s.start_firing()
    assert f2.id == f1.id + 1


def test_subscriber_receives_published_event(db_path) -> None:
    s = Store(db_path, clock=AdvancingClock(T0))
    s.start_firing()
    q = s.subscribe()
    s.publish_sample(temp_f=847.0)
    event = q.get(timeout=0.5)
    assert event["type"] == "sample"
    assert event["temp_f"] == 847.0
    assert "t" in event


def test_start_firing_publishes_firing_started(db_path) -> None:
    s = Store(db_path, clock=FixedClock(T0))
    q = s.subscribe()
    s.start_firing()
    event = q.get(timeout=0.5)
    assert event["type"] == "firing_started"
    assert event["firing"]["status"] == "active"


def test_stop_firing_publishes_firing_ended(db_path) -> None:
    s = Store(db_path, clock=FixedClock(T0))
    s.start_firing()
    q = s.subscribe()
    s.stop_firing()
    event = q.get(timeout=0.5)
    assert event["type"] == "firing_ended"
    assert "firing_id" in event


def test_publish_sample_updates_latest_sample(db_path) -> None:
    s = Store(db_path, clock=AdvancingClock(T0))
    s.start_firing()
    s.publish_sample(temp_f=200.0)
    assert s.latest_sample() is not None
    assert s.latest_sample().temp_f == 200.0


def test_publish_sample_without_a_firing_is_a_noop(db_path) -> None:
    s = Store(db_path, clock=FixedClock(T0))
    s.publish_sample(temp_f=200.0)  # no active firing
    assert s.latest_sample() is None


def test_unsubscribe_stops_delivery(db_path) -> None:
    s = Store(db_path, clock=AdvancingClock(T0))
    s.start_firing()
    q = s.subscribe()
    s.unsubscribe(q)
    s.publish_sample(temp_f=100.0)
    with pytest.raises(Exception):
        q.get(timeout=0.05)


def test_emitted_events_validate_against_live_event_schema(db_path) -> None:
    """Server-side contract test: every dict the Store broadcasts must
    validate against the generated LiveEvent Pydantic class."""
    from generated.pydantic import LiveEvent

    s = Store(db_path, clock=AdvancingClock(T0))
    q = s.subscribe()
    s.start_firing()
    s.publish_sample(temp_f=847.0)
    s.stop_firing()
    for _ in range(3):
        LiveEvent.model_validate(q.get(timeout=0.5))


def test_samples_returns_the_series(db_path) -> None:
    s = Store(db_path, clock=AdvancingClock(T0))
    firing = s.start_firing()
    for temp in (70.0, 120.0, 300.0):
        s.publish_sample(temp_f=temp)
    series = s.samples(firing.id)
    assert [round(x.temp_f) for x in series] == [70, 120, 300]


def test_active_firing_is_rehydrated_by_a_new_store(db_path) -> None:
    """A restart mid-firing: a fresh Store on the same db resumes."""
    s1 = Store(db_path, clock=AdvancingClock(T0))
    started = s1.start_firing()
    s1.publish_sample(temp_f=275.0)

    s2 = Store(db_path, clock=AdvancingClock(T0))  # "restart"
    resumed = s2.firing()
    assert resumed is not None
    assert resumed.id == started.id
    assert resumed.status == "active"
    assert s2.latest_sample() is not None
    assert s2.latest_sample().temp_f == 275.0


def test_ended_firing_is_not_rehydrated(db_path) -> None:
    s1 = Store(db_path, clock=FixedClock(T0))
    s1.start_firing()
    s1.stop_firing()
    s2 = Store(db_path, clock=FixedClock(T0))
    assert s2.firing() is None


def test_samples_persist_across_store_instances(db_path) -> None:
    s1 = Store(db_path, clock=AdvancingClock(T0))
    firing = s1.start_firing()
    s1.publish_sample(temp_f=88.0)
    s2 = Store(db_path, clock=AdvancingClock(T0))
    assert [round(x.temp_f) for x in s2.samples(firing.id)] == [88]
```

- [ ] **Step 2: Run; verify failure**

Run: `cd web/backend && uv run pytest tests/test_store.py -v`
Expected: failures — `Store` does not yet take `db_path` / lacks `samples`.

- [ ] **Step 3: Rewrite `web/backend/src/udcpine_backend/store.py`**

```python
"""SQLite-backed session state for the dashboard.

SQLite is authoritative. The Store keeps two in-memory caches — the active
firing and the latest sample — purely as a read-through optimization so
that /api/state and the 1 Hz sensor tick don't hit the database to read.
Every mutation writes through to SQLite and updates the cache under one
lock. On construction the Store rehydrates the caches from the database,
so a restart mid-firing resumes cleanly.

Published events are plain dicts (see test_store.py's contract test); the
SSE pub/sub is in-memory and ephemeral by design.
"""

from __future__ import annotations

import queue
import threading
from typing import Any

from generated.pydantic import Firing, Sample

from .db import connect
from .time_source import Clock, SystemClock


def _firing_from_row(row: Any) -> Firing:
    return Firing.model_validate(
        {
            "id": row["id"],
            "started_at": row["started_at"],
            "ended_at": row["ended_at"],
            "status": row["status"],
        }
    )


class Store:
    def __init__(self, db_path: str, clock: Clock | None = None) -> None:
        self._clock: Clock = clock if clock is not None else SystemClock()
        self._lock = threading.Lock()
        self._conn = connect(db_path)
        self._subscribers: list[queue.Queue[dict[str, Any]]] = []
        self._firing: Firing | None = None
        self._latest_sample: Sample | None = None
        self._rehydrate()

    def _rehydrate(self) -> None:
        """Load any active firing (and its latest sample) into the caches."""
        row = self._conn.execute(
            "SELECT * FROM firing WHERE status='active' ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if row is None:
            return
        self._firing = _firing_from_row(row)
        srow = self._conn.execute(
            "SELECT t, temp_f FROM sample WHERE firing_id=? ORDER BY id DESC LIMIT 1",
            (self._firing.id,),
        ).fetchone()
        if srow is not None:
            self._latest_sample = Sample(t=srow["t"], temp_f=srow["temp_f"])

    # ---- state accessors --------------------------------------------------
    def firing(self) -> Firing | None:
        with self._lock:
            return self._firing

    def latest_sample(self) -> Sample | None:
        with self._lock:
            return self._latest_sample

    def samples(self, firing_id: int) -> list[Sample]:
        """The full sample series for a firing, oldest first."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT t, temp_f FROM sample WHERE firing_id=? ORDER BY id",
                (firing_id,),
            ).fetchall()
        return [Sample(t=r["t"], temp_f=r["temp_f"]) for r in rows]

    # ---- mutators ---------------------------------------------------------
    def start_firing(self) -> Firing:
        with self._lock:
            if self._firing is not None:
                return self._firing
            started_at = self._clock.now().isoformat()
            cur = self._conn.execute(
                "INSERT INTO firing (started_at, ended_at, status) VALUES (?, NULL, 'active')",
                (started_at,),
            )
            self._conn.commit()
            firing = Firing.model_validate(
                {
                    "id": cur.lastrowid,
                    "started_at": started_at,
                    "ended_at": None,
                    "status": "active",
                }
            )
            self._firing = firing
            self._latest_sample = None
            event: dict[str, Any] = {
                "type": "firing_started",
                "firing": firing.model_dump(mode="json"),
            }
        self._broadcast(event)
        return firing

    def stop_firing(self) -> Firing | None:
        with self._lock:
            if self._firing is None:
                return None
            ended_at = self._clock.now().isoformat()
            self._conn.execute(
                "UPDATE firing SET ended_at=?, status='ended' WHERE id=?",
                (ended_at, self._firing.id),
            )
            self._conn.commit()
            ended = self._firing.model_copy(
                update={"ended_at": self._clock.now(), "status": "ended"}
            )
            firing_id = ended.id
            self._firing = None
            self._latest_sample = None
            event: dict[str, Any] = {"type": "firing_ended", "firing_id": firing_id}
        self._broadcast(event)
        return ended

    def publish_sample(self, *, temp_f: float) -> None:
        """Record a hearth reading for the active firing. A no-op when the
        oven is idle — a sample belongs to a firing."""
        with self._lock:
            if self._firing is None:
                return
            t = self._clock.now()
            self._conn.execute(
                "INSERT INTO sample (firing_id, t, temp_f) VALUES (?, ?, ?)",
                (self._firing.id, t.isoformat(), temp_f),
            )
            self._conn.commit()
            self._latest_sample = Sample(t=t, temp_f=temp_f)
            event: dict[str, Any] = {
                "type": "sample",
                "t": t.isoformat(),
                "temp_f": temp_f,
            }
        self._broadcast(event)

    # ---- pub/sub ----------------------------------------------------------
    def subscribe(self) -> queue.Queue[dict[str, Any]]:
        q: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=1024)
        with self._lock:
            self._subscribers.append(q)
        return q

    def unsubscribe(self, q: queue.Queue[dict[str, Any]]) -> None:
        with self._lock:
            if q in self._subscribers:
                self._subscribers.remove(q)

    def _broadcast(self, event: dict[str, Any]) -> None:
        with self._lock:
            subs = list(self._subscribers)
        for q in subs:
            try:
                q.put_nowait(event)
            except queue.Full:
                self.unsubscribe(q)
```

- [ ] **Step 4: Run all store tests**

Run: `cd web/backend && uv run pytest tests/test_store.py -v`
Expected: 17 PASS.

- [ ] **Step 5: Commit**

```bash
git add web/backend/src/udcpine_backend/store.py web/backend/tests/test_store.py
git commit -m "feat(web): SQLite-backed Store with rehydration + sample series"
```

---

## Task 3: Wire `db_path` into `create_app` + fix the API tests

**Files:**
- Modify: `web/backend/src/udcpine_backend/app.py`
- Modify: `web/backend/tests/test_api.py`
- Modify: `web/frontend/playwright.config.ts`

- [ ] **Step 1: Resolve the DB path in `create_app`**

In `web/backend/src/udcpine_backend/app.py`, the default `Store()`
construction must now supply a path. Change the imports to add `os` if not
already present (it is — used for the bootstrap token), and change the
default-store line.

Find:

```python
    s = store if store is not None else Store()
```

Replace with:

```python
    db_path = os.environ.get("UDCPINE_DB_PATH", "udcpine.db")
    s = store if store is not None else Store(db_path)
```

- [ ] **Step 2: Give the API tests a per-test database**

In `web/backend/tests/test_api.py`, the `store` fixture currently does
`return Store()`. It needs a path. Change:

```python
@pytest.fixture()
def store() -> Store:
    return Store()
```

to:

```python
@pytest.fixture()
def store(tmp_path) -> Store:
    return Store(str(tmp_path / "api.db"))
```

- [ ] **Step 3: Run the full backend suite**

Run: `cd web/backend && uv run pytest -v`
Expected: all pass — `test_db.py` (4), `test_store.py` (17), `test_auth_store.py` (7), `test_mock_sensor.py` (5), `test_api.py` (14). Total 47.

- [ ] **Step 4: Make the e2e backend hermetic**

In `web/frontend/playwright.config.ts`, the backend `webServer` entry sets
`env: { UDCPINE_BOOTSTRAP_TOKEN: "e2e-bootstrap-token" }`. Add an in-memory
DB so each e2e run starts with an empty database (no firings carried over
between runs):

```typescript
      env: {
        UDCPINE_BOOTSTRAP_TOKEN: "e2e-bootstrap-token",
        UDCPINE_DB_PATH: ":memory:",
      },
```

`:memory:` lives for the life of the single shared connection — i.e. the
life of the backend process Playwright starts — so it is empty per run and
needs no cleanup.

- [ ] **Step 5: Commit**

```bash
git add web/backend/src/udcpine_backend/app.py web/backend/tests/test_api.py web/frontend/playwright.config.ts
git commit -m "feat(web): wire UDCPINE_DB_PATH; hermetic e2e database"
```

---

## Task 4: Ignore the DB file + a `db-reset` convenience

**Files:**
- Modify: `.gitignore`
- Modify: `web/backend/Makefile.include`
- Modify: `Makefile`

- [ ] **Step 1: Ignore SQLite files**

Append to `.gitignore` (under the Python section):

```
# SQLite (local dev database + WAL sidecars)
*.db
*.db-wal
*.db-shm
```

- [ ] **Step 2: Add a `db-reset` target to `web/backend/Makefile.include`**

Add `web-backend-db-reset` to the `.PHONY` line, and add the target:

```make
web-backend-db-reset:
	rm -f $(WEB_BACKEND_DIR)/udcpine.db $(WEB_BACKEND_DIR)/udcpine.db-wal $(WEB_BACKEND_DIR)/udcpine.db-shm
	@echo "local dev database wiped"
```

- [ ] **Step 3: Surface it from the top-level `Makefile`**

Add `db-reset` to the `.PHONY` list, add a `help` line under `dev`:

```make
	@echo "  db-reset  delete the local dev SQLite database"
```

and add the target:

```make
db-reset: web-backend-db-reset
```

- [ ] **Step 4: Verify**

Run: `make dev`, let it start, `Ctrl-C`. Confirm `web/backend/udcpine.db`
now exists. Run `make db-reset`; confirm the file is gone. Confirm
`git status` does not list the `.db` file (it's ignored).

- [ ] **Step 5: Commit**

```bash
git add .gitignore web/backend/Makefile.include Makefile
git commit -m "chore(web): gitignore SQLite files + make db-reset"
```

---

## Task 5: End-to-end verification

**Files:** none — verification only.

- [ ] **Step 1: Full local gate**

```bash
make build && make codegen && make lint && make test && make e2e
```
Expected: all green; `git status` clean. `make test` = 19 shared + 47
backend; `make e2e` = 4 passing.

- [ ] **Step 2: Manual persistence check — restart mid-firing**

Run `make db-reset` then `make dev`. Pair (open the printed bootstrap
link). Click START FIRING; let the temperature climb for ~15 s. Note the
firing number and the current temperature.

`Ctrl-C` the servers. Run `make dev` again. Reload the dashboard.

Expected: the **same** firing is still active (same firing number), the
elapsed clock has kept advancing, and the temperature picks up where the
mock ramp is now — i.e. the firing survived the restart. Before this plan,
a restart would have dropped you back to the idle screen.

- [ ] **Step 3: Inspect the database directly**

```bash
sqlite3 web/backend/udcpine.db "SELECT id, status FROM firing; SELECT count(*) FROM sample;"
```
Expected: the firing row(s) with their status, and a non-zero sample count
(~1 row/second of firing).

- [ ] **Step 4: Stop the servers; `make db-reset` to clean up.**

- [ ] **Step 5: Done — no commit.**

After the PR is pushed, confirm CI's `shared` and `e2e` jobs pass.

---

## Self-review checklist

- [ ] Every file in File Structure has a creating or modifying task.
- [ ] No "TBD"/"TODO"/"implement later" in any task body.
- [ ] `Store.__init__(db_path, clock=None)` — `db_path` first/required; used consistently by `create_app` (Task 3) and every test (Task 2).
- [ ] `publish_sample` is a no-op with no active firing — covered by `test_publish_sample_without_a_firing_is_a_noop`, and the pub/sub tests now `start_firing()` first.
- [ ] Rehydration is tested both for an active firing (resumes) and an ended firing (does not resume).
- [ ] `sample` uses an autoincrement PK (not `(firing_id, t)`), so fixed-clock tests don't collide — decision noted.
- [ ] e2e backend uses `:memory:` so runs are hermetic; the dev default is a gitignored file.
- [ ] No `shared/` or frontend `src/` changes — SQLite is purely backend-internal; wire types unchanged.
- [ ] Auth tables, `pizza`, `upload_queue` are explicitly out of scope — no stray tables in `schema.sql`.
- [ ] CLAUDE.md workflow respected: completion is push + PR; no destructive GitHub writes.
```
