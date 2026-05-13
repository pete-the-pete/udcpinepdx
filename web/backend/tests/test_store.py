"""Store: thread-safe in-memory session state."""

from __future__ import annotations

from datetime import datetime, timezone


from udcpine_backend.store import Store
from udcpine_backend.time_source import Clock


class FixedClock(Clock):
    def __init__(self, when: datetime) -> None:
        self._when = when

    def now(self) -> datetime:
        return self._when


T0 = datetime(2026, 5, 12, 18, 0, 0, tzinfo=timezone.utc)


def test_new_store_is_idle() -> None:
    s = Store(clock=FixedClock(T0))
    assert s.firing() is None
    assert s.latest_sample() is None


def test_start_firing_creates_active_firing() -> None:
    s = Store(clock=FixedClock(T0))
    firing = s.start_firing()
    assert firing.status == "active"
    assert firing.id >= 0
    assert firing.ended_at is None
    assert s.firing() is firing


def test_starting_while_active_returns_existing_firing() -> None:
    s = Store(clock=FixedClock(T0))
    first = s.start_firing()
    second = s.start_firing()
    assert first is second


def test_stop_firing_marks_ended() -> None:
    s = Store(clock=FixedClock(T0))
    s.start_firing()
    ended = s.stop_firing()
    assert ended is not None
    assert ended.status == "ended"
    assert ended.ended_at is not None
    assert s.firing() is None


def test_stop_while_idle_returns_none() -> None:
    s = Store(clock=FixedClock(T0))
    assert s.stop_firing() is None


def test_firing_ids_increment_across_sessions() -> None:
    s = Store(clock=FixedClock(T0))
    f1 = s.start_firing()
    s.stop_firing()
    f2 = s.start_firing()
    assert f2.id == f1.id + 1
