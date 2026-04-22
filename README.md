# home-os

Self-hosted household OS for our kitchen: shared/per-user todos, meal planning, recipes, Google-synced calendars, and an AI assistant — running 24/7 on a Raspberry Pi, over Tailscale.

> **Status:** Running natively on a Raspberry Pi 4 on a Tailscale tailnet. Auto-deploys on every `git push` to `main` via GitHub Actions → SSH-over-tailnet. See `docs/PLAN.md` for the phase-by-phase roadmap.

## Stack

| Layer    | Choice                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------- |
| Monorepo | pnpm workspaces, TypeScript project references                                                    |
| Backend  | Fastify + Drizzle ORM + better-sqlite3 (WAL). Serves the built web SPA via `@fastify/static`.     |
| Frontend | React + Vite + TypeScript + Tailwind (PWA)                                                        |
| Kiosk    | Electron (native via systemd)                                                                     |
| AI       | Provider-abstracted in `packages/ai` (disabled by default)                                        |
| Auth     | Google OAuth (email allowlist) + session cookies                                                  |
| Network  | Tailscale Serve — HTTPS on the tailnet host, zero-config cert                                     |
| Deploy   | Native systemd (`home-os-api.service`) on a Pi 4; GitHub Actions SSH-deploy on push to `main`     |
| Storage  | Configurable `HOME_OS_DATA_DIR` — SD card today, USB-3 SSD later                                  |
| Backup   | `scripts/backup-snapshot.sh` nightly via cron (sqlite `.backup` + recipes/images tarball)         |

## Layout

```
apps/
  api/      Fastify API server (the only DB writer; also serves the web SPA in prod)
  web/      React PWA (built with Vite; dev server on :5173, prod dist served by api)
  kiosk/    Electron shell
packages/
  shared/   zod schemas + shared TS types
  db/       drizzle schema, migrations, better-sqlite3 bootstrapping
  ai/       AI provider interface (disabled by default)
infra/
  systemd/  home-os-api.service + home-os-kiosk.service
scripts/    setup-pi.sh (one-time bootstrap), deploy.sh (idempotent CD), backup-snapshot.sh
```

## Getting started (dev)

Requires Node 22+ and pnpm 10+.

```bash
cp .env.example .env
pnpm install
pnpm db:generate      # emit first migration from schema.ts
pnpm db:migrate       # apply migrations to the local sqlite file
pnpm dev              # api on :4000, web on :5173
```

## Scripts

| Command                                  | Description                                                      |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `pnpm dev`                               | Run api + web in parallel with HMR                               |
| `pnpm build`                             | Build all workspaces                                             |
| `pnpm typecheck`                         | Typecheck every workspace                                        |
| `pnpm lint`                              | ESLint across the repo                                           |
| `pnpm test`                              | Vitest across the repo                                           |
| `pnpm db:generate`                       | Generate new SQL migration from `schema.ts`                      |
| `pnpm db:migrate`                        | Apply pending migrations to SQLite (dev)                         |
| `pnpm --filter=@home-os/db migrate:safe` | Snapshot + destructive-migration gate, then migrate (production) |

## Production deploy

The workflow: **edit code → push to `main` → CI passes → Pi auto-deploys**.

### One-time setup on the Pi

```bash
cd ~/repos/home-os   # or wherever you've cloned it
cp .env.example .env && $EDITOR .env
sudo -E bash scripts/setup-pi.sh
```

`setup-pi.sh` (idempotent) installs the `home-os-api.service` systemd unit, builds the app, runs migrations through the safety gate, enables the service, and configures Tailscale Serve to route `https://<tailnet-host>/` → `http://127.0.0.1:4000`. The API serves both `/api` and the static SPA from the same origin.

### One-time setup in GitHub

Set these **secrets** (Settings → Secrets and variables → Actions):

| Secret                       | Value                                                                  |
| ---------------------------- | ---------------------------------------------------------------------- |
| `TAILSCALE_OAUTH_CLIENT_ID`  | OAuth client ID (scope: `devices:write`). Tailscale admin → Settings → OAuth clients. |
| `TAILSCALE_OAUTH_SECRET`     | Matching OAuth secret.                                                 |
| `PI_SSH_PRIVATE_KEY`         | Contents of a new ed25519 private key; put the matching public key in `~/.ssh/authorized_keys` on the Pi. |
| `PI_HOST`                    | Tailnet hostname, e.g. `pi4.tailebbd07.ts.net`                         |
| `PI_USER`                    | Linux user on the Pi that owns the checkout                            |

Optional **variable** `TAILSCALE_TAGS` (default `tag:ci`) — must be allowed by your tailnet ACL.

### What happens on push to main

1. `ci.yml` runs typecheck / lint / tests / build.
2. `deploy.yml` waits for CI to pass, then joins the tailnet (ephemeral node), SSHes to the Pi, and runs `scripts/deploy.sh`.
3. `deploy.sh` on the Pi: `git reset --hard origin/main` → `pnpm install` → `pnpm build` → `pnpm migrate:safe` → `systemctl restart home-os-api` → curls `/health/ready` to confirm recovery.

### Migration safety

Production migrations route through `pnpm --filter=@home-os/db migrate:safe`, which:

- Takes a `sqlite3 .backup`-style snapshot into `$HOME_OS_DATA_DIR/backups/` before any DDL runs.
- Scans pending migration SQL for `DROP TABLE`, `ALTER TABLE ... DROP COLUMN`, and drizzle's recreate-table pattern.
- Refuses to proceed if any pending migration is destructive unless `HOME_OS_ALLOW_DESTRUCTIVE_MIGRATIONS=1` is set (one-time override for deliberate schema changes).

### Backup

```bash
# Install a nightly timer (or cron):
(crontab -l 2>/dev/null; echo "15 3 * * * cd $HOME/repos/home-os && scripts/backup-snapshot.sh") | crontab -
```

This writes dated snapshots to `$HOME_OS_DATA_DIR/backups/`. Point that path at an external disk or periodically sync it somewhere off-Pi.

## Storage (`HOME_OS_DATA_DIR`)

Everything persistent lives under one configurable root. Dev default: `./.data`.
On the Pi, set it to `/srv/home-os/data` (SD card) or `/mnt/data` (USB-SSD).

```
$HOME_OS_DATA_DIR/
├── db/home-os.sqlite
├── images/        # recipe images, uploads
├── recipes/       # markdown recipes
└── backups/       # nightly .backup snapshots
```

To migrate from SD to SSD later: stop the api, `rsync` the data dir, update `.env`, restart. No code changes.

## License

MIT (pending).
