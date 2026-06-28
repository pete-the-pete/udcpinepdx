#!/usr/bin/env bash
# Convert the raw per-entry photo dumps in web/blog/assets/<entry>/ into
# web-ready, optimized JPEGs under web/blog/src/galleries/<entry>/NN.jpg.
#
# Raw originals (incl. HEIC, which browsers can't render) are gitignored; only
# the optimized copies are committed and bundled by Vite. Re-run after dropping
# new photos into an assets/<entry>/ folder:  make web-blog-galleries
#
# Uses macOS `sips` (built in). Max long edge 1400px, quality 72.
set -euo pipefail

cd "$(dirname "$0")/.."
SRC="assets"
OUT="src/galleries"
MAXDIM=1400
QUALITY=72

if ! command -v sips >/dev/null 2>&1; then
  echo "error: sips not found (macOS only). Convert HEIC→JPG another way." >&2
  exit 1
fi

rm -rf "$OUT"
# Draw-from pools: raw photo libraries to pull individual shots from, not
# published entries. Skipped here so they don't generate committed galleries.
POOLS=" pizzas "

for dir in "$SRC"/*/; do
  entry="$(basename "$dir")"
  if [[ "$POOLS" == *" $entry "* ]]; then
    echo "$entry: skipped (draw-from pool)"
    continue
  fi
  out="$OUT/$entry"
  mkdir -p "$out"
  i=0
  while IFS= read -r f; do
    i=$((i + 1))
    n=$(printf "%02d" "$i")
    sips -s format jpeg -Z "$MAXDIM" -s formatOptions "$QUALITY" \
      "$dir$f" --out "$out/$n.jpg" >/dev/null 2>&1
  done < <(ls "$dir" | grep -iE '\.(jpg|jpeg|heic|png)$' | sort)
  echo "$entry: $i images"
done
