"""Hardcoded live state for the first vertical slice.

Replaced in plan B by an in-memory state populated from sensord; replaced in
plan C by SQLite-backed state. Kept deliberately dumb so it's obvious when
it's being used.

Timestamps are computed at request time so the dashboard's elapsed clocks
look alive (the pizza is "always" ~1:42 in, growing each refresh) rather
than stuck at a fixed moment in the past.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from generated.pydantic import Firing, LiveState, Pizza, Sample


def current_state() -> LiveState:
    now = datetime.now(timezone.utc)
    pizza_started = now - timedelta(seconds=102)
    return LiveState(
        firing=Firing(
            id=42,
            started_at="2026-04-28T18:24:00-07:00",
            ended_at=None,
            status="active",
        ),
        latest_sample=Sample(t=now, temp_f=847.0),
        active_pizza=Pizza(
            id=3,
            seq=3,
            name="Margherita",
            started_at=pizza_started,
            target_seconds=150,
        ),
    )
