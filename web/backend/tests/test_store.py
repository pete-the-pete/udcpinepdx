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


def test_new_store_has_no_active_pizza(db_path) -> None:
    s = Store(db_path, clock=FixedClock(T0))
    s.start_firing()
    assert s.active_pizza() is None


def test_next_pizza_starts_first_pizza(db_path) -> None:
    s = Store(db_path, clock=FixedClock(T0))
    firing = s.start_firing()
    pizza = s.next_pizza(name="Margherita")
    assert pizza is not None
    assert pizza.firing_id == firing.id
    assert pizza.seq == 1
    assert pizza.name == "Margherita"
    assert pizza.ended_at is None
    assert s.active_pizza() == pizza


def test_next_pizza_ends_previous_and_increments_seq(db_path) -> None:
    s = Store(db_path, clock=AdvancingClock(T0))
    s.start_firing()
    first = s.next_pizza(name="Margherita")
    second = s.next_pizza(name="Funghi")
    assert second.seq == first.seq + 1
    history = s.pizzas(first.firing_id)
    by_seq = {p.seq: p for p in history}
    assert by_seq[1].ended_at is not None
    assert by_seq[2].ended_at is None
    assert s.active_pizza() == second


def test_next_pizza_with_no_firing_returns_none(db_path) -> None:
    s = Store(db_path, clock=FixedClock(T0))
    assert s.next_pizza(name="Margherita") is None
    assert s.active_pizza() is None


def test_end_active_pizza_returns_the_ended_pizza(db_path) -> None:
    s = Store(db_path, clock=AdvancingClock(T0))
    s.start_firing()
    started = s.next_pizza(name="Margherita")
    ended = s.end_active_pizza()
    assert ended is not None
    assert ended.id == started.id
    assert ended.ended_at is not None
    assert s.active_pizza() is None


def test_end_active_pizza_when_none_returns_none(db_path) -> None:
    s = Store(db_path, clock=FixedClock(T0))
    s.start_firing()
    assert s.end_active_pizza() is None


def test_stop_firing_auto_ends_active_pizza(db_path) -> None:
    s = Store(db_path, clock=AdvancingClock(T0))
    firing = s.start_firing()
    s.next_pizza(name="Margherita")
    s.stop_firing()
    assert s.active_pizza() is None
    [pizza] = s.pizzas(firing.id)
    assert pizza.ended_at is not None


def test_pizza_events_broadcast(db_path) -> None:
    s = Store(db_path, clock=AdvancingClock(T0))
    s.start_firing()
    q = s.subscribe()
    s.next_pizza(name="Margherita")
    e1 = q.get(timeout=0.5)
    assert e1["type"] == "pizza_started"
    assert e1["pizza"]["name"] == "Margherita"
    s.next_pizza(name="Funghi")
    e2 = q.get(timeout=0.5)
    e3 = q.get(timeout=0.5)
    assert e2["type"] == "pizza_ended"
    assert e2["pizza"]["name"] == "Margherita"
    assert e2["pizza"]["ended_at"] is not None
    assert e3["type"] == "pizza_started"
    assert e3["pizza"]["name"] == "Funghi"


def test_emitted_pizza_events_validate_against_schema(db_path) -> None:
    from generated.pydantic import LiveEvent

    s = Store(db_path, clock=AdvancingClock(T0))
    q = s.subscribe()
    s.start_firing()
    s.next_pizza(name="Margherita")
    s.next_pizza(name="Funghi")
    s.stop_firing()
    # 6 events: firing_started, pizza_started, pizza_ended, pizza_started,
    # pizza_ended (auto on stop), firing_ended.
    for _ in range(6):
        LiveEvent.model_validate(q.get(timeout=0.5))


def test_active_pizza_is_rehydrated_by_a_new_store(db_path) -> None:
    s1 = Store(db_path, clock=AdvancingClock(T0))
    s1.start_firing()
    started = s1.next_pizza(name="Margherita")
    s2 = Store(db_path, clock=AdvancingClock(T0))
    resumed = s2.active_pizza()
    assert resumed is not None
    assert resumed.id == started.id
    assert resumed.name == "Margherita"
    assert resumed.ended_at is None
