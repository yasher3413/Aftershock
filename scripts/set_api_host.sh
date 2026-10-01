#!/usr/bin/env bash
# Write vercel.json for an api host, for example:
#   scripts/set_api_host.sh 129.146.10.20.sslip.io
# Vercel rewrites cannot read environment variables, so the host is filled in.
set -euo pipefail
cd "$(dirname "$0")/.."
host="${1:?usage: scripts/set_api_host.sh API_HOST}"
sed "s/__API_HOST__/${host}/g" vercel.template.json > vercel.json
echo "wrote vercel.json for ${host}"
echo "In Vercel, set VITE_WS_URL=wss://${host}/ws/live for the build."
