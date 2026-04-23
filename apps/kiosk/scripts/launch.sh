#!/usr/bin/env bash
# home-os kiosk launcher. Invoked by the user systemd unit
# infra/systemd/home-os-kiosk.service. Responsible for:
#   - pointing Electron at the running Wayland compositor
#   - closing any leftover Chromium window so the Electron kiosk owns the screen
#   - exec'ing Electron with Wayland-appropriate flags
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
KIOSK_DIR="$REPO_DIR/apps/kiosk"
ELECTRON_BIN="$KIOSK_DIR/node_modules/.bin/electron"

# Fall back to the workspace-hoisted electron if the app-local .bin is missing
# (pnpm may place it under node_modules/.pnpm and only symlink at app level).
if [ ! -x "$ELECTRON_BIN" ]; then
  ELECTRON_BIN="$REPO_DIR/node_modules/.bin/electron"
fi

if [ ! -x "$ELECTRON_BIN" ]; then
  echo "ERROR: electron binary not found. Run 'pnpm install' from $REPO_DIR." >&2
  exit 1
fi

if [ ! -f "$KIOSK_DIR/dist/main.js" ]; then
  echo "ERROR: kiosk is not built. Run 'pnpm --filter @home-os/kiosk build'." >&2
  exit 1
fi

# Wayland plumbing. XDG_RUNTIME_DIR is inherited via PAM; WAYLAND_DISPLAY is
# labwc's default socket name. Override via environment in the unit if needed.
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

# Close any Chromium window owned by this user. Best-effort; we don't care if
# it was already gone. `pkill` exit code 1 just means "no process matched".
pkill -u "$(id -u)" -x chromium 2>/dev/null || true
pkill -u "$(id -u)" -x chromium-browser 2>/dev/null || true

cd "$KIOSK_DIR"
exec "$ELECTRON_BIN" \
  --ozone-platform=wayland \
  --enable-features=UseOzonePlatform,WaylandWindowDecorations \
  --touch-events=enabled \
  --enable-pinch \
  --no-sandbox \
  "$KIOSK_DIR/dist/main.js"
