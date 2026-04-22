#!/usr/bin/env bash
# scripts/restore-from-litestream.sh
#
# Pulls the latest Litestream replica down into $HOME_OS_DATA_DIR/db.
# Intended for disaster recovery drills and Pi re-provisioning.
#
# Safety: refuses to overwrite an existing DB file unless --force is given.
# The replica URL, creds, and region are read from the env (typically
# sourced from /opt/home-os/.env).

set -euo pipefail

HOME_OS_DATA_DIR=${HOME_OS_DATA_DIR:-/srv/home-os/data}
DB_TARGET="$HOME_OS_DATA_DIR/db/home-os.sqlite"
FORCE=0

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -h|--help)
      cat <<EOF
Usage: restore-from-litestream.sh [--force]

Reads env:
  LITESTREAM_REPLICA_URL
  LITESTREAM_ACCESS_KEY_ID
  LITESTREAM_SECRET_ACCESS_KEY
  LITESTREAM_REGION         (optional)
  HOME_OS_DATA_DIR          (default /srv/home-os/data)
EOF
      exit 0
      ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

if [ -z "${LITESTREAM_REPLICA_URL:-}" ]; then
  echo "LITESTREAM_REPLICA_URL not set" >&2
  exit 1
fi

if [ -f "$DB_TARGET" ] && [ "$FORCE" -ne 1 ]; then
  echo "refusing to overwrite existing $DB_TARGET (pass --force to replace)" >&2
  exit 1
fi

mkdir -p "$(dirname "$DB_TARGET")"

echo "[restore] replica=$LITESTREAM_REPLICA_URL target=$DB_TARGET"
docker run --rm \
  -e LITESTREAM_ACCESS_KEY_ID \
  -e LITESTREAM_SECRET_ACCESS_KEY \
  -e LITESTREAM_REGION \
  -v "$(dirname "$DB_TARGET"):/data/db" \
  litestream/litestream:0.3 \
  restore -if-replica-exists -o "/data/db/$(basename "$DB_TARGET")" "$LITESTREAM_REPLICA_URL"

chown 1000:1000 "$DB_TARGET" 2>/dev/null || true
echo "[restore] done."
