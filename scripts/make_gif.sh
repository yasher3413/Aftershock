#!/usr/bin/env bash
# Turn the newest Playwright hero recording into docs/media/hero.gif (under 8 MB).
set -euo pipefail
cd "$(dirname "$0")/.."
RAW=$(ls -t docs/media/raw/*.webm | head -1)
PALETTE=$(mktemp -t palette).png
FILTERS="fps=15,scale=960:-1:flags=lanczos"
ffmpeg -y -loglevel error -ss 2 -i "$RAW" -vf "$FILTERS,palettegen=stats_mode=diff" "$PALETTE"
ffmpeg -y -loglevel error -ss 2 -i "$RAW" -i "$PALETTE" \
  -lavfi "$FILTERS [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
  docs/media/hero.gif
rm -rf docs/media/raw "$PALETTE"
ls -lh docs/media/hero.gif
