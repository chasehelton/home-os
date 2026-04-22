# home-os — Implementation Plan

A self-hosted "household OS" for a Raspberry Pi 4 (8GB), with a kitchen touchscreen kiosk (Electron), a companion mobile PWA, and a local-first API. Think open-source Skylight + meal planning + AI assistant.

---

## 🚦 Current Status

**Up next: Phase 6 — Calendar UI.** Branch `main`; create `phase-6-calendar-ui` after P5 PR merge.

| Phase | Status | PR |
| --- | --- | --- |
| P0 Foundation | ✅ merged | #0 (initial) |
| P1 Identity & Ownership | ✅ merged | #1 |
| P2 Todos | ✅ merged | #2 |
| P3 Recipes (defuddle markdown) | ✅ merged | #3 |
| P4 Meal Planning | ✅ merged | #5 |
| P5 Calendar READ | ✅ PR open | — |
| **P6 Calendar UI** | ⏳ **next** | — |
| P7 Calendar WRITE | pending | — |
| P8 Kiosk shell | pending | — |
| P9 AI assistant | pending | — |
| P10 Deploy & hardening | pending | — |
| P11 Reminders | pending | — |

**Repo health:** 66/66 tests passing · typecheck + lint + build clean across monorepo · CI green on all PRs.

**To resume in a new session:** read this file, run `git log --oneline -10` to confirm state, check open PRs with `gh pr list`, then branch from the latest `main`.

---


## 1. Problem & Goals

Build a household app for two users (you + wife) that runs 24/7 on a home Pi, providing:
- Shared & per-user **to-dos**
- **Meal planning** (week grid)
- **Recipes** (viewer + URL import)
- **Calendar** synced to each user's Google Calendar
- **AI assistant** that accepts natural-language commands ("schedule lunch Saturday at 11")
- Kitchen **kiosk UI** optimized for touch
- **Mobile PWA** for editing from phones over Tailscale

Non-goals (MVP): multi-household support, public internet exposure, external account sharing, native mobile apps, on-device LLM.

---

## 2. Architecture

**Monorepo** via pnpm workspaces.

```
home-os/
├── apps/
│   ├── api/          # Fastify + Drizzle + better-sqlite3 (the only DB writer)
│   ├── web/          # React + Vite + TS + Tailwind (PWA). Consumed by kiosk + mobile
│   └── kiosk/        # Electron shell (loads local web build, fullscreen, autostart)
├── packages/
│   ├── shared/       # zod schemas, TS types, API client (used by web + api)
│   ├── db/           # drizzle schema + migrations + seed
│   └── ai/           # NL → tool-call abstraction (provider-swappable)
├── infra/
│   ├── docker/       # Dockerfiles + docker-compose.yml
│   ├── caddy/        # Caddyfile (tailnet TLS)
│   ├── litestream/   # litestream.yml
│   └── systemd/      # kiosk.service, update hooks
└── scripts/          # backup, restore, migrate, provision-pi
```

**Process model on the Pi:**
- Docker Compose runs: `api` (single instance, sole DB writer), `web` (static files via Caddy), `caddy` (tailnet TLS), `litestream` (separate container pointed at the DB volume).
- Electron kiosk runs **natively** under systemd (not Docker) to avoid GPU/input-device headaches. It loads `http://localhost/` served by Caddy.
- **Storage:** see §4a. Current hardware is SD-card-only; we plan around that with aggressive mitigations and a hardware-upgrade path.

**Network model:**
- Tailscale = network boundary. Device is `kitchen.tailnet.ts.net` (MagicDNS).
- Google OAuth = app identity (allowlist of 2 emails).
- Kiosk talks to `localhost`. Phones talk to the tailnet hostname over HTTPS (Caddy TLS).
- No LAN/public exposure.

---

## 3. Data & Ownership Model (defined up front)

