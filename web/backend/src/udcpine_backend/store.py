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
