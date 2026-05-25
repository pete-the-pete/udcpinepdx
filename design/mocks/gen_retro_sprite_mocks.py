"""
Generate retro-video-game style (non-pixel-limited) chef concept boards.
Run:
  python3 design/mocks/gen_retro_sprite_mocks.py
Outputs:
  - design/mocks/chef_retro_sprite_A_arcade.svg
  - design/mocks/chef_retro_sprite_B_brawler.svg
  - design/mocks/chef_retro_sprite_C_comedy.svg
"""

from pathlib import Path

OUT = Path(__file__).parent

STATE_NAMES = ["Frozen", "Thawing", "Active", "Hot", "Very Hot"]
TEMPS = ["~200°F", "~300°F", "~400°F", "~500°F", "500°F+"]
BEHAVIORS = [
    "Encased in ice, faint breathing",
    "Melting block, blink + stiff motion",
    "Tossing pizza, confident grin",
    "Sweating + fanning, flushed face",
    "Panting, shirt off, fire edges",
]


def rect(x, y, w, h, fill, stroke="none", sw=0, r=0):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" rx="{r}" ry="{r}"/>'


def circle(cx, cy, r, fill, stroke="none", sw=0):
    return f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>'


def text(x, y, s, size=12, color="#222", weight="normal"):
    return f'<text x="{x}" y="{y}" font-family="Verdana,Arial,sans-serif" font-size="{size}" fill="{color}" font-weight="{weight}">{s}</text>'


def chef_sprite(x, y, scale, palette, state_idx):
    # Smooth HD-ish "sprite" with retro arcade proportions
    s = scale
    p = []
    # shadow
    p.append(rect(x + 22 * s, y + 142 * s, 80 * s, 14 * s, "#00000022", r=8 * s))
    # legs
    pants = palette["pants"]
    p.append(rect(x + 38 * s, y + 92 * s, 18 * s, 48 * s, pants, r=6 * s))
    p.append(rect(x + 68 * s, y + 92 * s, 18 * s, 48 * s, pants, r=6 * s))
    # shoes
    p.append(rect(x + 34 * s, y + 132 * s, 26 * s, 12 * s, palette["shoe"], r=4 * s))
    p.append(rect(x + 64 * s, y + 132 * s, 26 * s, 12 * s, palette["shoe"], r=4 * s))
    # torso
    torso_color = palette["coat"] if state_idx < 4 else palette["skin_hot"]
    p.append(
        rect(
            x + 24 * s,
            y + 44 * s,
            76 * s,
            54 * s,
            torso_color,
            stroke="#2a2a2a66",
            sw=2 * s,
            r=14 * s,
        )
    )
    # apron stripe / chest detail
    if state_idx < 4:
        p.append(rect(x + 57 * s, y + 44 * s, 10 * s, 54 * s, palette["trim"], r=4 * s))
    # arms
    arm = palette["skin"] if state_idx < 3 else palette["skin_warm"]
    if state_idx == 4:
        arm = palette["skin_hot"]
    p.append(rect(x + 10 * s, y + 52 * s, 20 * s, 16 * s, arm, r=8 * s))
    p.append(rect(x + 94 * s, y + 52 * s, 20 * s, 16 * s, arm, r=8 * s))
    # head
    head_col = palette["skin"]
    if state_idx == 0:
        head_col = palette["skin_cold"]
    elif state_idx == 3:
        head_col = palette["skin_warm"]
    elif state_idx == 4:
        head_col = palette["skin_hot"]
    p.append(
        circle(x + 62 * s, y + 30 * s, 20 * s, head_col, stroke="#2a2a2a66", sw=2 * s)
    )
    # hat
    p.append(
        rect(
            x + 38 * s,
            y + 2 * s,
            48 * s,
            22 * s,
            palette["hat"],
            stroke="#2a2a2a33",
            sw=2 * s,
            r=10 * s,
        )
    )
    p.append(
        rect(
            x + 32 * s,
            y + 18 * s,
            60 * s,
            10 * s,
            palette["hat"],
            stroke="#2a2a2a33",
            sw=2 * s,
            r=6 * s,
        )
    )
    # eyes
    p.append(circle(x + 54 * s, y + 28 * s, 3 * s, "#fff"))
    p.append(circle(x + 70 * s, y + 28 * s, 3 * s, "#fff"))
    eye_shift = 1 * s if state_idx >= 2 else 0
    p.append(circle(x + 54 * s + eye_shift, y + 28 * s, 1.4 * s, "#222"))
    p.append(circle(x + 70 * s + eye_shift, y + 28 * s, 1.4 * s, "#222"))
    # moustache + mouth
    p.append(rect(x + 48 * s, y + 34 * s, 28 * s, 6 * s, palette["hair"], r=3 * s))
    mouth = "#7a2b21" if state_idx >= 3 else "#5a2c22"
    p.append(rect(x + 54 * s, y + 41 * s, 16 * s, 3 * s, mouth, r=2 * s))
    # sweat drops
    if state_idx >= 3:
        p.append(circle(x + 84 * s, y + 30 * s, 2 * s, "#8ed6ff"))
        p.append(circle(x + 90 * s, y + 36 * s, 1.8 * s, "#8ed6ff"))
    # ice overlay
    if state_idx == 0:
        p.append(
            rect(
                x + 8 * s,
                y - 2 * s,
                108 * s,
                152 * s,
                "#a9ddff55",
                stroke="#a9ddff",
                sw=2 * s,
                r=10 * s,
            )
        )
    # thaw drips
    if state_idx == 1:
        for dx in [16, 42, 66, 92]:
            p.append(rect(x + dx * s, y + 148 * s, 4 * s, 10 * s, "#8ed6ff", r=2 * s))
    # fire edge fx
    if state_idx == 4:
        p.append(rect(x - 4 * s, y - 6 * s, 8 * s, 164 * s, "#ff4d1f"))
        p.append(rect(x + 118 * s, y - 6 * s, 8 * s, 164 * s, "#ff4d1f"))
    return "".join(p)


