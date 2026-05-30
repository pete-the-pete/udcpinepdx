"""Entry point: sample loop + uploader wiring."""

from __future__ import annotations

import logging
import signal
import sys
import threading
import time
from typing import Callable

from .config import Config, parse_args
from .sensor import FakeSensor, Sensor, SensorError
from .uploader import Uploader

log = logging.getLogger("udcpine_firmware")


def _build_sensor(cfg: Config) -> Sensor:
    if cfg.simulate:
        log.info("Simulate mode — using FakeSensor; SPI bus untouched.")
        return FakeSensor()
    # Defer the import so the module stays import-safe on laptops.
    from .sensor import RealSensor

    log.info("Real mode — initializing MAX6675 over SPI.")
    return RealSensor()


def run(
    cfg: Config,
    *,
    sensor_factory: Callable[[Config], Sensor] = _build_sensor,
    uploader_factory: Callable[[str], Uploader] = lambda url: Uploader(url),
    stop_event: threading.Event | None = None,
    max_samples: int | None = None,
) -> None:
    """Run the sample loop until ``stop_event`` is set or ``max_samples`` reached.

    ``max_samples`` is for tests; production runs are unbounded.
    """
    sensor = sensor_factory(cfg)
    uploader = uploader_factory(cfg.server)
    uploader.start()

    stop = stop_event or threading.Event()
    period = 1.0 / cfg.hz
    count = 0

    log.info("Sampling at %.2f Hz; POST → %s/api/ingest/sample", cfg.hz, cfg.server)

    try:
        next_deadline = time.monotonic()
        while not stop.is_set():
            try:
                temp_c = sensor.read_temp_c()
            except SensorError as exc:
                log.warning("Sensor read failed; skipping sample: %s", exc)
            except Exception as exc:  # noqa: BLE001 — never crash the loop
                log.warning("Unexpected sensor error; skipping sample: %s", exc)
            else:
                uploader.submit(temp_c)
                count += 1
                if max_samples is not None and count >= max_samples:
                    break

            next_deadline += period
            sleep_for = next_deadline - time.monotonic()
            if sleep_for > 0:
                # Use the event so SIGTERM/SIGINT wakes us promptly.
                if stop.wait(timeout=sleep_for):
                    break
            else:
                # We're behind schedule; reset cadence to "now" so we don't
                # spin trying to catch up after a long pause (e.g. laptop sleep).
                next_deadline = time.monotonic()
    finally:
        uploader.stop()


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    cfg = parse_args(argv if argv is not None else sys.argv[1:])

    stop_event = threading.Event()

    def _handle_signal(signum: int, _frame: object) -> None:
        log.info("Received signal %d; shutting down.", signum)
        stop_event.set()

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    run(cfg, stop_event=stop_event)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
