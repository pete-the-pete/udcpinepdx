"""Tests for FakeSensor (the only sensor implementation we can exercise
without a real Pi). RealSensor is hardware-only and intentionally not
covered here."""

from __future__ import annotations

import pytest

from udcpine_firmware.sensor import FakeSensor


def test_fake_sensor_returns_floats_near_baseline() -> None:
    sensor = FakeSensor(baseline_c=250.0, amplitude_c=25.0, noise_c=1.0, seed=1)
    samples = [sensor.read_temp_c() for _ in range(60)]

    assert all(isinstance(s, float) for s in samples)
    # All samples should sit within baseline ± (amplitude + a few sigma of noise).
    for s in samples:
        assert 200.0 <= s <= 300.0


def test_fake_sensor_is_deterministic_with_seed() -> None:
    a = FakeSensor(seed=42)
    b = FakeSensor(seed=42)
    for _ in range(20):
        assert a.read_temp_c() == pytest.approx(b.read_temp_c())


def test_fake_sensor_advances_phase() -> None:
    """Two consecutive reads should not be identical (phase advances + noise)."""
    sensor = FakeSensor(seed=7)
    first = sensor.read_temp_c()
    second = sensor.read_temp_c()
    assert first != second
