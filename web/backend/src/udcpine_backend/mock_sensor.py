"""Background thread that produces mock 1Hz hearth samples: a heating ramp
while a firing is active, and a cool idle-ambient reading when the oven is
idle (so the start screen shows a live temperature before a firing).

The temperature curves are:

  - **Firing ramp:** linear climb from 21°C at t=0 → 454°C at t=600s,
    then a steady plateau at 454°C with small ±3°C noise.
  - **Idle ambient:** a gently-varying reading near 22.5°C (±2.5°C),
    so the dashboard shows a live number before any firing starts.

Noise is deterministic (seeded by integer-seconds elapsed or an integer
tick counter) so tests can assert exact values.

The thread is gated on the `UDCPINE_MOCK_SENSOR` env var (default off) so
a real Pi publishing samples via `/api/ingest/sample` is not shadowed by
a parallel mock stream. Tests that exercise the mock loop set the var
explicitly.
"""

from __future__ import annotations

import math
import os
import threading
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .store import Store

START_TEMP_C = 21.0
TARGET_TEMP_C = 454.0
RAMP_SECONDS = 600
NOISE_BAND_C = 3.0
AMBIENT_TEMP_C = 22.5
AMBIENT_NOISE_BAND_C = 2.5


def ramp_temp_c(*, elapsed_s: float) -> float:
    """Pure function: elapsed seconds since firing start → degrees C."""
    if elapsed_s <= 0:
        return START_TEMP_C
    if elapsed_s <= RAMP_SECONDS:
        slope = (TARGET_TEMP_C - START_TEMP_C) / RAMP_SECONDS
        return START_TEMP_C + slope * elapsed_s
    # Plateau with deterministic noise: a low-frequency sine keyed by the
    # integer second. Avoids RNG state so the function stays pure.
    noise = math.sin(elapsed_s * 0.137) * NOISE_BAND_C
    return TARGET_TEMP_C + noise


def ambient_temp_c(*, tick: int) -> float:
    """Pure function: a gently-varying cool reading for an IDLE oven, so the
    start screen shows a live ambient temperature before a firing. Keyed on an
    integer tick (deterministic, like ``ramp_temp_c``). Stays within ~20-25 °C.
    """
    return AMBIENT_TEMP_C + math.sin(tick * 0.137) * AMBIENT_NOISE_BAND_C


def mock_sensor_enabled() -> bool:
    """True iff `UDCPINE_MOCK_SENSOR` is set to a truthy value.

    Off by default — the production deploy expects samples from the Pi's
    real thermocouple. Tests opt in explicitly via env var or by
    instantiating MockSensorThread directly.
    """
    val = os.environ.get("UDCPINE_MOCK_SENSOR", "").strip().lower()
    return val in {"1", "true", "yes", "on"}


class MockSensorThread(threading.Thread):
    """Publishes one sample/second to the store while a firing is active."""

    def __init__(self, store: "Store", interval_s: float = 1.0) -> None:
        super().__init__(daemon=True, name="mock-sensor")
        self._store = store
        self._interval_s = interval_s
        self._stop_event = threading.Event()
        self._idle_tick = 0

    def stop(self) -> None:
        self._stop_event.set()

    def run(self) -> None:
        while not self._stop_event.is_set():
            firing = self._store.firing()
            if firing is not None:
                elapsed = (
                    self._store._clock.now() - firing.started_at  # noqa: SLF001
                ).total_seconds()
                self._store.publish_sample(temp_c=ramp_temp_c(elapsed_s=elapsed))
            else:
                self._store.publish_sample(temp_c=ambient_temp_c(tick=self._idle_tick))
                self._idle_tick += 1
            self._stop_event.wait(self._interval_s)
