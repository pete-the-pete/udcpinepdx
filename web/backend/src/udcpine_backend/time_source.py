"""A tiny clock abstraction so tests can pin time.

Production code calls SystemClock.now(); tests pass a fake.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Protocol


class Clock(Protocol):
    def now(self) -> datetime: ...


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(timezone.utc)
