# home-os

Self-hosted household OS for our kitchen: shared/per-user todos, meal planning, recipes, Google-synced calendars, and an AI assistant — running 24/7 on a Raspberry Pi, over Tailscale.

> **Status:** Phase 0 — monorepo scaffold. See the session plan (`plan.md`) for the full implementation plan.

## Stack

| Layer | Choice |
|---|---|
| Monorepo | pnpm workspaces, TypeScript project references |
| Backend | Fastify + Drizzle ORM + better-sqlite3 (WAL) |
| Frontend | React + Vite + TypeScript + Tailwind (PWA) |
| Kiosk | Electron (native via systemd, not Docker) |
| AI | Provider-abstracted in `packages/ai` (disabled by default) |
| Auth | Google OAuth (email allowlist) + session cookies |
| Network | Tailscale + Caddy (tailnet TLS) |
| Deploy | Docker Compose + systemd, on a Pi 4 8GB |
| Storage | Configurable `HOME_OS_DATA_DIR` — SD card today, USB-3 SSD later |
| Backup | Litestream → S3/B2 (continuous) + nightly `.backup` snapshots |

## Layout

```
apps/
  api/      Fastify API server (the only DB writer)
  web/      React PWA (served to kiosk + mobile)
  kiosk/    Electron shell (phase 8)
packages/
  shared/   zod schemas + shared TS types
  db/       drizzle schema, migrations, better-sqlite3 bootstrapping
  ai/       AI provider interface (disabled by default)
infra/
  docker/   Dockerfiles + docker-compose
  caddy/    Caddyfile
  litestream/
  systemd/  kiosk.service etc.
scripts/    provision-pi.sh, backup, restore
```

## Getting started

Requires Node 22+ and pnpm 10+.

```bash
cp .env.example .env
pnpm install
pnpm db:generate      # emit first migration from schema.ts
pnpm db:migrate       # apply migrations to the local sqlite file
pnpm dev              # api on :4000, web on :5173
```

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Run api + web in parallel with HMR |
| `pnpm build` | Build all workspaces |
| `pnpm typecheck` | Typecheck every workspace |
| `pnpm lint` | ESLint across the repo |
| `pnpm test` | Vitest across the repo |
| `pnpm db:generate` | Generate new SQL migration from `schema.ts` |
| `pnpm db:migrate` | Apply pending migrations to SQLite |

## Storage (`HOME_OS_DATA_DIR`)

Everything persistent lives under one configurable root. Dev default: `./.data`.
On the Pi, set it to `/srv/home-os/data` (SD card) or `/mnt/data` (USB-SSD).

```
$HOME_OS_DATA_DIR/
├── db/home-os.sqlite
├── images/        # recipe images, uploads
├── litestream/    # replication WAL staging
└── backups/       # nightly .backup snapshots
```

To migrate from SD to SSD later: stop the api, `rsync` the data dir, update `.env`, restart. No code changes.

## License

MIT (pending).
