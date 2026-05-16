"""Pack chef spritesheets from raw Ideogram outputs.

Pipeline per state: background-remove each raw keeper, crop to content,
scale all of a state's frames by one shared factor (no jitter), anchor
each frame feet-to-bottom and horizontally centered on a 512x512 cell,
then concatenate the cells into one horizontal-strip PNG. Finally,
rebuild chef.manifest.json from whatever sheets exist on disk.

Run from anywhere:  cd design && uv run python chef/scripts/pack.py
Optionally limit to specific states:  ... pack.py frozen hot

See plans/web/2026-04-28-pizza-chef-spritesheets.md for the contract.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from PIL import Image
from rembg import remove

FRAME = 512

# Fixed contract metadata per state. `frames` is computed from the raw
# inputs that actually exist — see the v1 escape hatch in the plan.
STATES: dict[str, dict] = {
    "frozen": {"fps": None, "css_animation": "shiver", "temp_f": [None, 250]},
    "thawing": {"fps": 6, "temp_f": [250, 350]},
    "active": {"fps": 8, "temp_f": [350, 450]},
    "hot": {"fps": 10, "temp_f": [450, 550]},
    "very_hot": {"fps": 12, "temp_f": [550, None]},
}

REPO_ROOT = Path(__file__).resolve().parents[3]
RAW_DIR = Path(__file__).resolve().parents[1] / "raw"
OUT_DIR = REPO_ROOT / "web" / "frontend" / "src" / "assets" / "chef"


def raw_frames(state: str) -> list[Path]:
    """All keeper PNGs for a state across every session folder, in nn order."""
    pat = re.compile(rf"^{re.escape(state)}_(\d+)\.png$")
    found: list[tuple[int, Path]] = []
    for png in RAW_DIR.glob(f"*/{state}_*.png"):
        m = pat.match(png.name)
        if m:
            found.append((int(m.group(1)), png))
    return [p for _, p in sorted(found)]


def cut_out(path: Path) -> Image.Image:
    """Background-remove and crop to the content bounding box."""
    cut = remove(Image.open(path).convert("RGBA"))
    bbox = cut.getbbox()
    if bbox is None:
        raise ValueError(f"{path} is empty after background removal")
    return cut.crop(bbox)


def pack_state(state: str) -> int:
    """Build chef_<state>.png. Returns the frame count packed."""
    frames = [cut_out(p) for p in raw_frames(state)]
    if not frames:
        return 0

    # One shared scale for the whole state so the character does not
    # jump in size between frames.
    max_w = max(f.width for f in frames)
    max_h = max(f.height for f in frames)
    scale = min(FRAME / max_w, FRAME / max_h)

    sheet = Image.new("RGBA", (FRAME * len(frames), FRAME), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        w, h = round(f.width * scale), round(f.height * scale)
        resized = f.resize((w, h), Image.LANCZOS)
        x = i * FRAME + (FRAME - w) // 2  # horizontally centered
        y = FRAME - h  # feet on the bottom edge
        sheet.paste(resized, (x, y), resized)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT_DIR / f"chef_{state}.png")
    return len(frames)


def rebuild_manifest() -> None:
    """Rewrite chef.manifest.json to match the sheets present on disk."""
    states: dict[str, dict] = {}
    for state, meta in STATES.items():
        sheet = OUT_DIR / f"chef_{state}.png"
        if not sheet.exists():
            continue
        count = Image.open(sheet).width // FRAME
        entry = {"frames": count, "fps": meta["fps"]}
        if "css_animation" in meta:
            entry["css_animation"] = meta["css_animation"]
        entry["temp_f"] = meta["temp_f"]
        states[state] = entry

    manifest = {"frame_size": [FRAME, FRAME], "states": states}
    (OUT_DIR / "chef.manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


def main() -> None:
    requested = sys.argv[1:] or list(STATES)
    unknown = [s for s in requested if s not in STATES]
    if unknown:
        sys.exit(f"Unknown state(s): {', '.join(unknown)}")

    for state in requested:
        count = pack_state(state)
        if count:
            print(f"chef_{state}.png — {count} frame(s)")
        else:
            print(f"{state}: no raw frames found, skipped")

    rebuild_manifest()
    print(f"manifest rewritten — {OUT_DIR / 'chef.manifest.json'}")


if __name__ == "__main__":
    main()
