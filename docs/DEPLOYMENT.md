# home-os — CI/CD & Deployment

> How code gets from `git push` to running on the Pi. Zero-Docker, single
> Node process, Tailscale Serve for TLS, GitHub Actions for CD.

## Topology

```
   Developer laptop
        │ git push origin main
        ▼
   GitHub ──(ci.yml)──► typecheck / lint / test / build
        │
        │ (on success)
        ▼
   deploy.yml
   ├─ wait-for-ci   (waits for the build-test job on the same SHA)
   └─ deploy
       ├─ join tailnet as ephemeral node (Tailscale OAuth)
       └─ ssh chasehelton@pi4.tailebbd07.ts.net
              └─ scripts/deploy.sh
                   ├─ git reset --hard origin/main
                   ├─ pnpm install --frozen-lockfile
                   ├─ pnpm build
                   ├─ pnpm --filter=@home-os/db migrate:safe
                   ├─ sudo systemctl restart home-os-api.service
                   └─ curl /health/ready  (30s timeout, fail loudly)

   Raspberry Pi 4 (pi4.tailebbd07.ts.net)
   ├─ systemd: home-os-api.service
   │    └─ tsx apps/api/src/server.ts  (Fastify on 127.0.0.1:4000)
   │           │
   │           ├─ /api, /auth, /health                → Fastify handlers
   │           └─ everything else + SPA fallback      → apps/web/dist (static)
   │
   └─ tailscaled — `tailscale serve --https=443 http://127.0.0.1:4000`
        provides the free tailnet TLS cert on the hostname.
