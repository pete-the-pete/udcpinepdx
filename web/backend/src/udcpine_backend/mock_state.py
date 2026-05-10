"""Hardcoded firing state for the first vertical slice.

Replaced in plan B by an in-memory state populated from sensord; replaced in
plan C by SQLite-backed state. Kept deliberately dumb so it's obvious when
it's being used.
"""

from __future__ import annotations

from generated.pydantic import Firing


def current_firing() -> Firing:
    return Firing(
        id=42,
        started_at="2026-04-28T18:24:00-07:00",
        ended_at=None,
        status="active",
    )
