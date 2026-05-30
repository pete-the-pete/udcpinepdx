"""Thermocouple sensor abstractions.

The real sensor pulls in `adafruit_circuitpython_max6675`, which itself
requires `board` and `busio` and only works on real Pi hardware. We gate
that import behind ``RealSensor`` so tests, `--simulate` runs, and any
import on macOS keep working.
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
    """MAX6675 reader backed by ``adafruit_circuitpython_max6675``.

    The hardware-only imports happen inside ``__init__`` so importing this
    module on a laptop (no ``board``, no SPI bus) does not blow up.
    """

    def __init__(self) -> None:
        # Imports deferred so this module is import-safe on macOS / in CI.
        import adafruit_max6675  # type: ignore[import-not-found]
        import board  # type: ignore[import-not-found]
        import busio  # type: ignore[import-not-found]
        import digitalio  # type: ignore[import-not-found]

        spi = busio.SPI(clock=board.SCK, MISO=board.MISO)
        cs = digitalio.DigitalInOut(board.D8)
        self._device = adafruit_max6675.MAX6675(spi, cs)

    def read_temp_c(self) -> float:
        try:
            return float(self._device.temperature)
        except Exception as exc:  # noqa: BLE001 — library raises bare Exception variants
            raise SensorError(str(exc)) from exc