```

There is **one Node process** on the Pi. The API serves the web SPA from
the same origin as `/api/*`, so there's no separate web service, no CORS
on the tailnet URL, no Caddy, no Docker.

## Production host

| Thing              | Value                                            |
| ------------------ | ------------------------------------------------ |
| User               | `chasehelton`                                    |
| Repo checkout      | `~/repos/home-os`                                |
| Data dir           | `~/repos/home-os/.data` (per `.env`)             |
| Systemd unit       | `/etc/systemd/system/home-os-api.service`        |
| Node               | `/usr/bin/node` v22.x                            |
| pnpm               | `~/.npm-global/bin/pnpm` v10.x                   |
| Tailnet hostname   | `pi4.tailebbd07.ts.net`                          |
| Public URL         | `https://pi4.tailebbd07.ts.net`                  |

The systemd unit runs the API under `tsx` directly from source (the
workspace packages expose `./src/*.ts` via their `exports`, so we don't
ship compiled JS in prod — tsx is a devDep and is installed during
`pnpm install --frozen-lockfile`). A fast per-deploy build step still
runs `tsc -b` + `vite build` to produce `apps/web/dist/` which the API
serves via `@fastify/static`.

## Key files

| File                                       | Purpose                                                |
| ------------------------------------------ | ------------------------------------------------------ |
| `.github/workflows/ci.yml`                 | Typecheck / lint / test / build on every push + PR.    |
| `.github/workflows/deploy.yml`             | Waits for CI; SSH-deploys to the Pi on pushes to main. |
| `infra/systemd/home-os-api.service`        | Templated systemd unit (`__HOME_OS_*__` placeholders). |
| `scripts/setup-pi.sh`                      | One-time Pi bootstrap (idempotent). `sudo -E bash …`   |
| `scripts/deploy.sh`                        | Per-deploy runner. Invoked by deploy.yml over SSH.     |
| `scripts/backup-snapshot.sh`               | Online `sqlite3 .backup` + tarball of recipes/images.  |
| `apps/api/src/app.ts` (`@fastify/static`)  | SPA fallback: non-API 404s → `index.html`.             |

## Workflows

### ci.yml — runs on every push and PR

Job name: **`build-test`**. Runs: `pnpm install` → `pnpm typecheck` →
`pnpm lint` → `pnpm test` → `pnpm build`. deploy.yml keys off this job
name via `lewagon/wait-on-check-action`, so do not rename `build-test`
without updating deploy.yml.

### deploy.yml — runs on push to `main`

Two jobs:

1. **`wait-for-ci`** — polls `build-test` on the same SHA. Fails if CI
   fails. Skips deploy.
2. **`deploy`** — depends on `wait-for-ci`.
   - Joins the tailnet as an ephemeral node using `tailscale/github-action@v3`
     with the OAuth client secrets (`TAILSCALE_OAUTH_CLIENT_ID` /
     `TAILSCALE_OAUTH_SECRET`). The ephemeral node uses tag `tag:ci`.
   - Writes `PI_SSH_PRIVATE_KEY` to `~/.ssh/pi`, chmod 600.
   - Runs `ssh ${PI_USER}@${PI_HOST} 'cd ~/repos/home-os && scripts/deploy.sh'`.
   - After the SSH exits, the runner exits and the ephemeral node is
     reaped from the tailnet automatically.

## Required GitHub secrets

Set these as **Repository secrets** (Settings → Secrets and variables →
Actions → Secrets). No GitHub Environment is used.

| Secret                      | Value                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `PI_HOST`                   | `pi4.tailebbd07.ts.net`                                                                    |
| `PI_USER`                   | `chasehelton`                                                                              |
| `PI_SSH_PRIVATE_KEY`        | The full contents of an ed25519 private key (including BEGIN/END lines and trailing \n).   |
| `TAILSCALE_OAUTH_CLIENT_ID` | From Tailscale Admin → Settings → OAuth clients. Scope `devices:write`, tag `tag:ci`.      |
| `TAILSCALE_OAUTH_SECRET`    | Matching secret.                                                                           |

Optional variable `TAILSCALE_TAGS` (default `tag:ci`) — must already be
allowed by your tailnet ACL.

### Tailnet ACL requirement

The `tag:ci` tag must have a `tagOwners` entry in the tailnet policy
file (`https://login.tailscale.com/admin/acls/file`):

```hujson
"tagOwners": {
  "tag:ci": ["autogroup:admin"],
}
```

Without this, the OAuth client cannot tag the ephemeral node and deploy.yml
fails during the Tailscale action step.

## One-time Pi setup

Already done on `pi4`; documented here for disaster recovery.

```bash
# On the Pi, as the user that will own the checkout:
git clone git@github.com:chasehelton/home-os.git ~/repos/home-os
cd ~/repos/home-os
cp .env.example .env && $EDITOR .env   # fill in Google OAuth, allowlist, etc.
sudo -E bash scripts/setup-pi.sh
```

`setup-pi.sh` is idempotent. Re-run it any time to re-provision (e.g.
after editing the systemd unit template). It does:

1. Resolve `HOME_OS_DATA_DIR` from `.env` (relative paths resolve under
   the repo). Creates `db/`, `recipes/`, `images/`, `backups/` and chowns
   to the run user.
2. Probes known pnpm locations (corepack shim in `~/.local/share/pnpm`,
   npm-global in `~/.npm-global/bin`, etc.) since `sudo` strips PATH.
3. Runs `pnpm install --frozen-lockfile && pnpm build` as the run user.
4. Runs `pnpm --filter=@home-os/db migrate:safe` (pre-migrate snapshot +
   destructive-migration gate).
5. Substitutes `__HOME_OS_USER__`, `__HOME_OS_REPO__`,
   `__HOME_OS_DATA_DIR__` into `infra/systemd/home-os-api.service` and
   writes it to `/etc/systemd/system/`. `systemctl enable --now`.
6. `tailscale serve reset && tailscale serve --bg --https=443 http://127.0.0.1:4000`.
7. Polls `/health/live` for 30s.

### Passwordless sudo for the deploy script

`deploy.sh` needs passwordless sudo for a narrow allowlist so SSH-based
deploys don't hang on a tty prompt:

```bash
echo "chasehelton ALL=(ALL) NOPASSWD: /bin/systemctl restart home-os-api.service, /bin/journalctl -u home-os-api *" | sudo tee /etc/sudoers.d/home-os-deploy
sudo chmod 440 /etc/sudoers.d/home-os-deploy
```

### SSH key for CD

Generate on a workstation, install on the Pi, put the private key in the
GitHub secret:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/home_os_cd -N '' -C home-os-cd
ssh-copy-id -i ~/.ssh/home_os_cd.pub chasehelton@pi4.tailebbd07.ts.net
cat ~/.ssh/home_os_cd   # → GitHub secret PI_SSH_PRIVATE_KEY
```

## Environment variables

All runtime config is in `/home/chasehelton/repos/home-os/.env` on the
Pi (loaded by systemd via `EnvironmentFile=`). The systemd unit
additionally **overrides** a few values that must be production-safe:

| Unit override                                       | Reason                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| `HOME_OS_API_HOST=127.0.0.1`                        | Listen on loopback only; Tailscale Serve handles TLS + external access.   |
| `HOME_OS_API_PORT=4000`                             | Matches the `tailscale serve` target and `scripts/deploy.sh` healthcheck. |
| `HOME_OS_WEB_STATIC_DIR=__HOME_OS_REPO__/apps/web/dist` | Where @fastify/static serves the SPA from.                            |
| `HOME_OS_AUTO_MIGRATE=false`                        | Production runs migrations only via `migrate:safe` in deploy.sh.          |
| `NODE_ENV=production`                               |                                                                           |

`.env` itself holds the Google OAuth client ID/secret, allowed emails,
`HOME_OS_SESSION_SECRET`, `HOME_OS_TOKEN_KEY`, VAPID keys (if push is
enabled), etc. Never commit `.env`.

### Kiosk device login (`HOME_OS_KIOSK_TOKEN`)

Google blocks OAuth inside embedded browsers (Electron, WebView, etc.),
so the Pi kiosk cannot sign in via the normal `/auth/google/login`
flow. Instead it uses a bearer-token endpoint, `POST /auth/kiosk`,
keyed on two env vars that must be set **together** on the API side:

| Var                          | Notes                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| `HOME_OS_KIOSK_TOKEN`        | Random secret, ≥32 chars. Generate with `openssl rand -hex 32`.                          |
| `HOME_OS_KIOSK_USER_EMAIL`   | The email the kiosk logs in as. Must also appear in `HOME_OS_ALLOWED_EMAILS`.            |

The API auto-creates a `users` row for that email on first call
(`google_sub` null). Once the same email later signs into Google from a
real browser, the calendar-connect handler claims the `google_sub` onto
the existing row, so no duplicate account is produced.

Sessions minted by this path are tagged `auth_method='kiosk'` in the
`sessions` table; rotating the token invalidates future logins but not
existing sessions — revoke those by deleting the relevant rows.

**Provisioning (on the Pi):**

```bash
# API side — append to /home/chasehelton/repos/home-os/.env
HOME_OS_KIOSK_TOKEN=<32+ hex chars from openssl rand -hex 32>
HOME_OS_KIOSK_USER_EMAIL=kiosk@yourhousehold.example
# And make sure HOME_OS_ALLOWED_EMAILS contains that address.

# Kiosk side — /etc/home-os-kiosk.env (root:root 0600)
sudo install -m 0600 /dev/null /etc/home-os-kiosk.env
sudo tee /etc/home-os-kiosk.env >/dev/null <<EOF
HOME_OS_KIOSK_TOKEN=<same value as API side>
EOF

sudo systemctl restart home-os-api.service
systemctl --user restart home-os-kiosk.service
```

The kiosk systemd unit references this file via
`EnvironmentFile=-/etc/home-os-kiosk.env` (the leading `-` makes it
non-fatal in dev when the file is absent). The Electron main process
calls `POST /auth/kiosk` at startup and whenever it reloads the URL;
the returned `Set-Cookie: sid=…` lands in the default Electron session
cookie jar and is used by subsequent navigation.

## Migration safety

Production migrations go through `packages/db/src/migrate-safe.ts`:

1. Takes a `sqlite3 .backup` online snapshot into `$DATA/backups/<UTC-stamp>/`.
2. Statically scans pending migration SQL (comments stripped, drizzle
   statement-breakpoints honoured) for destructive patterns:
   - `DROP TABLE`
   - `ALTER TABLE … DROP COLUMN`
   - The drizzle recreate-table pattern (`CREATE TABLE __new_*` +
     `INSERT … SELECT` + `DROP TABLE`).
3. Aborts the deploy if any pending migration is destructive, unless
   `HOME_OS_ALLOW_DESTRUCTIVE_MIGRATIONS=1` is set for that invocation
   (documented, deliberate override).
4. Applies pending migrations; deploy.sh only proceeds to
   `systemctl restart` if migrations succeed.

## Backups

Install a nightly timer (or cron) to snapshot + prune:

```bash
(crontab -l 2>/dev/null; echo "15 3 * * * cd $HOME/repos/home-os && scripts/backup-snapshot.sh") | crontab -
```

`scripts/backup-snapshot.sh` writes to `$HOME_OS_DATA_DIR/backups/<ISO-stamp>/`:

- `home-os.sqlite.backup`  — `sqlite3 .backup` online snapshot (safe on
  an active WAL DB).
- `recipes.tar.zst`        — tarball of the markdown recipe store.
- `images.tar.zst`         — tarball of uploaded images.

Retention: `KEEP_DAYS=14` by default. Point the data dir at external
storage or `rsync` the backups off-Pi if you want off-host durability.

## Observability

| Thing                   | Command                                     |
| ----------------------- | ------------------------------------------- |
| Service status          | `systemctl status home-os-api`              |
| Live logs               | `journalctl -u home-os-api -f`              |
| Tailscale Serve mapping | `tailscale serve status`                    |
| Healthcheck             | `curl -sf http://127.0.0.1:4000/health/ready` |
| Last deploy SHA         | `git -C ~/repos/home-os rev-parse --short HEAD` |

The Fastify app emits structured pino JSON logs; journald captures them.
`journalctl -u home-os-api -o json-pretty` gives parsed output.

## Rollback

There are no immutable release artifacts (no GHCR images), so rollback
is a revert commit:

```bash
# On your laptop:
git revert <bad-sha>
git push origin main
# CD picks it up automatically and rolls forward to the reverted state.
```

If the API is crash-looping hard enough that `migrate:safe` on a bad SHA
ran first, restore the pre-migration snapshot from
`$HOME_OS_DATA_DIR/backups/<stamp>/home-os.sqlite.backup` over
`$HOME_OS_DATA_DIR/db/home-os.sqlite` (stop the service first).

## Local dev

Totally separate from the deploy story. `pnpm dev` runs:

- `apps/api` on `:4000` via `tsx watch` (auto-migrates; `HOME_OS_AUTO_MIGRATE=true`).
- `apps/web` on `:5173` via Vite dev server (HMR).

Hitting `http://localhost:5173` in dev uses Vite's proxy to reach the API
on `:4000`. **Tailscale Serve on the Pi proxies `:4000`**, so do NOT run
`pnpm dev` on the Pi at the same time as the prod service — they fight
for `:4000`. Dev happens on your laptop; the Pi runs prod only.

## Gotchas

- **Don't rename ci.yml's `build-test` job** without updating deploy.yml.
- **Don't set `HOME_OS_AUTO_MIGRATE=true`** in the systemd unit or on the
  Pi's `.env`. The gate lives in `migrate:safe`; auto-migrate bypasses it.
- **Don't run `pnpm dev` on the Pi.** It collides with the systemd
  service on `:4000`.
- **Ephemeral Tailscale nodes** from CI are short-lived (reaped by
  tailscaled after ~5m of inactivity). If a deploy fails mid-run the
  node will disappear on its own.
- **`pnpm install --frozen-lockfile`** is required — drift between
  `pnpm-lock.yaml` and `package.json` will fail the deploy.
