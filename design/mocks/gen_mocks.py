"""
gen_mocks.py  — generates three SVG concept boards for the pizza-chef temperature animation.
Run with:  python3 design/mocks/gen_mocks.py
Output:    design/mocks/chef_mock_A_retro_hero.svg
           design/mocks/chef_mock_B_chunky_cozy.svg
           design/mocks/chef_mock_C_cool_linecook.svg
"""

from pathlib import Path

OUT = Path(__file__).parent
CELL = 5  # pixel size of each "pixel" in the mock-up


def rect(x, y, w, h, color):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{color}"/>'


def txt(x, y, s, size=12, color="#222", weight="normal"):
    return (
        f'<text x="{x}" y="{y}" font-family="monospace" '
        f'font-size="{size}" fill="{color}" font-weight="{weight}">{s}</text>'
    )


def draw_sprite(px, py, pattern, palette):
    out = []
    for r, row in enumerate(pattern):
        for c, ch in enumerate(row):
            if ch != ".":
                out.append(rect(px + c * CELL, py + r * CELL, CELL, CELL, palette[ch]))
    return "".join(out)


# ── Shared sprite patterns (32-wide rows) ─────────────────────────────────────
# w=white hat m=dark hair/moustache f=skin a=coat b/c/d=pants
# e=eye white p=pupil t=trim s=shadow

base_A = [
    "..............ww................",
    "............wwwwww..............",
    "...........wwwwwwww.............",
    "..........wwwwwwwwww............",
    "..........wwwwwwwwww............",
    "...........wwwwwwww.............",
    ".............mmmm...............",
    "............mffffm..............",
    "...........mffeeffm.............",
    "..........mffpeepffm............",
    "..........mffffffffm............",
    "..........mffffffffm............",
    "...........mffffffm.............",
    "...........mmmmmmmm.............",
    "..........aaaatttaaa............",
    ".........aaaaatttaaaa...........",
    ".........aaaasaaasaaa...........",
    ".........aaabbbbbbaaa...........",
    ".........aaabbbbbbaaa...........",
    "..........aabbbbbbaa............",
    "...........bbbbbbbb.............",
    "...........bbbbbbbb.............",
    "............bb..bb..............",
    "...........bb....bb.............",
    "..........bb......bb............",
    "..........bb......bb............",
    "...........bb....bb.............",
    "............b....b..............",
]

base_B = [
    "..............ww................",
    "............wwwwww..............",
    "...........wwwwwwww.............",
    "..........wwwwwwwwww............",
    "..........wwwwwwwwww............",
    "...........wwwwwwww.............",
    ".............mmmm...............",
    "............mffffm..............",
    "...........mffeeffm.............",
    "..........mffpeepffm............",
    "..........mffffffffm............",
    ".........mffffffffffm...........",
    ".........mffffffffffm...........",
    "..........mmmmmmmmmm............",
    ".........aaaattttaaaa...........",
    ".........aaaacccccaaa...........",
    "........aaaacccccccaaa..........",
    "........aaaacssssccaaa..........",
    ".........aaacccccccaaa..........",
    "..........aacccccccaa...........",
    "...........cccccccc.............",
    "...........cccccccc.............",
    "..........ccc....ccc............",
    "..........cc......cc............",
    "..........cc......cc............",
    "..........cc......cc............",
    "...........cc....cc.............",
    "............c....c..............",
]

base_C = [
    "..............ww................",
    "............wwwwww..............",
    "...........wwwwwwww.............",
    "..........wwwwwwwwww............",
    "..........wwwwwwwwww............",
    "...........wwwwwwww.............",
    ".............mmmm...............",
    "............mffffm..............",
    "...........mffeeffm.............",
    "..........mffpeepffm............",
    "..........mffffffffm............",
    "..........mffffffffm............",
    "...........mffffffm.............",
    "..........mmmmmmmmmm............",
    ".........aaaattttaaaa...........",
    ".........aaaddddddaaa...........",
    "........aaaddssdddaaa...........",
    "........aaaddddddddaaa..........",
    ".........aaddddddddaa...........",
    "..........addddddddaa...........",
    "...........dddddddd.............",
    "...........dddddddd.............",
    "............dd..dd..............",
    "...........dd....dd.............",
    "..........dd......dd............",
    "..........dd......dd............",
    "...........dd....dd.............",
    "............d....d..............",
]


