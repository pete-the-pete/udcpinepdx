"""CLI argument parsing for udcpine-firmware."""

from __future__ import annotations

import argparse
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    server: str
    hz: float
    simulate: bool


def parse_args(argv: list[str] | None = None) -> Config:
    parser = argparse.ArgumentParser(
        prog="udcpine-firmware",
        description=(
            "Read a MAX6675 K-type thermocouple at a fixed rate and POST samples "
            "to the udcpinepdx backend over the LAN."
        ),
    )
    parser.add_argument(
        "--server",
        required=True,
        help="Backend base URL, e.g. http://laptop.local:5001",
    )
    parser.add_argument(
        "--hz",
        type=float,
        default=1.0,
        help=(
            "Sample rate in Hz (default 1.0). MAX6675 requires ~220 ms between "
            "reads, so 1.0 Hz is the practical ceiling for real hardware."
        ),
    )
    parser.add_argument(
        "--simulate",
        action="store_true",
        help="Synthesize samples instead of reading the SPI bus (laptop dev mode).",
    )
    ns = parser.parse_args(argv)
    if ns.hz <= 0:
        parser.error("--hz must be positive")
    return Config(server=ns.server.rstrip("/"), hz=float(ns.hz), simulate=bool(ns.simulate))
