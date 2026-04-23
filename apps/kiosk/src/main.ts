// Electron main process. Loads the home-os web UI in a fullscreen kiosk
// BrowserWindow, watches api health, supports cleaning mode + idle dim,
// and shows an offline diagnostics screen on load failure.

import { app, BrowserWindow, globalShortcut, ipcMain, screen, net, session } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { loadConfig, type KioskConfig } from './config.js';
import { initialHealthState, onHealthResult, type HealthState } from './health.js';

const cfg: KioskConfig = loadConfig();

// Google (and a handful of other sign-in providers) silently block OAuth
// when they detect "Electron/x.y.z" in the User-Agent. Spoofing a plain
// Chrome UA avoids this — Electron 32 is Chromium 128 under the hood, so
// this UA is truthful about the rendering engine.
app.userAgentFallback =
  'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

// Chromium flags for touchscreen kiosks: force touch-event dispatch, disable
// pinch-zoom (triggered accidentally by two-finger UI taps), and kill the
// overscroll-based history-back gesture so a drag never navigates away.
app.commandLine.appendSwitch('touch-events', 'enabled');
app.commandLine.appendSwitch('disable-pinch');
app.commandLine.appendSwitch('overscroll-history-navigation', '0');

// ---------------------------------------------------------------------------
// BrowserWindow options — Electron security hardening: no nodeIntegration,
// contextIsolation on, sandboxed preload. Preload is the only bridge.
// ---------------------------------------------------------------------------

function buildWindowOptions(): Electron.BrowserWindowConstructorOptions {
  const primary = screen.getPrimaryDisplay();
  // On Wayland, Electron's workAreaSize does not account for layer-shell
  // exclusive zones (like the on-screen keyboard at the bottom of the
  // screen), so we subtract its height manually. Configurable via
  // HOME_OS_KIOSK_OSK_HEIGHT; set to 0 if no OSK is running.
  const oskHeight = cfg.oskHeight;
  return {
    width: primary.bounds.width,
    height: Math.max(primary.bounds.height - oskHeight, 200),
    x: primary.bounds.x,
    y: primary.bounds.y,
    // IMPORTANT: do NOT use Wayland fullscreen/kiosk. A Wayland fullscreen
    // toplevel is stacked above the `top` layer-shell layer, which
    // occludes on-screen keyboards (squeekboard, wvkbd) that live there.
    // A frameless screen-sized window looks identical and cooperates with
    // the OSK. We still enforce kiosk semantics via will-navigate +
    // window-open handlers and a hidden cursor (below).
    fullscreen: false,
    kiosk: false,
    frame: !cfg.kioskMode,
    resizable: false,
    movable: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  };
}

let mainWindow: BrowserWindow | null = null;
let health: HealthState = initialHealthState({
  baseIntervalMs: cfg.healthIntervalMs,
  failureThreshold: cfg.healthFailureThreshold,
});
let healthTimer: NodeJS.Timeout | null = null;
let cleaningTimeout: NodeJS.Timeout | null = null;
let loadFailures = 0;
const MAX_LOAD_FAILURES = 5;

function createWindow(): void {
  const win = new BrowserWindow(buildWindowOptions());
  mainWindow = win;

  // Hide mouse cursor in kiosk mode — pure CSS injected after load.
  win.webContents.on('did-finish-load', () => {
    loadFailures = 0;
    if (cfg.kioskMode) {
      void win.webContents.insertCSS('*, *:hover { cursor: none !important; }');
    }
  });

  // Harden: deny opening new windows — kiosk never needs popups.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Prevent navigation away from the configured origin.
  const allowedOrigin = safeOrigin(cfg.url);
  win.webContents.on('will-navigate', (event, url) => {
    if (allowedOrigin && safeOrigin(url) !== allowedOrigin) {
      event.preventDefault();
    }
  });

  // Retry loadURL with exponential backoff on failure; after MAX_LOAD_FAILURES
  // show the offline diagnostics page so the user can scan a QR for help.
  win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, url) => {
    if (url !== cfg.url) return;
    loadFailures += 1;
    if (loadFailures >= MAX_LOAD_FAILURES) {
      void loadDiagnostics(win, errorCode, errorDescription);
      return;
    }
    const delay = Math.min(1000 * 2 ** (loadFailures - 1), 30_000);
    setTimeout(() => {
      void loadWithKioskLogin(win);
    }, delay);
  });

  // Auto-relaunch on renderer crash.
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return;
    void loadWithKioskLogin(win);
  });

  void loadWithKioskLogin(win);
}

// ---------------------------------------------------------------------------
// Kiosk device login — bearer-token handshake against POST /auth/kiosk.
//
// Google blocks OAuth inside Electron, so the kiosk authenticates via a
// long-lived secret provisioned on the Pi (HOME_OS_KIOSK_TOKEN). The
// resulting Set-Cookie lands in the default session's cookie jar, which
// the BrowserWindow shares, so subsequent navigation to cfg.url is logged
// in. The API must be same-origin with cfg.url so the cookie applies.
// ---------------------------------------------------------------------------

async function loadWithKioskLogin(win: BrowserWindow): Promise<void> {
  if (cfg.kioskToken) {
    try {
      await kioskLogin(cfg.url, cfg.kioskToken);
    } catch (err) {
      console.warn(
        '[kiosk] /auth/kiosk login failed; loading URL anyway (app will show login screen):',
        err,
      );
    }
  }
  await win.loadURL(cfg.url);
}

