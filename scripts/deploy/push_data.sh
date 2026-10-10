#!/usr/bin/env bash
# Copy the local database and replay bundles to the Oracle VM. Run from the
# repo on your laptop:  scripts/deploy/push_data.sh ubuntu@VM_IP
# Uses the local Postgres on port 55432 (see docs/PROGRESS.md).
set -euo pipefail
vm="${1:?usage: push_data.sh ubuntu@VM_IP}"
cd "$(dirname "$0")/../.."
dump="$(mktemp -t aftershock).dump"
# Use pg_dump 16: an older one refuses the 16 server, and a newer one writes
# an archive the VM's pg_restore 16 cannot read.
pg_dump=pg_dump
[ -x /opt/homebrew/opt/postgresql@16/bin/pg_dump ] && pg_dump=/opt/homebrew/opt/postgresql@16/bin/pg_dump

echo "== Dumping the local database (a few minutes)"
PGPASSWORD="${PGPASSWORD:-aftershock}" "$pg_dump" -h localhost -p 55432 -U aftershock -d aftershock -Fc -Z 6 -f "$dump"
ls -lh "$dump"

echo "== Copying the dump and replay bundles to $vm"
scp "$dump" "$vm:~/aftershock.dump"
# The containers write data/ as root.
rsync -az --stats --rsync-path="sudo rsync" data/replays/ "$vm:~/Aftershock/data/replays/"
# Team ratings are rebuilt from the games table in data/features plus the raw
# play-by-play of games played since it was built (this season's). Without
# them the worker rates teams from almost nothing and every odds is wrong.
echo "== Copying the model inputs (games table and this season's play-by-play)"
rsync -az --stats --rsync-path="sudo rsync" data/features/ "$vm:~/Aftershock/data/features/"
season=$(date +%Y); [ "$(date +%m)" -lt 8 ] && season=$((season - 1))
rsync -az --stats --rsync-path="sudo rsync" --include="${season}*" --exclude="*" \
  data/raw/play-by-play/ "$vm:~/Aftershock/data/raw/play-by-play/"

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
