# @home-os/kiosk

Electron shell that runs the home-os web UI fullscreen on a Raspberry Pi
(or a dev laptop). Loads `HOME_OS_KIOSK_URL` in a kiosk-mode BrowserWindow
with contextIsolation + sandboxed preload, a health watcher, idle-dim
overlay, cleaning mode, and a self-contained offline diagnostics page.

## Dev

```bash
# Terminal 1 — run api + web
pnpm dev

# Terminal 2 — run the kiosk against those local services
pnpm dev:kiosk
```

`pnpm dev:kiosk` builds `dist/` then launches Electron. The default URL is
`http://localhost:5173`; the health probe targets `http://localhost:3001/health/live`.

## Config

All via environment variables. Defaults in parentheses.

| Var | Purpose |
|---|---|
| `HOME_OS_KIOSK_URL` (`http://localhost:5173`) | Web app URL the kiosk loads. |
| `HOME_OS_KIOSK_HEALTH_URL` (auto) | `/health/live` target for the watcher. |
| `HOME_OS_KIOSK_DIAGNOSTICS_URL` (= URL) | URL encoded into the crash-screen QR. Set to the tailnet hostname on the Pi so a phone on the same tailnet can load it. |
| `HOME_OS_KIOSK_MODE` (`1`) | `0` disables fullscreen/kiosk (handy for dev). |
| `HOME_OS_KIOSK_IDLE_MS` (300000) | Idle time before dim. |
| `HOME_OS_KIOSK_CLEANING_MS` (30000) | Length of cleaning-mode input lock. |
| `HOME_OS_KIOSK_HEALTH_INTERVAL_MS` (15000) | Base poll interval. |
| `HOME_OS_KIOSK_HEALTH_FAILURES` (2) | Consecutive failures before "offline" banner. |

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+C` | Start cleaning mode (30s input lock). |
| `Ctrl+Shift+Q` | Quit (dev escape hatch). |

## Crash / offline screen

If Electron fails to load the configured URL 5× with exponential backoff,
it falls back to `dist/crash.html` — a self-contained page that renders a
QR to `HOME_OS_KIOSK_DIAGNOSTICS_URL` (so you can scan from a phone) and
offers a retry button. The QR is rendered by a vendored copy of
`qrcode-generator` (copied at build time) so the page works with zero
network.

## Deployment (Phase 10)

`infra/systemd/home-os-kiosk.service` is an **example** systemd unit — it
will need adjustment for the chosen Pi OS (X11 vs Wayland, user service
vs system service). Real provisioning lands in Phase 10.

## Architecture

Pure logic is extracted into `src/{config,idle,health}.ts` so it can be
unit-tested under vitest. Electron-specific code (`main.ts`, `preload.ts`)
is not tested — it is deliberately thin and manual-tested.
