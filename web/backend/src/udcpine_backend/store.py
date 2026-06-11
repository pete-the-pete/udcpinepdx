"""SQLite-backed session state for the dashboard.

SQLite is authoritative. The Store keeps in-memory caches for the active
firing, the latest sample, and the active pizza, purely as a read-through
optimization so that /api/state and the 1 Hz sensor tick don't hit the
database to read. Every mutation writes through to SQLite and updates the
cache under one lock. On construction the Store rehydrates the caches
from the database, so a restart mid-firing resumes cleanly.

Published events are plain dicts (see test_store.py's contract test); the
SSE pub/sub is in-memory and ephemeral by design.
"""

from __future__ import annotations

import queue
import threading
from typing import Any

from generated.pydantic import Firing, Pizza, Sample

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


def _pizza_from_row(row: Any) -> Pizza:
    return Pizza.model_validate(
        {
            "id": row["id"],
            "firing_id": row["firing_id"],
            "seq": row["seq"],
            "name": row["name"],
            "started_at": row["started_at"],
            "ended_at": row["ended_at"],
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
        self._active_pizza: Pizza | None = None
        self._rehydrate()

    def _rehydrate(self) -> None:
        """Load any active firing, its latest sample, and its active pizza."""
        row = self._conn.execute(
            "SELECT * FROM firing WHERE status='active' ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if row is None:
            return
        self._firing = _firing_from_row(row)
        srow = self._conn.execute(
            "SELECT t, temp_c FROM sample WHERE firing_id=? ORDER BY id DESC LIMIT 1",
            (self._firing.id,),
        ).fetchone()
        if srow is not None:
            self._latest_sample = Sample(t=srow["t"], temp_c=srow["temp_c"])
        prow = self._conn.execute(
            "SELECT * FROM pizza WHERE firing_id=? AND ended_at IS NULL ORDER BY seq DESC LIMIT 1",
            (self._firing.id,),
        ).fetchone()
        if prow is not None:
            self._active_pizza = _pizza_from_row(prow)

    # ---- state accessors --------------------------------------------------
    def firing(self) -> Firing | None:
        with self._lock:
            return self._firing

    def latest_sample(self) -> Sample | None:
        with self._lock:
            return self._latest_sample

    def active_pizza(self) -> Pizza | None:
        with self._lock:
            return self._active_pizza

    def samples(self, firing_id: int) -> list[Sample]:
        """The full sample series for a firing, oldest first."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT t, temp_c FROM sample WHERE firing_id=? ORDER BY id",
                (firing_id,),
            ).fetchall()
        return [Sample(t=r["t"], temp_c=r["temp_c"]) for r in rows]

    def pizzas(self, firing_id: int) -> list[Pizza]:
        """All pizzas for a firing, in seq order."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM pizza WHERE firing_id=? ORDER BY seq",
                (firing_id,),
            ).fetchall()
        return [_pizza_from_row(r) for r in rows]

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
            self._active_pizza = None
            event: dict[str, Any] = {
                "type": "firing_started",
                "firing": firing.model_dump(mode="json"),
            }
        self._broadcast(event)
        return firing

    def stop_firing(self) -> Firing | None:
        events: list[dict[str, Any]] = []
        with self._lock:
            if self._firing is None:
                return None
            ended_pizza = self._end_active_pizza_locked()
            if ended_pizza is not None:
                events.append({"type": "pizza_ended", "pizza": ended_pizza.model_dump(mode="json")})
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
            events.append({"type": "firing_ended", "firing_id": firing_id})
        for ev in events:
            self._broadcast(ev)
        return ended

    def publish_sample(self, *, temp_c: float) -> None:
        """Record a hearth reading. The in-memory latest reading and the SSE
        broadcast happen on EVERY call — including when the oven is idle — so
        the start screen can show a live ambient temperature before a firing
        begins. A persisted ``sample`` row is written only while a firing is
        active; an idle reading is transient (in-memory only, lost on restart).

        Temperature is degrees Celsius. The frontend converts to °F at
        render time; storage and the wire stay metric.
        """
        with self._lock:
            t = self._clock.now()
            if self._firing is not None:
                self._conn.execute(
                    "INSERT INTO sample (firing_id, t, temp_c) VALUES (?, ?, ?)",
                    (self._firing.id, t.isoformat(), temp_c),
                )
                self._conn.commit()
            self._latest_sample = Sample(t=t, temp_c=temp_c)
            event: dict[str, Any] = {
                "type": "sample",
                "t": t.isoformat(),
                "temp_c": temp_c,
            }
        self._broadcast(event)

    def _end_active_pizza_locked(self) -> Pizza | None:
        """Caller must hold self._lock. Returns the ended pizza, or None."""
        if self._active_pizza is None:
            return None
        ended_at = self._clock.now().isoformat()
        self._conn.execute(
            "UPDATE pizza SET ended_at=? WHERE id=?",
            (ended_at, self._active_pizza.id),
        )
        self._conn.commit()
        ended = self._active_pizza.model_copy(update={"ended_at": self._clock.now()})
        self._active_pizza = None
        return ended

    def end_active_pizza(self) -> Pizza | None:
        with self._lock:
            ended = self._end_active_pizza_locked()
            if ended is None:
                return None
            event: dict[str, Any] = {
                "type": "pizza_ended",
                "pizza": ended.model_dump(mode="json"),
            }
        self._broadcast(event)
        return ended

    def next_pizza(self, *, name: str) -> Pizza | None:
        """End any active pizza, then start a new one with `name`. Returns
        the new pizza, or None if no firing is active."""
        events: list[dict[str, Any]] = []
        with self._lock:
            if self._firing is None:
                return None
            ended = self._end_active_pizza_locked()
            if ended is not None:
                events.append({"type": "pizza_ended", "pizza": ended.model_dump(mode="json")})
            row = self._conn.execute(
                "SELECT COALESCE(MAX(seq), 0) AS s FROM pizza WHERE firing_id=?",
                (self._firing.id,),
            ).fetchone()
            seq = row["s"] + 1
            started_at = self._clock.now().isoformat()
            cur = self._conn.execute(
                "INSERT INTO pizza (firing_id, seq, name, started_at, ended_at) VALUES (?, ?, ?, ?, NULL)",
                (self._firing.id, seq, name, started_at),
            )
            self._conn.commit()
            pizza = Pizza.model_validate(
                {
                    "id": cur.lastrowid,
                    "firing_id": self._firing.id,
                    "seq": seq,
                    "name": name,
                    "started_at": started_at,
                    "ended_at": None,
                }
            )
            self._active_pizza = pizza
            events.append({"type": "pizza_started", "pizza": pizza.model_dump(mode="json")})
        for ev in events:
            self._broadcast(ev)
        return pizza

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

    def broadcast_break_sentinel(self) -> None:
        """Test-only: wake all SSE subscribers with a sentinel that signals
        them to close the stream. Used by /api/_test/break-stream."""
        with self._lock:
            for q in list(self._subscribers):
                q.put({"__break__": True})

    def _broadcast(self, event: dict[str, Any]) -> None:
        with self._lock:
            subs = list(self._subscribers)
        for q in subs:
            try:
                q.put_nowait(event)
            except queue.Full:
                self.unsubscribe(q)
