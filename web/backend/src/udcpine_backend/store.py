"""In-memory session state for the dashboard.

A Store instance is the single source of truth for "what's the oven doing
right now." It holds at most one active firing, the most recent sample,
and a list of SSE subscribers (added in a later task). All access is
serialized by an internal lock so the Flask threadpool and the mock
sensor thread can hit it concurrently without races.
"""

from __future__ import annotations

import threading

from generated.pydantic import Firing, Sample

from .time_source import Clock, SystemClock


class Store:
    def __init__(self, clock: Clock | None = None) -> None:
        self._clock: Clock = clock if clock is not None else SystemClock()
        self._lock = threading.Lock()
        self._firing: Firing | None = None
        self._latest_sample: Sample | None = None
        self._next_id = 1

    def firing(self) -> Firing | None:
        with self._lock:
            return self._firing

    def latest_sample(self) -> Sample | None:
        with self._lock:
            return self._latest_sample

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
            return firing

    def stop_firing(self) -> Firing | None:
        with self._lock:
            if self._firing is None:
                return None
            ended = self._firing.model_copy(
                update={"ended_at": self._clock.now(), "status": "ended"}
            )
            self._firing = None
            self._latest_sample = None
            return ended
