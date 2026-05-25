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
