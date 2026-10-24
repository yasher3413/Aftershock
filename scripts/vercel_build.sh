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

# Pages are cached for a few minutes and still name earlier deploys' hashed
# files, which a new deploy no longer serves. Carry the last two deploys'
# own files forward: asset-list.txt is this build's files, and
# asset-list-prev.txt the deploy before it.
(cd dist/assets && ls) > dist/asset-list.txt
: > dist/asset-list-prev.txt
live="https://${VERCEL_PROJECT_PRODUCTION_URL:-aftershock-fawn.vercel.app}"
: > /tmp/carry.txt
for list in asset-list.txt asset-list-prev.txt; do
  if curl -fsS --max-time 20 "$live/$list" -o "/tmp/$list"; then
    cat "/tmp/$list" >> /tmp/carry.txt
    [ "$list" = asset-list.txt ] && cp /tmp/asset-list.txt dist/asset-list-prev.txt
  fi
done
carried=0
while read -r f; do
  [ -n "$f" ] && [ ! -e "dist/assets/$f" ] || continue
  if curl -fsS --max-time 20 "$live/assets/$f" -o "dist/assets/$f"; then
    carried=$((carried + 1))
  else
    rm -f "dist/assets/$f"
  fi
done < <(sort -u /tmp/carry.txt)
echo "Carried $carried files from the last two deploys"