function kioskLogin(appUrl: string, token: string): Promise<void> {
  const origin = new URL(appUrl).origin;
  const endpoint = `${origin}/auth/kiosk`;
  return new Promise((resolve, reject) => {
    const req = net.request({
      method: 'POST',
      url: endpoint,
      // Use the default session so any Set-Cookie lands in the same jar
      // that the BrowserWindow uses when it navigates to cfg.url.
      session: session.defaultSession,
      useSessionCookies: true,
    });
    req.setHeader('Authorization', `Bearer ${token}`);
    req.on('response', (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk.toString('utf8');
      });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`/auth/kiosk ${res.statusCode}: ${body.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function loadDiagnostics(
  win: BrowserWindow,
  errorCode: number,
  errorDescription: string,
): Promise<void> {
  const file = path.join(__dirname, 'crash.html');
  const params = new URLSearchParams({
    code: String(errorCode),
    msg: errorDescription,
    qr: cfg.diagnosticsUrl,
    url: cfg.url,
  });
  try {
    await win.loadFile(file, { search: `?${params.toString()}` });
  } catch {
    // If even the diagnostics file fails to load, there is nothing sane
    // left to do — rely on systemd to restart the process.
  }
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Health watcher — periodically pings /health/live and broadcasts state to
// the renderer via IPC. The web UI ignores the signal; the preload overlay
// uses it to show an "Offline" banner.
// ---------------------------------------------------------------------------

async function pingHealth(): Promise<boolean> {
  try {
    const res = await fetch(cfg.healthUrl, {
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function startHealthLoop(): void {
  const step = async (): Promise<void> => {
    const ok = await pingHealth();
    health = onHealthResult(health, ok, {
      baseIntervalMs: cfg.healthIntervalMs,
      failureThreshold: cfg.healthFailureThreshold,
    });
    broadcast('kiosk:health', { offline: health.offline });
    healthTimer = setTimeout(step, health.nextDelayMs);
  };
  void step();
}

// ---------------------------------------------------------------------------
// IPC bridge
// ---------------------------------------------------------------------------

function broadcast(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function startCleaning(): void {
  if (cleaningTimeout) clearTimeout(cleaningTimeout);
  const endsAt = Date.now() + cfg.cleaningMs;
  broadcast('kiosk:cleaning', { active: true, endsAt });
  cleaningTimeout = setTimeout(() => {
    cleaningTimeout = null;
    broadcast('kiosk:cleaning', { active: false, endsAt: 0 });
  }, cfg.cleaningMs);
}

ipcMain.handle('kiosk:startCleaning', () => {
  startCleaning();
  return { active: true, endsAt: Date.now() + cfg.cleaningMs };
});

ipcMain.handle('kiosk:config', () => ({
  idleMs: cfg.idleMs,
  cleaningMs: cfg.cleaningMs,
  kioskMode: cfg.kioskMode,
  diagnosticsUrl: cfg.diagnosticsUrl,
}));

// ---------------------------------------------------------------------------
// On-screen keyboard bridge.
//
// The wvkbd process runs as its own systemd unit started with --hidden.
// It listens for SIGUSR2 (show) and SIGUSR1 (hide). Renderer preload
// sends these IPC events on focusin/focusout of editable elements.
// PID is discovered lazily and re-resolved if the signal fails (e.g.
// after wvkbd was restarted by its systemd unit).
// ---------------------------------------------------------------------------

const OSK_COMM = 'wvkbd-mobintl';
let oskPidCache: number | null = null;

function findOskPid(): number | null {
  try {
    for (const dir of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(dir)) continue;
      let comm: string;
      try {
        comm = fs.readFileSync(`/proc/${dir}/comm`, 'utf8').trim();
      } catch {
        continue;
      }
      if (comm === OSK_COMM) return Number(dir);
    }
  } catch {
    // /proc may not exist on non-linux — caller logs.
  }
  return null;
}

function signalOsk(signal: 'SIGUSR1' | 'SIGUSR2'): void {
  const trySignal = (): boolean => {
    if (oskPidCache == null) return false;
    try {
      process.kill(oskPidCache, signal);
      return true;
    } catch {
      oskPidCache = null;
      return false;
    }
  };
  if (trySignal()) return;
  oskPidCache = findOskPid();
  if (oskPidCache != null) trySignal();
}

ipcMain.on('kiosk:osk-show', () => signalOsk('SIGUSR2'));
ipcMain.on('kiosk:osk-hide', () => signalOsk('SIGUSR1'));

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  createWindow();
  startHealthLoop();

  // Keyboard shortcut to toggle cleaning mode — Ctrl+Shift+C works on a
  // USB keyboard when the cleaning person doesn't want to tap the screen.
  globalShortcut.register('CommandOrControl+Shift+C', () => startCleaning());
  // Escape hatch for the developer: Ctrl+Shift+Q quits in kiosk mode.
  globalShortcut.register('CommandOrControl+Shift+Q', () => app.quit());
});

app.on('window-all-closed', () => {
  // Pi kiosk: never exit on window close — the systemd unit would restart
  // us anyway. During dev on macOS allow quit so Cmd+Q works.
  if (process.platform === 'darwin' || !cfg.kioskMode) app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (healthTimer) clearTimeout(healthTimer);
  if (cleaningTimeout) clearTimeout(cleaningTimeout);
});
