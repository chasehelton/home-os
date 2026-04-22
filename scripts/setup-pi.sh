#!/usr/bin/env bash
# home-os — one-shot Pi bootstrap for the native (no-Docker) deploy path.
#
# What this does, idempotently:
#   1. Installs the home-os-api systemd unit, templated to the current user
#      and repo checkout.
#   2. Ensures HOME_OS_DATA_DIR exists and is writable.
#   3. Runs pnpm install + pnpm build once so the service has something to start.
#   4. Runs the safe migration path (pre-migrate snapshot + destructive gate).
#   5. Points Tailscale Serve at http://127.0.0.1:4000 (the API also serves the SPA).
#   6. Enables + starts home-os-api.service.
#
# Run from the repo root:
#   sudo -E bash scripts/setup-pi.sh
#
# (needs sudo for the systemd unit copy and `tailscale serve`)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUN_USER="${SUDO_USER:-$(whoami)}"
DATA_DIR_DEFAULT="/home/${RUN_USER}/.home-os/data"

# Resolve HOME_OS_DATA_DIR from the repo's .env (if present) else fall back.
DATA_DIR_FROM_ENV="$(grep -E '^HOME_OS_DATA_DIR=' "${REPO_DIR}/.env" 2>/dev/null | head -1 | cut -d= -f2- || true)"
DATA_DIR="${DATA_DIR_FROM_ENV:-$DATA_DIR_DEFAULT}"
# Expand relative paths against the repo dir.
case "$DATA_DIR" in
  /*) ;;
  *) DATA_DIR="${REPO_DIR}/${DATA_DIR}" ;;
esac

echo "==> home-os setup"
echo "    repo:     ${REPO_DIR}"
echo "    user:     ${RUN_USER}"
echo "    data dir: ${DATA_DIR}"

# -----------------------------------------------------------------------------
# 1. Deps must already be present (node 22, tailscale on PATH; pnpm on the
#    run user's PATH — sudo strips PATH so we check as the user).
# -----------------------------------------------------------------------------
for cmd in node tailscale; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: \`$cmd\` not in PATH. Install it before running setup-pi.sh." >&2
    exit 1
  fi
done

# pnpm commonly lives under ~/.local/share/pnpm or corepack shims that root
# doesn't see. Resolve it in the run user's login shell.
PNPM_BIN="$(sudo -u "$RUN_USER" -H bash -lc 'command -v pnpm' 2>/dev/null || true)"
if [ -z "$PNPM_BIN" ]; then
  echo "ERROR: \`pnpm\` not found for user ${RUN_USER}. Install it (e.g. \`corepack enable && corepack prepare pnpm@latest --activate\`) and retry." >&2
  exit 1
fi
echo "    pnpm:     ${PNPM_BIN}"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "ERROR: Node ${NODE_MAJOR} found; home-os requires Node 22+." >&2
  exit 1
fi

# -----------------------------------------------------------------------------
# 2. Data directories.
# -----------------------------------------------------------------------------
mkdir -p "$DATA_DIR"/{db,recipes,images,backups}
chown -R "${RUN_USER}:${RUN_USER}" "$DATA_DIR"

# -----------------------------------------------------------------------------
# 3. Build the app (so the systemd unit has something to start).
# -----------------------------------------------------------------------------
echo "==> pnpm install + build"
sudo -u "$RUN_USER" -H bash -lc "cd '${REPO_DIR}' && pnpm install --frozen-lockfile && pnpm build"

# -----------------------------------------------------------------------------
# 4. Apply migrations via the safe path.
# -----------------------------------------------------------------------------
echo "==> running safe migrations"
sudo -u "$RUN_USER" -H bash -lc \
  "cd '${REPO_DIR}' && HOME_OS_DATA_DIR='${DATA_DIR}' pnpm --filter=@home-os/db migrate:safe"

# -----------------------------------------------------------------------------
# 5. Install & enable the systemd unit.
# -----------------------------------------------------------------------------
echo "==> installing systemd unit"
UNIT_SRC="${REPO_DIR}/infra/systemd/home-os-api.service"
UNIT_DST="/etc/systemd/system/home-os-api.service"

sed \
  -e "s|__HOME_OS_USER__|${RUN_USER}|g" \
  -e "s|__HOME_OS_REPO__|${REPO_DIR}|g" \
  -e "s|__HOME_OS_DATA_DIR__|${DATA_DIR}|g" \
  "$UNIT_SRC" > "$UNIT_DST"

systemctl daemon-reload
systemctl enable home-os-api.service
systemctl restart home-os-api.service

# Wait for readiness.
for _ in $(seq 1 30); do
  if curl -sf http://127.0.0.1:4000/health/live >/dev/null; then
    echo "==> home-os-api is up"
    break
  fi
  sleep 1
done

# -----------------------------------------------------------------------------
# 6. Tailscale Serve — expose https://<tailnet-host>/ → http://127.0.0.1:4000.
#    (idempotent; this replaces any existing mapping.)
# -----------------------------------------------------------------------------
echo "==> configuring tailscale serve"
tailscale serve reset >/dev/null 2>&1 || true
tailscale serve --bg --https=443 http://127.0.0.1:4000

cat <<EOF

==> done.

  Service:    systemctl status home-os-api
  Logs:       journalctl -u home-os-api -f
  Tailscale:  tailscale serve status
  URL:        $(tailscale status --json 2>/dev/null | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log("https://"+j.Self.DNSName.replace(/\.$/,""))' 2>/dev/null || echo https://<tailnet-host>)

  Push a commit to \`main\` and the CD workflow will deploy it here.

EOF
