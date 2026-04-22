#!/usr/bin/env bash
# home-os — idempotent deploy script invoked by the CD workflow (or manually).
#
# Expects to run from the repo root on the Pi, as the user that owns the
# checkout. One-time bootstrap lives in scripts/setup-pi.sh.
#
# Usage (manual):
#   cd ~/repos/home-os && scripts/deploy.sh
#
# Usage (GitHub Actions, over SSH-on-tailnet):
#   ssh pi 'cd ~/repos/home-os && scripts/deploy.sh'
set -euo pipefail

# SSH non-interactive sessions don't source ~/.bashrc, so pnpm (installed via
# corepack or ~/.local/share/pnpm) may not be on PATH. Add common locations.
export PATH="$HOME/.npm-global/bin:$HOME/.local/share/pnpm:$HOME/.local/bin:/usr/local/bin:$PATH"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

echo "==> deploy @ $(date -Is)"
echo "    pwd: $(pwd)"
echo "    sha: $(git rev-parse --short HEAD)"

# 1. Pull the tip of main. The CD workflow only runs on main.
git fetch --prune origin
git reset --hard origin/main

echo "==> new sha: $(git rev-parse --short HEAD)"

# 2. Install deps + build. Frozen lockfile so we fail fast on drift.
pnpm install --frozen-lockfile
pnpm build

# 3. Migrate via the safe path (pre-migrate snapshot + destructive gate).
#    HOME_OS_DATA_DIR flows in from .env.
set -a
# shellcheck disable=SC1091
. ./.env
set +a
pnpm --filter=@home-os/db migrate:safe

# 4. Restart the API service. The SPA is served from apps/web/dist by the
#    same process, so there's no separate web service to restart.
sudo systemctl restart home-os-api.service

# 5. Wait for readiness. If /health/ready doesn't come back in 30s, fail
#    the deploy loudly — exit code propagates to the workflow.
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:4000/health/ready >/dev/null; then
    echo "==> home-os-api is healthy"
    exit 0
  fi
  sleep 1
done

echo "ERROR: home-os-api did not become ready within 30s" >&2
sudo journalctl -u home-os-api -n 40 --no-pager >&2 || true
exit 1
