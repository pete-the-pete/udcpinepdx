"""Export one firing from the backend SQLite into the static blog's data dir.

The blog is a static GitHub Pages site with no backend, so each firing is
baked to a committed JSON file the blog imports at build time. This script is
the repeatable pipeline: run it once per firing.

It reuses the backend ``Store`` (the same Pydantic ``Sample``/``Pizza`` models
the live API speaks) rather than hand-rolling SQL, so the export can never
drift from the wire contract.

Run from the repo root:

    cd web/backend && uv run python scripts/export_firing.py --firing 1

Outputs ``web/blog/data/firing-<id>.json``. The editorial layer
(``firing-<id>.curation.json``) is hand-authored and lives beside it; this
script never overwrites curation.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "src"))

from udcpine_backend.db import connect  # noqa: E402
from udcpine_backend.store import Store  # noqa: E402

# A K-type thermocouple on a MAX6675 pins at the top of its range on an open
# circuit. Any reading at/above this is a fault, not a real hearth temperature;
# it is kept in the series (flagged) so the blog can show the honest "raw"
# trace, and excluded from the headline "clean" peak.
FAULT_THRESHOLD_C = 600.0

# Target point count for the downsampled curve. LTTB preserves visual peaks,
# so ~600 points keeps the three-hour shape (and real spikes) while staying a
# small static asset.
TARGET_POINTS = 600


def lttb(points: list[tuple[float, float]], threshold: int) -> list[tuple[float, float]]:
    """Largest-Triangle-Three-Buckets downsample. Keeps the points that carry
    the most visual information (peaks, knees), so the curve shape survives."""
    n = len(points)
    if threshold >= n or threshold < 3:
        return points
    sampled = [points[0]]
    every = (n - 2) / (threshold - 2)
    a = 0
    for i in range(threshold - 2):
        lo = int((i + 1) * every) + 1
        hi = min(int((i + 2) * every) + 1, n)
        avg_x = sum(p[0] for p in points[lo:hi]) / max(1, hi - lo)
        avg_y = sum(p[1] for p in points[lo:hi]) / max(1, hi - lo)
        range_lo = int(i * every) + 1
        range_hi = int((i + 1) * every) + 1
        ax, ay = points[a]
        best_area = -1.0
        best_idx = range_lo
        for j in range(range_lo, range_hi):
            px, py = points[j]
            area = abs((ax - avg_x) * (py - ay) - (ax - px) * (avg_y - ay))
            if area > best_area:
                best_area = area
                best_idx = j
        sampled.append(points[best_idx])
        a = best_idx
    sampled.append(points[-1])
    return sampled


def classify(name: str, seq: int, notes: set[int]) -> str:
    """A logged slot is a pizza unless its name is the 'Null' placeholder (a
    gap between pies) or it is flagged as a session note (oven tending)."""
    if name.strip().lower() == "null":
        return "gap"
    if seq in notes:
        return "note"
    return "pizza"


def main() -> int:
    parser = argparse.ArgumentParser(description="Export a firing to the blog data dir.")
    parser.add_argument("--firing", type=int, default=1, help="firing id to export")
    parser.add_argument(
        "--db",
        default=os.path.join(HERE, "..", "udcpine.db"),
        help="path to the backend SQLite database",
    )
    parser.add_argument(
        "--out-dir",
        default=os.path.join(HERE, "..", "..", "blog", "data"),
        help="directory to write firing-<id>.json into",
    )
    args = parser.parse_args()

    # Notes (oven tending, not pizzas) are read from the curation file if it
    # exists, so the editorial classification lives in one hand-authored place.
    out_dir = os.path.abspath(args.out_dir)
    curation_path = os.path.join(out_dir, f"firing-{args.firing}.curation.json")
    note_seqs: set[int] = set()
    if os.path.exists(curation_path):
        with open(curation_path) as f:
            curation = json.load(f)
        note_seqs = {int(s) for s in curation.get("note_seqs", [])}

    store = Store(os.path.abspath(args.db))

    frow = (
        connect(os.path.abspath(args.db))
        .execute(
            "SELECT id, started_at, ended_at, status FROM firing WHERE id=?",
            (args.firing,),
        )
        .fetchone()
    )
    if frow is None:
        print(f"firing {args.firing} not found in {args.db}", file=sys.stderr)
        return 1

    t0 = datetime.fromisoformat(frow["started_at"])
    samples = store.samples(args.firing)
    if not samples:
        print(f"firing {args.firing} has no samples", file=sys.stderr)
        return 1

    raw = [((s.t - t0).total_seconds(), s.temp_c) for s in samples]

    # Downsample on the clean points so the curve shape is real, then re-inject
    # the single fault spike so the "raw" view can show it honestly.
    clean = [p for p in raw if p[1] < FAULT_THRESHOLD_C]
    series_pts = lttb(clean, TARGET_POINTS)
    fault_pts = [p for p in raw if p[1] >= FAULT_THRESHOLD_C]
    series_pts = sorted(series_pts + fault_pts, key=lambda p: p[0])
    series = [
        {"x": round(x, 1), "c": round(c, 2), "fault": c >= FAULT_THRESHOLD_C} for x, c in series_pts
    ]

    pizzas = []
    for p in store.pizzas(args.firing):
        start = (p.started_at - t0).total_seconds()
        end = (p.ended_at - t0).total_seconds() if p.ended_at else None
        pizzas.append(
            {
                "seq": p.seq,
                "name": p.name.strip(),
                "start": round(start, 1),
                "end": round(end, 1) if end is not None else None,
                "cook_min": round((end - start) / 60, 1) if end is not None else None,
                "kind": classify(p.name, p.seq, note_seqs),
            }
        )

    ended = datetime.fromisoformat(frow["ended_at"]) if frow["ended_at"] else None
    duration_s = (ended - t0).total_seconds() if ended else raw[-1][0]
    clean_max = max(c for _, c in clean)
    out = {
        "id": args.firing,
        "started_at": frow["started_at"],
        "ended_at": frow["ended_at"],
        "duration_s": round(duration_s, 1),
        "sample_count": len(samples),
        "raw_max_c": round(max(c for _, c in raw), 2),
        "clean_max_c": round(clean_max, 1),
        "avg_c": round(sum(c for _, c in raw) / len(raw), 1),
        "fault_threshold_c": FAULT_THRESHOLD_C,
        "series": series,
        "pizzas": pizzas,
    }

    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"firing-{args.firing}.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2)
        f.write("\n")

    pies = sum(1 for p in pizzas if p["kind"] == "pizza")
    print(
        f"wrote {out_path}: {len(series)} pts, {len(pizzas)} slots ({pies} pizzas), "
        f"clean peak {clean_max}°C, raw peak {out['raw_max_c']}°C"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
