"""Thermocouple sensor abstractions.

The real sensor reads the MAX6675 directly over Linux ``spidev``. The
MAX6675 protocol is a single 16-bit SPI read per sample — no Adafruit
Blinka layer is needed. ``spidev`` is Linux-only, so the import lives
inside ``RealSensor`` to keep this module import-safe on macOS, in CI,
and during ``--simulate`` runs.
"""

from __future__ import annotations

import math
import random
from typing import Protocol


class Sensor(Protocol):
    def read_temp_c(self) -> float:
        """Return the current temperature in degrees Celsius.

        Raises:
            SensorError: open thermocouple, SPI fault, or any other transient
                hardware failure. Callers log and skip the sample.
        """
        ...


class SensorError(RuntimeError):
    """Raised when a sensor read fails (open thermocouple, SPI fault, etc.)."""


class FakeSensor:
    """Deterministic-ish synthetic sensor for tests and --simulate.

    Produces a slow sinusoid around ``baseline_c`` with small Gaussian noise.
    Suitable both for tests (with a fixed seed) and for end-to-end laptop
    runs where the dashboard just needs *something* ticking.
    """

    def __init__(
        self,
        baseline_c: float = 250.0,
        amplitude_c: float = 25.0,
        period_s: float = 60.0,
        noise_c: float = 1.0,
        seed: int | None = None,
    ) -> None:
        self._baseline = baseline_c
        self._amplitude = amplitude_c
        self._period = period_s
        self._noise = noise_c
        self._rng = random.Random(seed)
        self._step = 0

    def read_temp_c(self) -> float:
        # One "step" per call; rate is set by the caller's loop, so we don't
        # need wall-clock time here. Period is expressed in samples assuming
        # ~1 Hz, which is fine for visual plausibility.
        phase = (2 * math.pi * self._step) / self._period
        value = self._baseline + self._amplitude * math.sin(phase)
        value += self._rng.gauss(0.0, self._noise)
        self._step += 1
        return value


class RealSensor:
    """MAX6675 reader over Linux ``spidev``.

    Wire protocol: one 16-bit big-endian read per sample.
    - Bits 15..3 → signed temperature in units of 0.25 °C (bit 15 is sign;
      MAX6675 only reports 0..1024 °C so it's always 0 in practice).
    - Bit 2 → open-thermocouple flag (no probe connected).
    - Bits 1..0 → device ID + tristate; ignored.

    The MAX6675 needs ~220 ms between conversions; calling at 1 Hz is
    well within margin.
    """

    _OPEN_THERMOCOUPLE_BIT = 0x4

    def __init__(self, bus: int = 0, device: int = 0, max_speed_hz: int = 1_000_000) -> None:
        import spidev  # Linux-only; import deferred so macOS/CI stay import-safe.

        self._spi = spidev.SpiDev()
        self._spi.open(bus, device)
        self._spi.max_speed_hz = max_speed_hz
        self._spi.mode = 0

    def read_temp_c(self) -> float:
        try:
            hi, lo = self._spi.xfer2([0x00, 0x00])
        except OSError as exc:
            raise SensorError(f"SPI read failed: {exc}") from exc
        word = (hi << 8) | lo
        if word & self._OPEN_THERMOCOUPLE_BIT:
            raise SensorError("open thermocouple (no probe connected)")
        return ((word >> 3) & 0x1FFF) * 0.25
