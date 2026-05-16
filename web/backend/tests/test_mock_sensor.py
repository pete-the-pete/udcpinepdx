"""MockSensorThread: deterministic temperature curve for demos."""

from __future__ import annotations

import pytest

from udcpine_backend.mock_sensor import ramp_temp_f


def test_ramp_at_t0_is_starting_temp() -> None:
    assert ramp_temp_f(elapsed_s=0) == pytest.approx(70.0, abs=0.01)


def test_ramp_reaches_target_at_plateau_time() -> None:
    # 850°F by +600s (10 minutes)
    assert ramp_temp_f(elapsed_s=600) == pytest.approx(850.0, abs=1.0)


def test_ramp_holds_target_after_plateau() -> None:
    # Sustained heat: noise band ±5°F around 850°F
    for t in (601, 700, 1200, 3600):
        v = ramp_temp_f(elapsed_s=t)
        assert 845.0 <= v <= 855.0, f"out-of-band at t={t}: {v}"


def test_ramp_is_monotonic_in_ramp_phase() -> None:
    samples = [ramp_temp_f(elapsed_s=t) for t in range(0, 600, 10)]
    for a, b in zip(samples, samples[1:]):
        assert b >= a, f"non-monotonic: {a} -> {b}"


def test_ramp_is_deterministic() -> None:
    # Same input -> same output, every call. Noise is keyed off elapsed_s.
    assert ramp_temp_f(elapsed_s=750) == ramp_temp_f(elapsed_s=750)