Every domain entity has explicit scope:
- **`household`** — shared (e.g., shared todos, meal plans, recipes)
- **`user`** — owned (e.g., a user's personal todos, their Google events)
- **`kiosk_visible`** — computed boolean controlling what shows on the shared screen (defaults: shared = yes, user = no unless opted-in).

Kiosk has a simple user switcher (user chip + short PIN) for personal views. Kiosk default view = household/shared.

### Core tables (initial sketch)
- `users` (id, email, display_name, color, pin_hash)
- `sessions` (id, user_id, expires_at)
- `todos` (id, scope, owner_user_id, title, notes, due_at, completed_at, created_by)
- `recipes` (id, source_url, title, ingredients_json, steps_json, servings, image_path, imported_at, import_status)
- `meal_plan_entries` (id, date, slot [breakfast|lunch|dinner|snack], recipe_id, notes)
- `calendar_accounts` (id, user_id, google_sub, access_token_enc, refresh_token_enc, scopes)
- `calendar_lists` (id, account_id, google_calendar_id, summary, sync_token, last_full_sync_at, color)
- `calendar_events` (id, calendar_list_id, google_event_id, etag, status, start_at, end_at, all_day, tz, title, description, location, recurring_event_id, original_start, updated_at, local_dirty)
- `ai_transcripts` (id, user_id, prompt, tool_calls_json, outcome, created_at)
- `audit_log` (id, actor_user_id, action, entity, entity_id, before_json, after_json, at)

Store encrypted OAuth tokens (libsodium sealed box with a key in `.env` / systemd credential).

---

## 4. Key Technical Decisions (locked from Q&A + critique)

| Area | Decision |
|---|---|
| Backend | Fastify + Drizzle + better-sqlite3 (WAL mode, single writer) |
| Frontend | React + Vite + TS + Tailwind (one web app for kiosk + mobile, responsive + a kiosk layout mode) |
| Auth | Google OAuth (allowlist) + session cookie; network = Tailscale |
| Calendar | **Phase 1: read-only mirror**; Phase 2: write for non-recurring user-owned events; recurring/attendees deferred |
| AI provider | Abstraction in `packages/ai`. Adapters: Copilot SDK (if viable for this use), OpenAI, Anthropic. App must be fully functional with AI disabled. |
| Mobile | PWA (installable, offline-capable). Assume **no reliable iOS background** — server owns sync/reminders/retries. |
| Deployment | Docker Compose for services + native systemd for Electron |
| Backups | Litestream continuous replica to S3/B2 + nightly sqlite `.backup` snapshot + **rehearsed restore drill before "production"** |
| Storage | SD card today (see §4a for SD-specific mitigations + strongly recommended USB-SSD upgrade path) |

---

## 4a. Storage Plan (SD-card-aware)

Current hardware: Raspberry Pi 4 8GB with **SD card only, no SSD**. SD cards on a Pi that's doing constant SQLite writes + Chromium cache + logs are the single most common failure mode for home-server projects. We plan around that.

### Recommended hardware upgrade (strong)
- Add a **USB 3.0 SSD or high-quality USB flash drive** ($20–40) and mount it at `/mnt/data` for the DB, image cache, and Litestream WAL staging. This is the single highest-leverage purchase for reliability. Plan assumes this will eventually happen; everything below works on SD alone until then.

### Mitigations while on SD card
1. **Use a high-endurance SD card** (SanDisk High Endurance / Samsung PRO Endurance). These are rated for continuous-write workloads (security cameras, dashcams) and cost ~$15.
2. **Reduce write amplification:**
   - Mount `/var/log` and browser/Electron caches to **tmpfs** (RAM); 8 GB of RAM easily absorbs it.
   - Aggressive `logrotate` with short retention; disable verbose access logs by default.
   - SQLite `PRAGMA journal_mode=WAL`, `PRAGMA synchronous=NORMAL` (not FULL — acceptable given continuous replication).
   - Litestream snapshot interval tuned so the WAL doesn't churn the card excessively.
3. **Move heavy caches off the card** when possible:
   - Recipe images: SD is fine initially, but designed so the image directory is a single configurable path we can relocate to a USB drive without code changes.
   - Litestream replica is already off-device (S3/B2).
4. **Multiple backup layers** (cheap insurance):
   - Litestream continuous → S3/B2 (point-in-time restore).
   - Nightly `sqlite3 .backup` snapshot → S3 (separate file, trivial to restore).
   - Weekly full `dd` / image of the card stored off-device (optional, manual).
5. **Monitor card health:** expose SMART-ish metrics where possible; alert on I/O errors in `dmesg`; show a "disk health" tile on the kiosk admin view.
6. **Plan for the card dying.** Treat the Pi as disposable: document a one-command provisioning script (`scripts/provision-pi.sh`) that flashes a new card, installs Docker/Tailscale/systemd units, and restores the latest Litestream replica. The restore drill in Phase 10 explicitly tests this end-to-end.

### Net effect on the plan
- No code changes required from the hardware decision — paths are configurable.
- Adds a **provisioning script + restore drill** as first-class Phase 10 deliverables (already planned; now promoted).
- Adds **tmpfs mounts + logrotate + sqlite pragma tuning** to Phase 10 hardening checklist.

### Adding a USB-3.0 SSD later (straightforward, zero code changes)

**Short answer: yes, add it whenever you want.** The plan is explicitly designed to make this a 10-minute config change, not a rewrite. Start on SD, move to SSD when convenient.

**Where it's configured** — a single env var + a docker-compose volume path:

```
# .env  (at repo root, read by docker-compose and systemd)
HOME_OS_DATA_DIR=/mnt/data        # <- this is the only thing that changes
```

That dir holds:
```
/mnt/data/
├── db/home-os.sqlite          # SQLite file (WAL + shm alongside)
├── images/                    # recipe images, user uploads
├── litestream/                # local WAL staging for replication
└── backups/                   # nightly .backup snapshots before upload
```

In `docker-compose.yml` the `api` and `litestream` services bind to `${HOME_OS_DATA_DIR}`. In `packages/db` and `apps/api` the code reads `process.env.HOME_OS_DATA_DIR` (with a dev default of `./.data`). Nothing is hardcoded.

**Migration procedure (~10 minutes, one-time):**
1. Plug in the USB-3.0 SSD; `lsblk` to identify it; format ext4; add to `/etc/fstab` to mount at `/mnt/data` on boot.
2. `docker compose down` (stops the writer cleanly).
3. `rsync -aHAX /srv/home-os/data/ /mnt/data/` (or wherever the SD data dir lived).
4. Edit `.env`: set `HOME_OS_DATA_DIR=/mnt/data`.
5. `docker compose up -d`. Done.
6. Verify: `sqlite3 /mnt/data/db/home-os.sqlite 'PRAGMA integrity_check;'` and check `litestream replicate` logs.

**Safety net during the migration:** Litestream's S3 replica is still intact the entire time, and `scripts/provision-pi.sh --restore` can rebuild from it if anything goes sideways.

**Bonus when the SSD is in place:**
- Can relax some of the SD-specific mitigations (tmpfs for logs is still fine, but cache size limits can grow).
- Can consider `PRAGMA synchronous=FULL` for extra durability at negligible perf cost on SSD.

---

## 5. Revised Phase Plan

Sequencing revised per critique: schema evolves with features; calendar split into read → UI → write; AI comes late.

### Phase 0 — Foundation
- Monorepo scaffold (pnpm, TS project refs, ESLint, Prettier, Vitest).
- Shared `zod` schema infra; API client generator in `packages/shared`.
- `packages/db`: drizzle setup, WAL mode, migration runner, seed script.
- Local dev story: `pnpm dev` runs api + web with hot reload.
- CI (GitHub Actions): typecheck, lint, test, build for `linux/arm64` and `linux/amd64`.

### Phase 1 — Identity & Ownership
- Google OAuth login (2-email allowlist).
- Session cookies (HttpOnly, Secure, SameSite=Lax).
- User PIN for kiosk quick-switch.
- Ownership/scope enforcement middleware on every endpoint.
- Audit log skeleton.

### Phase 2 — Todos (first vertical slice end-to-end)
- CRUD API with scope (shared/user), due dates, completion.
- Web UI: list, add, complete, edit; mobile + kiosk layouts.
- Optimistic updates + offline queue on the PWA.
- Kiosk: large-touch targets, swipe-to-complete.
- Exercises: auth, scope enforcement, optimistic UI, PWA basics.

### Phase 3 — Recipes ✅
- **Pivoted to markdown-on-disk per user request**: recipe bodies stored at `<dataDir>/recipes/<id>.md`; DB row is a lightweight index (title, sourceUrl, author, siteName, domain, imagePath, importStatus).
- URL import via **defuddle + linkedom** (Node DOM) → clean markdown.
- `safeFetch` SSRF guard: blocks private IPv4/IPv6 + CGNAT + multicast, re-checks every redirect hop (`redirect: 'manual'`); size caps (2 MB HTML / 5 MB image), streamed overflow cancel.
- Local image cache with content-type allowlist + path-traversal guard; served via `/api/recipes/:id/image`.
- Partial imports auto-promote to `manual` on any metadata edit.
- Web UI: top-level Todos/Recipes nav, grid list, detail with `marked`-rendered markdown, edit form, and **step mode** for the kiosk (splits on headings + numbered list items, big Back/Next buttons).
- Migration `0002_organic_spencer_smythe.sql`. 9 new tests (parse + routes).

### Phase 4 — Meal Planning ✅
- `meal_plan_entries` table (date YYYY-MM-DD + slot enum + optional `recipeId` FK with `ON DELETE SET NULL` + optional free-text title for leftovers/takeout + notes). Index on (date, slot).
- REST: `GET /api/meal-plan?weekStart=…` (returns `{from,to,entries}`), `GET /api/meal-plan/tonight` for the kiosk home, plus `POST/PATCH/DELETE` on `/api/meal-plan/:id`.
- Web UI: new "Meals" tab with a 7-day × 4-slot grid, prev/this/next-week navigation, per-cell add button, modal editor to pick a recipe or enter free text, and a "Tonight: …" banner when today's dinner is planned.
- Validation: either `recipeId` or `title` required; strict YYYY-MM-DD date format. Free-text title is preserved if the recipe is later deleted.
- 9 new tests covering auth, windowing, validation, update/delete, and FK cascade-to-null.

### Phase 5 — Calendar (READ sync only)
- Google Calendar OAuth connect per user (incremental scopes).
- Incremental sync via `syncToken` (per user per calendar).
- Handle `410 Gone` → full resync; store `etag`, `updated`, `status`, `recurringEventId`, `originalStartTime`.
- Background poll worker in the API (node-cron/interval), adjustable interval.
- Timezone + DST handling (store UTC + original IANA zone).

### Phase 6 — Calendar UI
- Day / week / agenda views.
- Kiosk home: today + next-up.
- Per-user color, filtering, all-day lane.
- Combined view (both users overlaid) for shared planning.

### Phase 7 — Calendar WRITE (scoped)
- MVP write scope: **create/edit/delete non-recurring events on the user's primary calendar**.
- etag-based concurrency; conflict = user prompt, not silent LWW.
- Recurring events + attendee changes explicitly out of MVP (read-only mirror).
- `local_dirty` flag for pending pushes; retry worker.

### Phase 8 — Electron Kiosk shell
- Fullscreen, frameless, hide cursor.
- Autostart via systemd; auto-relaunch on crash.
- Screen-wake policy (touch wake; fall-back to `xset`/`wlr-randr` depending on Pi OS).
- Idle behavior to mitigate burn-in (dim/rotate widgets after N min).
- **Cleaning mode** (lock input for 30s).
- Crash recovery UI (if api is down, show diagnostic + offline cached data).
- No-keyboard auth-recovery flow (QR code to mobile to re-auth).

### Phase 9 — AI assistant
- `packages/ai`: stable interface `parseIntent(prompt, ctx) → ToolCall[]`.
- Tool/function schemas mirror REST endpoints (create_event, create_todo, plan_meals_week, import_recipe).
- **Confirm-before-execute** flow: preview actions, user taps confirm.
- Transcript log for debugging.
- Provider adapters (in priority order):
  1. Try GitHub Copilot SDK adapter (if/where policy allows it as an application AI provider).
  2. Direct OpenAI / Anthropic adapter (fallback).
  3. Optional local (Ollama on a beefier machine; Pi 4 cannot run useful LLMs).
- App fully works with AI disabled.

### Phase 10 — Deployment & Hardening
- `infra/docker`: multi-stage Dockerfiles; `linux/arm64` images built in CI.
- `docker-compose.yml`: `api`, `web` (static via Caddy), `caddy`, `litestream`. DB volume shared ONLY between `api` and `litestream`.
- Caddy with Tailscale TLS (tailnet hostname, MagicDNS).
- systemd units: `home-os-kiosk.service`, update hook, healthchecks.
- **SD-card hardening (per §4a):** tmpfs mounts for `/var/log` and Electron/Chromium caches; `logrotate`; SQLite pragmas (`journal_mode=WAL`, `synchronous=NORMAL`); configurable data dir so a USB-SSD upgrade is a path change, not a code change.
- **Backup layers:**
  - Litestream → S3/B2 (continuous).
  - Nightly `sqlite3 .backup` snapshot → S3 (separate object, easy point-restore).
- **`scripts/provision-pi.sh`**: idempotent one-command bootstrap that flashes/sets up a fresh Pi (Docker, Tailscale, systemd units) and restores the latest Litestream replica.
- **Restore drill**: rehearse full restore to a second Pi (or VM) from S3 before calling it "production". Repeat quarterly.
- Log rotation; Prometheus-style `/metrics` (optional); liveness/readiness.
- Migration safety: pre-migration snapshot; destructive migrations gated by manual approval flag.

### Phase 11 — Reminders & Notifications (post-MVP polish but called out)
- Server-owned reminder scheduler (cron + queue in SQLite).
- Push via Web Push for PWA (best-effort; iOS caveats documented).
- Kiosk toast/banner for active reminders.

---

## 6. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Bad migration corrupts household data | Pre-migration snapshot; restore drill; destructive-migration gate |
| Google sync edge cases (recurring, deletes, 410) | Scope MVP to non-recurring write; handle 410 with full resync; store etag/status/recurring fields up front |
| Copilot SDK not usable for this app class | Provider abstraction from day 1; app works without AI |
| SD card corruption / slow IO | High-endurance card; tmpfs for logs/caches; WAL+synchronous=NORMAL; Litestream + nightly snapshot; one-command reprovision script; USB-SSD upgrade path |
| Kiosk becomes unrecoverable | Auto-relaunch; QR-to-mobile reauth; cleaning mode; crash screen |
| iOS PWA limits break reminders | Server owns scheduling and retries |
| Multiple DB writers | Single API instance; Litestream is the only other process touching the DB file |
| TLS / OAuth callback URL drift | Lock tailnet hostname early; configure Google OAuth redirect to it |

---

## 7. Open Questions / Decide Later

- **Push vs pull for Google Calendar eventually?** Poll is fine for MVP; webhooks need public endpoint (Tailscale Funnel is possible but adds complexity).
- **Shared mobile PWA login on both spouses' phones** — each installs separately and signs in with their Google.
- **Recipe attribution & copyright** — import stores source URL; consider rendering a "source: …" link prominently.
- **Voice input on kiosk** — deferred; web Speech API is inconsistent on Chromium/Linux ARM.
- **Family member expansion** — schema supports N users; UI assumes 2 initially.

---

## 8. Definition of Done for MVP

- Both users can log in via Google from their phone (PWA) and the kitchen kiosk.
- Shared todos + per-user todos work end-to-end on kiosk and mobile.
- Recipes can be imported from at least 3 common sites; manually editable when import is imperfect.
- Meal plan week grid works; kiosk home shows tonight's meal.
- Both users' Google calendars are mirrored read-only; 2-way write works for non-recurring events on the primary calendar.
- AI assistant can handle at least: "create event", "add todo", "plan meals this week", "import recipe from URL" — with a confirm step.
- Kiosk autostarts on Pi boot, recovers from crashes, supports cleaning mode.
- Litestream replica verified via a full restore drill to a second device.
