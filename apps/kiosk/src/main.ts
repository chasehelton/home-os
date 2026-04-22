// Electron main process. Loads the home-os web UI in a fullscreen kiosk
// BrowserWindow, watches api health, supports cleaning mode + idle dim,
// and shows an offline diagnostics screen on load failure.

import { app, BrowserWindow, globalShortcut, ipcMain, screen } from 'electron';
import * as path from 'node:path';
import { loadConfig, type KioskConfig } from './config.js';
import {
  initialHealthState,
  onHealthResult,
  type HealthState,
} from './health.js';

const cfg: KioskConfig = loadConfig();

// ---------------------------------------------------------------------------
// BrowserWindow options — Electron security hardening: no nodeIntegration,
// contextIsolation on, sandboxed preload. Preload is the only bridge.
// ---------------------------------------------------------------------------

function buildWindowOptions(): Electron.BrowserWindowConstructorOptions {
  const primary = screen.getPrimaryDisplay();
  return {
    width: primary.workAreaSize.width,
    height: primary.workAreaSize.height,
    fullscreen: cfg.kioskMode,
    kiosk: cfg.kioskMode,
    frame: !cfg.kioskMode,
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
      void win.loadURL(cfg.url);
    }, delay);
  });

  // Auto-relaunch on renderer crash.
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return;
    void win.loadURL(cfg.url);
  });

  void win.loadURL(cfg.url);
}

async function loadDiagnostics(
  win: BrowserWindow,
  errorCode: number,
  errorDescription: string
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
