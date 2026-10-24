#!/usr/bin/env bash
# Vercel build step (vercel.json): the What-If simulator as WebAssembly, then
# the web app. The page shell is renamed to app.html so that page requests go
# through the api, which adds each page's share preview (api/pages.py).
set -euo pipefail
. "${CARGO_HOME:-$HOME/.cargo}/env"
wasm-pack build crates/aftershock-wasm --release --target web --out-dir ../../web/src/wasm/pkg
cd web
npx -y "$(node -p 'require("./package.json").packageManager')" build
mv dist/index.html dist/app.html

# Pages are cached for a few minutes and still name the previous deploy's
# hashed files, which a new deploy no longer serves. Carry the live deploy's
# own files forward (one generation: only this build's files are listed).
(cd dist/assets && ls) > dist/asset-list.txt
live="https://${VERCEL_PROJECT_PRODUCTION_URL:-aftershock-fawn.vercel.app}"
if curl -fsS --max-time 20 "$live/asset-list.txt" -o /tmp/prev-assets.txt; then
  carried=0
  while read -r f; do
    [ -n "$f" ] && [ ! -e "dist/assets/$f" ] || continue
    if curl -fsS --max-time 20 "$live/assets/$f" -o "dist/assets/$f"; then
      carried=$((carried + 1))
    else
      rm -f "dist/assets/$f"
    fi
  done < /tmp/prev-assets.txt
  echo "Carried $carried files from the live deploy"
else
  echo "No asset list on the live deploy; nothing carried"
fi
