#!/usr/bin/env bash
# scripts/provision-pi.sh — idempotent bootstrap for a fresh Raspberry Pi.
#
# Does the minimum needed to run home-os as a 24/7 household service:
#   1. Creates the `home-os` user (uid/gid 1000) and the data tree.
#   2. Installs Docker Engine + compose plugin (Debian/Raspberry Pi OS).
#   3. Installs Tailscale (user wires up `tailscale up` interactively).
#   4. Clones/updates the repo at /opt/home-os.
#   5. Restores the latest Litestream replica into $HOME_OS_DATA_DIR/db
#      IF the DB file doesn't exist (first-time bootstrap / card swap).
#   6. Installs the home-os.service + home-os-kiosk.service systemd units.
#   7. Installs the logrotate config.
#
# Safe to re-run. Each step is guarded by an `if not present` check.
#
# Required env (inherited or in /etc/home-os/provision.env):
#   HOME_OS_DATA_DIR           (default /srv/home-os/data)
#   LITESTREAM_REPLICA_URL     (only required for step 5)
#   LITESTREAM_ACCESS_KEY_ID
#   LITESTREAM_SECRET_ACCESS_KEY

set -euo pipefail

HOME_OS_REPO=${HOME_OS_REPO:-https://github.com/chasehelton/home-os.git}
HOME_OS_REPO_DIR=${HOME_OS_REPO_DIR:-/opt/home-os}
HOME_OS_DATA_DIR=${HOME_OS_DATA_DIR:-/srv/home-os/data}
HOME_OS_USER=home-os
HOME_OS_UID=1000
HOME_OS_GID=1000

log() { printf '\033[1;36m[provision]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[provision]\033[0m %s\n' "$*" >&2; }

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    err "must be run as root (sudo)"; exit 1
  fi
}

ensure_user() {
  if id -u "$HOME_OS_USER" >/dev/null 2>&1; then
    log "user $HOME_OS_USER exists"
    return
  fi
  log "creating user $HOME_OS_USER (uid $HOME_OS_UID)"
  groupadd --gid "$HOME_OS_GID" "$HOME_OS_USER" || true
  useradd  --uid "$HOME_OS_UID" --gid "$HOME_OS_GID" \
           --home /var/lib/home-os --create-home --shell /usr/sbin/nologin \
           "$HOME_OS_USER"
}

ensure_data_tree() {
  log "ensuring data tree at $HOME_OS_DATA_DIR (uid:gid ${HOME_OS_UID}:${HOME_OS_GID})"
  mkdir -p "$HOME_OS_DATA_DIR"/{db,recipes,images,backups,litestream}
  chown -R "${HOME_OS_UID}:${HOME_OS_GID}" "$HOME_OS_DATA_DIR"
  chmod 750 "$HOME_OS_DATA_DIR"
  mkdir -p /var/log/home-os
  chown "${HOME_OS_UID}:${HOME_OS_GID}" /var/log/home-os
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "docker + compose already installed"
    return
  fi
  log "installing docker"
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
}

install_tailscale() {
  if command -v tailscale >/dev/null 2>&1; then
    log "tailscale already installed"
    return
  fi
  log "installing tailscale"
  curl -fsSL https://tailscale.com/install.sh | sh
  log "run 'sudo tailscale up' interactively to authenticate"
}

clone_repo() {
  if [ -d "$HOME_OS_REPO_DIR/.git" ]; then
    log "repo exists; fetching latest"
    git -C "$HOME_OS_REPO_DIR" fetch --all --prune
    git -C "$HOME_OS_REPO_DIR" pull --ff-only origin main || log "  (not on main; skipping pull)"
    return
  fi
  log "cloning $HOME_OS_REPO → $HOME_OS_REPO_DIR"
  mkdir -p "$(dirname "$HOME_OS_REPO_DIR")"
  git clone "$HOME_OS_REPO" "$HOME_OS_REPO_DIR"
  if [ ! -f "$HOME_OS_REPO_DIR/.env" ]; then
    cp "$HOME_OS_REPO_DIR/.env.example" "$HOME_OS_REPO_DIR/.env"
    log "wrote $HOME_OS_REPO_DIR/.env from .env.example — edit before starting!"
  fi
}

restore_from_litestream_if_empty() {
  local db="$HOME_OS_DATA_DIR/db/home-os.sqlite"
  if [ -f "$db" ]; then
    log "DB exists at $db; skipping restore"
    return
  fi
  if [ -z "${LITESTREAM_REPLICA_URL:-}" ]; then
    log "no DB and no LITESTREAM_REPLICA_URL — fresh start (migrations will create schema)"
    return
  fi
  log "restoring DB from $LITESTREAM_REPLICA_URL"
  docker run --rm \
    -e LITESTREAM_ACCESS_KEY_ID \
    -e LITESTREAM_SECRET_ACCESS_KEY \
    -e LITESTREAM_REGION \
    -v "$HOME_OS_DATA_DIR/db:/data/db" \
    litestream/litestream:0.3 \
    restore -if-replica-exists -o /data/db/home-os.sqlite "$LITESTREAM_REPLICA_URL"
  chown "${HOME_OS_UID}:${HOME_OS_GID}" "$HOME_OS_DATA_DIR/db"/*
}

install_systemd_units() {
  log "installing systemd units"
  install -m 0644 "$HOME_OS_REPO_DIR/infra/systemd/home-os.service" \
    /etc/systemd/system/home-os.service
  install -m 0644 "$HOME_OS_REPO_DIR/infra/systemd/home-os-kiosk.service" \
    /etc/systemd/system/home-os-kiosk.service
  systemctl daemon-reload
  log "enable with: sudo systemctl enable --now home-os.service"
}

install_logrotate() {
  install -m 0644 "$HOME_OS_REPO_DIR/infra/logrotate/home-os" \
    /etc/logrotate.d/home-os
}

main() {
  require_root
  ensure_user
  ensure_data_tree
  install_docker
  install_tailscale
  clone_repo
  restore_from_litestream_if_empty
  install_systemd_units
  install_logrotate
  log "done. Next: edit $HOME_OS_REPO_DIR/.env, then \`systemctl enable --now home-os\`."
}

main "$@"
