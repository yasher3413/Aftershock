#!/usr/bin/env bash
# Copy the local database and replay bundles to the Oracle VM. Run from the
# repo on your laptop:  scripts/deploy/push_data.sh ubuntu@VM_IP
# Uses the local Postgres on port 55432 (see docs/PROGRESS.md).
set -euo pipefail
vm="${1:?usage: push_data.sh ubuntu@VM_IP}"
cd "$(dirname "$0")/../.."
dump="$(mktemp -t aftershock).dump"

echo "== Dumping the local database (a few minutes)"
pg_dump -h localhost -p 55432 -U aftershock -d aftershock -Fc -Z 6 -f "$dump"
ls -lh "$dump"

echo "== Copying the dump and replay bundles to $vm"
scp "$dump" "$vm:~/aftershock.dump"
rsync -az --info=progress2 data/replays/ "$vm:~/Aftershock/data/replays/"

echo "== Restoring on the VM (the worker pauses meanwhile)"
ssh "$vm" 'set -e
  cd ~/Aftershock
  c="sudo docker compose -f infra/docker-compose.oracle.yml --env-file .env"
  $c stop worker api
  $c exec -T postgres sh -c "dropdb -U aftershock --if-exists aftershock && createdb -U aftershock aftershock"
  $c exec -T postgres pg_restore -U aftershock -d aftershock --no-owner < ~/aftershock.dump
  $c start api worker
  rm ~/aftershock.dump'
rm -f "$dump"
echo "Done. The worker rebuilds its live state from the restored database."
