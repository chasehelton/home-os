#!/usr/bin/env bash
# scripts/backup-snapshot.sh — nightly on-box snapshot.
#
# Runs the same sqlite online backup API the API server uses, then tars the
# recipes/ + images/ directories, producing a single dated directory under
# $HOME_OS_DATA_DIR/backups/.
#
# Install as a root cron/timer, e.g.:
#
#   # /etc/cron.daily/home-os-backup
#   #!/bin/sh
#   /opt/home-os/scripts/backup-snapshot.sh
#
# Exit non-zero on failure so cron emails about it. The script prunes
# backups older than $KEEP_DAYS days (default 14).

set -euo pipefail

HOME_OS_DATA_DIR=${HOME_OS_DATA_DIR:-/srv/home-os/data}
HOME_OS_REPO_DIR=${HOME_OS_REPO_DIR:-/opt/home-os}
KEEP_DAYS=${KEEP_DAYS:-14}

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT_DIR="$HOME_OS_DATA_DIR/backups/$STAMP"
DB_SRC="$HOME_OS_DATA_DIR/db/home-os.sqlite"

log() { printf '[backup %s] %s\n' "$STAMP" "$*"; }

if [ ! -f "$DB_SRC" ]; then
  log "no DB at $DB_SRC — nothing to back up"
  exit 0
fi

mkdir -p "$OUT_DIR"

log "snapshotting sqlite → $OUT_DIR/home-os.sqlite"
sqlite3 "$DB_SRC" ".backup '$OUT_DIR/home-os.sqlite'"

if [ -d "$HOME_OS_DATA_DIR/recipes" ]; then
  log "archiving recipes/"
  tar -C "$HOME_OS_DATA_DIR" -czf "$OUT_DIR/recipes.tar.gz" recipes
fi

if [ -d "$HOME_OS_DATA_DIR/images" ]; then
  log "archiving images/"
  tar -C "$HOME_OS_DATA_DIR" -czf "$OUT_DIR/images.tar.gz" images
fi

log "pruning backups older than $KEEP_DAYS day(s)"
find "$HOME_OS_DATA_DIR/backups" -mindepth 1 -maxdepth 1 -type d \
    -mtime "+$KEEP_DAYS" -print -exec rm -rf {} + || true

log "done: $OUT_DIR"
