// Preload script. Runs in the sandboxed renderer with contextIsolation
// enabled — the only bridge between Electron main and the web UI.
// Injects a top-level overlay for cleaning mode, offline banner, and
// idle dim so those concerns never leak into the web app itself.

import { contextBridge, ipcRenderer } from 'electron';
import { initialIdleState, onActivity, tickIdle, type IdleState } from './idle.js';

interface KioskConfigBridge {
  idleMs: number;
  cleaningMs: number;
  kioskMode: boolean;
  diagnosticsUrl: string;
}

let overlayRoot: HTMLDivElement | null = null;
let cleaningLayer: HTMLDivElement | null = null;
let cleaningCountdown: HTMLSpanElement | null = null;
let offlineBanner: HTMLDivElement | null = null;
let dimLayer: HTMLDivElement | null = null;
let idleState: IdleState = initialIdleState(Date.now());
let idleThresholdMs = 5 * 60_000;
let idleTimer: ReturnType<typeof setInterval> | null = null;
let cleaningEndsAt = 0;
let cleaningTicker: ReturnType<typeof setInterval> | null = null;

function installOverlay(): void {
  overlayRoot = document.createElement('div');
  overlayRoot.id = 'home-os-kiosk-overlay';
  overlayRoot.style.cssText = [
    'position:fixed',
    'inset:0',
    'pointer-events:none',
    'z-index:2147483647',
    'font-family:system-ui,sans-serif',
  ].join(';');

  dimLayer = document.createElement('div');
  dimLayer.style.cssText = [
    'position:absolute',
    'inset:0',
    'background:#000',
    'opacity:0',
    'transition:opacity 600ms ease',
    'pointer-events:none',
  ].join(';');
  overlayRoot.appendChild(dimLayer);

  offlineBanner = document.createElement('div');
  offlineBanner.textContent = 'Server unreachable';
  offlineBanner.style.cssText = [
    'position:absolute',
    'top:0',
    'left:0',
    'right:0',
    'padding:6px 12px',
    'background:#b91c1c',
    'color:white',
    'font-size:12px',
    'text-align:center',
    'display:none',
    'pointer-events:none',
  ].join(';');
  overlayRoot.appendChild(offlineBanner);

  cleaningLayer = document.createElement('div');
  cleaningLayer.style.cssText = [
    'position:absolute',
    'inset:0',
    'background:rgba(15,23,42,0.94)',
    'color:white',
    'display:none',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'gap:12px',
    'pointer-events:auto', // swallow touches during cleaning
    'font-size:28px',
    'font-weight:600',
  ].join(';');
  const cleaningTitle = document.createElement('div');
  cleaningTitle.textContent = '🧽  Cleaning mode';
  cleaningLayer.appendChild(cleaningTitle);
  const cleaningSub = document.createElement('div');
  cleaningSub.style.cssText = 'font-size:16px;font-weight:400;opacity:0.8';
  cleaningSub.textContent = 'Input disabled while you wipe the screen.';
  cleaningLayer.appendChild(cleaningSub);
  cleaningCountdown = document.createElement('span');
  cleaningCountdown.style.cssText = 'font-size:48px;font-variant-numeric:tabular-nums';
  cleaningLayer.appendChild(cleaningCountdown);
  // Swallow all input while cleaning — clicking/tapping does nothing.
  for (const ev of ['click', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'keydown']) {
    cleaningLayer.addEventListener(ev, (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
    });
  }
  overlayRoot.appendChild(cleaningLayer);

  document.body.appendChild(overlayRoot);
}

function setDim(dimmed: boolean): void {
  if (!dimLayer) return;
  dimLayer.style.opacity = dimmed ? '0.75' : '0';
}

function setOffline(offline: boolean): void {
  if (!offlineBanner) return;
  offlineBanner.style.display = offline ? 'block' : 'none';
}

function setCleaning(active: boolean, endsAt: number): void {
  if (!cleaningLayer) return;
  cleaningEndsAt = endsAt;
  cleaningLayer.style.display = active ? 'flex' : 'none';
  if (cleaningTicker) {
    clearInterval(cleaningTicker);
    cleaningTicker = null;
  }
  if (active) {
    updateCleaningCountdown();
    cleaningTicker = setInterval(updateCleaningCountdown, 250);
  }
}

function updateCleaningCountdown(): void {
  if (!cleaningCountdown) return;
  const remaining = Math.max(0, cleaningEndsAt - Date.now());
  cleaningCountdown.textContent = `${Math.ceil(remaining / 1000)}s`;
}

function handleActivity(): void {
  idleState = onActivity(idleState, Date.now());
  setDim(false);
}

function startIdleLoop(): void {
  if (idleTimer) clearInterval(idleTimer);
  idleTimer = setInterval(() => {
    idleState = tickIdle(idleState, Date.now(), idleThresholdMs);
    setDim(idleState.dimmed);
  }, 5_000);
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'touchstart']) {
    window.addEventListener(ev, handleActivity, { passive: true, capture: true });
  }
}

function install(): void {
  installOverlay();
  startIdleLoop();
}

async function boot(): Promise<void> {
  if (document.readyState === 'loading') {
    await new Promise<void>((resolve) =>
      document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }),
    );
  }
  const cfg = (await ipcRenderer.invoke('kiosk:config')) as KioskConfigBridge;
  idleThresholdMs = cfg.idleMs;
  install();
  ipcRenderer.on('kiosk:health', (_e, payload: { offline: boolean }) => {
    setOffline(payload.offline);
  });
  ipcRenderer.on('kiosk:cleaning', (_e, payload: { active: boolean; endsAt: number }) => {
    setCleaning(payload.active, payload.endsAt);
  });
}

void boot();

// Minimal API exposed to the web UI. Keeps surface tiny & type-safe.
contextBridge.exposeInMainWorld('homeOsKiosk', {
  startCleaning: () => ipcRenderer.invoke('kiosk:startCleaning'),
});
