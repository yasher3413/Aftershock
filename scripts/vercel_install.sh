#!/usr/bin/env bash
# Vercel install step (vercel.json): Rust with the wasm target and wasm-pack
# for the What-If simulator, then the web app's packages. Kept in a script
# because Vercel limits the install command to 256 characters.
set -euo pipefail
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --target wasm32-unknown-unknown
. "$HOME/.cargo/env"
curl -sSf https://rustwasm.github.io/wasm-pack/installer/init.sh | sh
cd web && pnpm install --frozen-lockfile
