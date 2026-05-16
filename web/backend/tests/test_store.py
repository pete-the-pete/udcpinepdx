"""Store: thread-safe in-memory session state."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

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


def test_subscriber_receives_published_event() -> None:
    s = Store(clock=FixedClock(T0))
    q = s.subscribe()
    s.publish_sample(temp_f=847.0)
    event = q.get(timeout=0.5)
    assert event["type"] == "sample"
    assert event["temp_f"] == 847.0
    assert "t" in event


def test_start_firing_publishes_firing_started() -> None:
    s = Store(clock=FixedClock(T0))
    q = s.subscribe()
    s.start_firing()
    event = q.get(timeout=0.5)
    assert event["type"] == "firing_started"
    assert event["firing"]["status"] == "active"


def test_stop_firing_publishes_firing_ended() -> None:
    s = Store(clock=FixedClock(T0))
    s.start_firing()
    q = s.subscribe()
    s.stop_firing()
    event = q.get(timeout=0.5)
    assert event["type"] == "firing_ended"
    assert "firing_id" in event


def test_publish_sample_updates_latest_sample() -> None:
    s = Store(clock=FixedClock(T0))
    s.publish_sample(temp_f=200.0)
    assert s.latest_sample() is not None
    assert s.latest_sample().temp_f == 200.0


def test_unsubscribe_stops_delivery() -> None:
    s = Store(clock=FixedClock(T0))
    q = s.subscribe()
    s.unsubscribe(q)
    s.publish_sample(temp_f=100.0)
    with pytest.raises(Exception):
        q.get(timeout=0.05)


def test_emitted_events_validate_against_live_event_schema() -> None:
    """Server-side contract test: every dict the Store broadcasts must
    validate against the generated LiveEvent Pydantic class. Catches
    drift between the Store's hand-built dict shape and the shared
    schema — e.g. a typo in `"type"` or a missing field that would
    otherwise only fail silently on the frontend."""
    from generated.pydantic import LiveEvent

    s = Store(clock=FixedClock(T0))
    q = s.subscribe()
    s.start_firing()
    s.publish_sample(temp_f=847.0)
    s.stop_firing()

    for _ in range(3):
        event = q.get(timeout=0.5)
        LiveEvent.model_validate(event)
