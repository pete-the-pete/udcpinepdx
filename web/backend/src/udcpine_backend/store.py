"""In-memory session state for the dashboard.

A Store instance is the single source of truth for "what's the oven doing
right now." It holds at most one active firing, the most recent sample,
and a list of SSE subscribers. All access is serialized by an internal
lock so the Flask threadpool and the mock sensor thread can hit it
concurrently without races.

Published events are plain dicts (NOT Pydantic models). The SSE handler
JSON-encodes them; tests assert their shape directly. A server-side
contract test (test_store.py) validates that emitted dicts round-trip
through the generated LiveEvent Pydantic class, so dict-shape drift is
caught here rather than on the frontend.
"""

from __future__ import annotations

import queue
import threading
from typing import Any

from generated.pydantic import Firing, Sample

from .time_source import Clock, SystemClock


class Store:
    def __init__(self, clock: Clock | None = None) -> None:
        self._clock: Clock = clock if clock is not None else SystemClock()
        self._lock = threading.Lock()
        self._firing: Firing | None = None
        self._latest_sample: Sample | None = None
        self._next_id = 1
        self._subscribers: list[queue.Queue[dict[str, Any]]] = []

    # ---- state accessors --------------------------------------------------
    def firing(self) -> Firing | None:
        with self._lock:
            return self._firing

    def latest_sample(self) -> Sample | None:
        with self._lock:
            return self._latest_sample

    # ---- mutators ---------------------------------------------------------
    def start_firing(self) -> Firing:
        with self._lock:
            if self._firing is not None:
                return self._firing
            firing = Firing(
                id=self._next_id,
                started_at=self._clock.now(),
                ended_at=None,
                status="active",
            )
            self._next_id += 1
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
        with self._lock:
            t = self._clock.now()
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
                # A subscriber that can't keep up is treated as dropped; the
                # client will reconnect and re-prime from /api/state.
                self.unsubscribe(q)
