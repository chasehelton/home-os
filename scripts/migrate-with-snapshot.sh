#!/usr/bin/env bash
# scripts/migrate-with-snapshot.sh
#
# Thin wrapper around `pnpm --filter=@home-os/db migrate:safe`.
# Intended for ad-hoc admin invocation on the Pi. The docker-compose stack
# runs the same logic via the `migrate` one-shot service.
#
# Usage:
#   HOME_OS_DATA_DIR=/srv/home-os/data scripts/migrate-with-snapshot.sh
#   # if a pending migration is destructive, re-run with:
#   HOME_OS_ALLOW_DESTRUCTIVE_MIGRATIONS=1 scripts/migrate-with-snapshot.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
cd "$here/.."
exec pnpm --filter=@home-os/db migrate:safe "$@"
