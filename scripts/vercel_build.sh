#!/usr/bin/env bash
# Vercel build step (vercel.json): the What-If simulator as WebAssembly, then
# the web app. The page shell is renamed to app.html so that page requests go
# through the api, which adds each page's share preview (api/pages.py).
set -euo pipefail
. "${CARGO_HOME:-$HOME/.cargo}/env"
wasm-pack build crates/aftershock-wasm --release --target web --out-dir ../../web/src/wasm/pkg
cd web && pnpm build && mv dist/index.html dist/app.html