def make_board(filename, title, subtitle, palette):
    W, H = 1260, 780
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
    ]
    parts.append(rect(0, 0, W, H, "#f5f0e6"))
    parts.append(text(24, 38, title, 26, "#131313", "bold"))
    parts.append(text(24, 62, subtitle, 13, "#3d3d3d"))

    state_bg = ["#d5ecff", "#e6f5ff", "#f9f3cc", "#ffd9ad", "#1f1717"]
    x0, panel_w = 20, 244
    for i in range(5):
        px = x0 + i * (panel_w + 6)
        parts.append(
            rect(px, 84, panel_w, 640, "#e8dfcf", stroke="#c6b9a2", sw=1, r=10)
        )
        parts.append(text(px + 12, 110, STATE_NAMES[i], 15, "#1f1f1f", "bold"))
        parts.append(text(px + 12, 128, TEMPS[i], 12, "#555"))
        parts.append(rect(px + 10, 136, panel_w - 20, 230, state_bg[i], r=8))
        parts.append(chef_sprite(px + 52, 165, 1.15, palette, i))
        parts.append(text(px + 12, 392, BEHAVIORS[i], 11, "#2f2f2f"))
        # frame cadence hint
        frames = [3, 4, 6, 7, 9][i]
        parts.append(text(px + 12, 418, f"loop frames: {frames}", 11, "#494949"))
        fps = [5, 7, 9, 10, 12][i]
        parts.append(text(px + 12, 436, f"playback: {fps} fps", 11, "#494949"))

    parts.append(
        text(
            24,
            752,
            "Style intent: retro arcade energy + modern HD sprite finish (not strict pixel grid).",
            12,
            "#333",
            "bold",
        )
    )
    parts.append("</svg>")
    (OUT / filename).write_text("".join(parts), encoding="utf-8")
    print(f"wrote {filename}")


if __name__ == "__main__":
    pal_A = {
        "hat": "#fefefe",
        "hair": "#4a2b1f",
        "coat": "#de3a2f",
        "trim": "#f4d24b",
        "pants": "#304f8a",
        "shoe": "#272727",
        "skin": "#f4c39a",
        "skin_cold": "#d7eaf7",
        "skin_warm": "#eea682",
        "skin_hot": "#d76050",
    }
    pal_B = {
        "hat": "#fffef8",
        "hair": "#3f2a1e",
        "coat": "#f0ece0",
        "trim": "#e56f4a",
        "pants": "#1d9688",
        "shoe": "#2a2a2a",
        "skin": "#efc09a",
        "skin_cold": "#d7eaf7",
        "skin_warm": "#e9a183",
        "skin_hot": "#cb5a49",
    }
    pal_C = {
        "hat": "#fdfdfd",
        "hair": "#40291d",
        "coat": "#cfd3d9",
        "trim": "#666b73",
        "pants": "#2f3238",
        "shoe": "#1f1f1f",
        "skin": "#f0be99",
        "skin_cold": "#d6e7f3",
        "skin_warm": "#e79d7a",
        "skin_hot": "#c44f45",
    }
    make_board(
        "chef_retro_sprite_A_arcade.svg",
        "Concept A — Retro Arcade Hero (HD Sprite)",
        "BurgerTime readability + Overcooked expressiveness, tuned for larger modern sprite rendering",
        pal_A,
    )
    make_board(
        "chef_retro_sprite_B_brawler.svg",
        "Concept B — Kitchen Brawler (HD Sprite)",
        "Chunkier body language, exaggerated comedy gestures, warm/chaotic cooking tone",
        pal_B,
    )
    make_board(
        "chef_retro_sprite_C_comedy.svg",
        "Concept C — Dry-Humor Line Cook (HD Sprite)",
        "Cooler neutral palette with strong heat-state contrast and screen-edge FX escalation",
        pal_C,
    )
