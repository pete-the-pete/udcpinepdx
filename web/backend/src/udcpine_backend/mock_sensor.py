"""Background thread that produces mock 1Hz hearth samples while a
firing is active. The temperature curve is:

  - linear climb from 70°F at t=0 → 850°F at t=600s,
  - then a steady plateau at 850°F with small ±5°F noise.

Noise is deterministic (seeded by integer-seconds elapsed) so tests can
assert exact values.
"""

from __future__ import annotations

import math
import threading
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .store import Store

START_TEMP_F = 70.0
TARGET_TEMP_F = 850.0
RAMP_SECONDS = 600
NOISE_BAND_F = 5.0


def ramp_temp_f(*, elapsed_s: float) -> float:
    """Pure function: elapsed seconds since firing start → degrees F."""
    if elapsed_s <= 0:
        return START_TEMP_F
    if elapsed_s <= RAMP_SECONDS:
        slope = (TARGET_TEMP_F - START_TEMP_F) / RAMP_SECONDS
        return START_TEMP_F + slope * elapsed_s
    # Plateau with deterministic noise: a low-frequency sine keyed by the
    # integer second. Avoids RNG state so the function stays pure.
    noise = math.sin(elapsed_s * 0.137) * NOISE_BAND_F
    return TARGET_TEMP_F + noise


class MockSensorThread(threading.Thread):
    """Publishes one sample/second to the store while a firing is active."""

    def __init__(self, store: "Store", interval_s: float = 1.0) -> None:
        super().__init__(daemon=True, name="mock-sensor")
        self._store = store
        self._interval_s = interval_s
        self._stop = threading.Event()

    def stop(self) -> None:
        self._stop.set()

    def run(self) -> None:
        while not self._stop.is_set():
            firing = self._store.firing()
            if firing is not None:
                elapsed = (
                    self._store._clock.now() - firing.started_at  # noqa: SLF001
                ).total_seconds()
                self._store.publish_sample(temp_f=ramp_temp_f(elapsed_s=elapsed))
            self._stop.wait(self._interval_s)
