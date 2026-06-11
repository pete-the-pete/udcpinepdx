"""MockSensorThread: deterministic temperature curve for demos."""

from __future__ import annotations

import pytest

from udcpine_backend.mock_sensor import ramp_temp_c


def test_ramp_at_t0_is_starting_temp() -> None:
    assert ramp_temp_c(elapsed_s=0) == pytest.approx(21.0, abs=0.01)


def test_ramp_reaches_target_at_plateau_time() -> None:
    # 454°C (~850°F) by +600s (10 minutes)
    assert ramp_temp_c(elapsed_s=600) == pytest.approx(454.0, abs=1.0)


def test_ramp_holds_target_after_plateau() -> None:
    # Sustained heat: noise band ±3°C around 454°C
    for t in (601, 700, 1200, 3600):
        v = ramp_temp_c(elapsed_s=t)
        assert 451.0 <= v <= 457.0, f"out-of-band at t={t}: {v}"


def test_ramp_is_monotonic_in_ramp_phase() -> None:
    samples = [ramp_temp_c(elapsed_s=t) for t in range(0, 600, 10)]
    for a, b in zip(samples, samples[1:]):
        assert b >= a, f"non-monotonic: {a} -> {b}"


def test_ramp_is_deterministic() -> None:
    # Same input -> same output, every call. Noise is keyed off elapsed_s.
    assert ramp_temp_c(elapsed_s=750) == ramp_temp_c(elapsed_s=750)


def test_ambient_is_within_band() -> None:
    from udcpine_backend.mock_sensor import ambient_temp_c

    for tick in range(0, 100):
        v = ambient_temp_c(tick=tick)
        assert 20.0 <= v <= 25.0, f"out-of-band at tick={tick}: {v}"


def test_ambient_is_deterministic() -> None:
    from udcpine_backend.mock_sensor import ambient_temp_c

    assert ambient_temp_c(tick=7) == ambient_temp_c(tick=7)


def test_thread_publishes_ambient_while_idle(tmp_path) -> None:
    """The mock thread, with no active firing, publishes ambient readings so
    the idle screen shows a number in dev/demo. Condition-based wait — poll
    for the reading rather than sleeping a fixed interval."""
    import time

    from udcpine_backend.mock_sensor import MockSensorThread
    from udcpine_backend.store import Store

    store = Store(str(tmp_path / "mock.db"))
    thread = MockSensorThread(store, interval_s=0.01)
    thread.start()
    try:
        deadline = time.monotonic() + 2.0
        while store.latest_sample() is None and time.monotonic() < deadline:
            time.sleep(0.01)
    finally:
        thread.stop()
        thread.join(timeout=1.0)
    assert store.latest_sample() is not None
    assert 20.0 <= store.latest_sample().temp_c <= 25.0