def make_board(title, subtitle, sprite, palette, acc, outfile):
    W, H = 1200, 780
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
        f'viewBox="0 0 {W} {H}">'
    ]
    parts.append(rect(0, 0, W, H, "#f4f1e8"))
    parts.append(txt(24, 38, title, 22, "#111", "bold"))
    parts.append(txt(24, 60, subtitle, 13, "#444"))

    state_names = ["Frozen", "Thawing", "Active", "Hot", "Very Hot"]
    temps = ["~200°F", "~300°F", "~400°F", "~500°F", "500°F+"]
    notes = [
        "static / tiny breath\nice block overlay",
        "drips + blink start\nstiff movements",
        "pizza toss loop\nhappy bounce",
        "sweat drops + fan self\nred cheeks",
        "panting + shirt off\nfire edges",
    ]
    beat_counts = [2, 3, 5, 6, 8]
    bg_colors = [acc["ice"], acc["melt"], acc["active"], acc["hot"], acc["very_hot"]]
    skin_seq = ["cold_skin", "neutral_skin", "neutral_skin", "warm_skin", "red_skin"]

    panel_w = 222
    x0 = 24
    for i, sn in enumerate(state_names):
        px = x0 + i * (panel_w + 5)

        parts.append(rect(px, 80, panel_w, 650, "#e7e1d2"))
        parts.append(txt(px + 10, 104, sn, 14, "#222", "bold"))
        parts.append(txt(px + 10, 120, temps[i], 12, "#555"))

        # state background swatch
        parts.append(rect(px + 10, 132, panel_w - 20, 175, bg_colors[i]))

        # fire edge on very hot
        if i == 4:
            parts.append(rect(px + 10, 132, 14, 175, acc["fire"]))
            parts.append(rect(px + panel_w - 24, 132, 14, 175, acc["fire"]))

        sp_pal = palette.copy()
        sp_pal["f"] = acc[skin_seq[i]]
        parts.append(draw_sprite(px + 16, 138, sprite, sp_pal))

        # annotation text
        for li, line in enumerate(notes[i].split("\n")):
            parts.append(txt(px + 10, 332 + li * 16, line, 11, "#333"))

        # beat dots
        for b in range(beat_counts[i]):
            parts.append(rect(px + 10 + b * 12, 372, 9, 9, "#666"))

    # palette legend
    parts.append(txt(24, 748, "Palette DNA:", 13, "#222", "bold"))
    sx = 160
    for label, key in [
        ("hat", "w"),
        ("hair/moustache", "m"),
        ("skin", "neutral_skin"),
        ("coat", "a"),
        ("pants", "b"),
        ("fire fx", "fire"),
    ]:
        col = acc.get(key) or palette.get(key, "#ccc")
        parts.append(rect(sx, 734, 18, 18, col))
        parts.append(txt(sx + 22, 747, label, 11, "#333"))
        sx += 125

    parts.append("</svg>")
    outfile.write_text("".join(parts), encoding="utf-8")
    print(f"  wrote {outfile.name}")


# ── Palettes ──────────────────────────────────────────────────────────────────
pal_A = {
    "w": "#fefefe",
    "m": "#4b2e1f",
    "f": "#f5c49e",
    "a": "#e43d30",
    "b": "#2e4a7d",
    "e": "#fff9ea",
    "p": "#1d1714",
    "t": "#f0d250",
    "s": "#9e2a24",
}
acc_A = {
    "ice": "#bfe7ff",
    "melt": "#d8f0ff",
    "active": "#f7e8bf",
    "hot": "#ffd7a8",
    "very_hot": "#231b1b",
    "fire": "#ff5a1f",
    "cold_skin": "#d9edf9",
    "neutral_skin": "#f5c49e",
    "warm_skin": "#f0ab86",
    "red_skin": "#da5d4f",
    "w": "#fefefe",
    "b": "#2e4a7d",
}
# Concept B  – warm-white coat + teal pants  (chunkier read)
pal_B = {
    "w": "#fefefe",
    "m": "#3b2a20",
    "f": "#efbf98",
    "a": "#ebe5d5",
    "c": "#1f9a8a",
    "b": "#1f9a8a",
    "e": "#fff9ea",
    "p": "#1f1a18",
    "t": "#d85e42",
    "s": "#177468",
}
acc_B = {
    "ice": "#c7f0ff",
    "melt": "#dff6ff",
    "active": "#e7f8d8",
    "hot": "#ffe0a8",
    "very_hot": "#231816",
    "fire": "#ff6a21",
    "cold_skin": "#d7e7f1",
    "neutral_skin": "#efbf98",
    "warm_skin": "#e79e7d",
    "red_skin": "#cc5648",
    "w": "#fefefe",
    "b": "#1f9a8a",
}
# Concept C  – grey coat + dark charcoal pants  (cool/deadpan)
pal_C = {
    "w": "#fefefe",
    "m": "#40291d",
    "f": "#f1c09a",
    "a": "#d0d0d0",
    "d": "#2f2f35",
    "b": "#2f2f35",
    "e": "#fbf7eb",
    "p": "#17171b",
    "t": "#4f4f57",
    "s": "#222227",
}
acc_C = {
    "ice": "#c4defd",
    "melt": "#dce9ff",
    "active": "#eadfcb",
    "hot": "#ffc58f",
    "very_hot": "#1a1212",
    "fire": "#ff4b1c",
    "cold_skin": "#d7e2ee",
    "neutral_skin": "#f1c09a",
    "warm_skin": "#e79c78",
    "red_skin": "#c94d45",
    "w": "#fefefe",
    "b": "#2f2f35",
}

if __name__ == "__main__":
    print("Generating mock boards ...")
    make_board(
        "Concept A — Retro Hero Chef",
        "BurgerTime DNA: bold red coat + navy pants, high-contrast, 5-6 colours per state",
        base_A,
        pal_A,
        acc_A,
        OUT / "chef_mock_A_retro_hero_hd.svg",
    )
    make_board(
        "Concept B — Chunky Cozy Chef",
        "Overcooked warmth: soft cream coat + teal pants, wider silhouette, rounder forms",
        base_B,
        pal_B,
        acc_B,
        OUT / "chef_mock_B_chunky_cozy_hd.svg",
    )
    make_board(
        "Concept C — Cool Line-Cook",
        "Deadpan funny: grey coat + charcoal pants, older/cooler vibe, snappier heat breakdown",
        base_C,
        pal_C,
        acc_C,
        OUT / "chef_mock_C_cool_linecook_hd.svg",
    )
    print("Done.")
