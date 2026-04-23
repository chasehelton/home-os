// Preload script. Runs in the sandboxed renderer with contextIsolation
// enabled — the only bridge between Electron main and the web UI.
// Injects a top-level overlay for cleaning mode, offline banner, and
// idle dim so those concerns never leak into the web app itself.

import { contextBridge, ipcRenderer } from 'electron';

// Inlined from ./idle.ts because sandboxed preloads cannot `require()`
// sibling files. Bundling would be heavier than just inlining 20 lines
// of pure logic; the original ./idle.ts is still imported (and tested)
// by main.ts.
interface IdleState {
  lastActivityAt: number;
  dimmed: boolean;
}
function initialIdleState(now: number): IdleState {
  return { lastActivityAt: now, dimmed: false };
}
function onActivity(_state: IdleState, now: number): IdleState {
  return { lastActivityAt: now, dimmed: false };
}
function tickIdle(state: IdleState, now: number, thresholdMs: number): IdleState {
  const idleFor = now - state.lastActivityAt;
  const shouldDim = idleFor >= thresholdMs;
  if (shouldDim === state.dimmed) return state;
  return { ...state, dimmed: shouldDim };
}

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

function installTouchStyles(): void {
  // Defense in depth: even if the web bundle is stale (service worker
  // cache), make sure touch drags scroll instead of selecting text.
  const style = document.createElement('style');
  style.id = 'home-os-kiosk-touch-styles';
  style.textContent = `
/* touch-action does NOT inherit, so apply to every element so any scroll
   container the app picks (often a deep nested div) pans vertically
   instead of starting a text selection. */
* {
  touch-action: pan-y !important;
  -webkit-user-select: none !important;
  user-select: none !important;
  -webkit-touch-callout: none !important;
}
html, body, #root {
  -webkit-tap-highlight-color: transparent !important;
  overscroll-behavior: contain;
}
/* labwc/XWayland clips the last ~40px of a full-height window on this Pi.
   Reserve that margin at the bottom of the root content so the sidebar
   profile and any page footer content remain visible. */
#root {
  padding-bottom: 40px !important;
  box-sizing: border-box !important;
}
input, textarea, select,
[contenteditable='true'], [contenteditable=''],
.prose-home, .select-text, .select-text * {
  -webkit-user-select: text !important;
  user-select: text !important;
  touch-action: manipulation !important;
}
/* Fat scrollbars for finger-friendly dragging on the kiosk. */
::-webkit-scrollbar {
  width: 32px !important;
  height: 32px !important;
}
::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.08) !important;
  border-radius: 16px !important;
}
::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.45) !important;
  border: 6px solid transparent !important;
  background-clip: padding-box !important;
  border-radius: 16px !important;
  min-height: 80px !important;
}
::-webkit-scrollbar-thumb:hover,
::-webkit-scrollbar-thumb:active {
  background: rgba(0, 0, 0, 0.65) !important;
  background-clip: padding-box !important;
}
::-webkit-scrollbar-corner { background: transparent !important; }
`;
  document.head.appendChild(style);
}

function install(): void {
  installTouchStyles();
  installTouchScrollPolyfill();
  installOverlay();
  installScrollButtons();
  startIdleLoop();
  installOskTrigger();
}

// ---------------------------------------------------------------------------
// Floating scroll buttons.
//
// Electron 32 on labwc doesn't reliably deliver wl_touch (or X11 XInput2
// touch) events to the renderer on this Pi, so finger drags don't scroll.
// As a guaranteed-to-work fallback, we paint large up/down arrow buttons
// docked on the right edge that scroll the nearest scrollable ancestor
// (or the viewport) on press — with press-and-hold auto-repeat for fast
// travel through long pages.
// ---------------------------------------------------------------------------

function findScrollRoot(): Element | Window {
  // Look for a scrollable element in the main content area first so the
  // buttons scroll the inner list, not the sidebar. Fall back to the
  // viewport, which works when html/body overflow normally.
  const candidates = Array.from(document.querySelectorAll<HTMLElement>('main *, main'));
  for (const el of candidates) {
    const cs = getComputedStyle(el);
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
      return el;
    }
  }
  return window;
}

function scrollByAmount(delta: number, smooth = false): void {
  const target = findScrollRoot();
  if (target === window) {
    window.scrollBy({ top: delta, left: 0, behavior: smooth ? 'smooth' : 'auto' });
  } else {
    if (smooth && 'scrollBy' in (target as Element)) {
      (target as Element).scrollBy({ top: delta, left: 0, behavior: 'smooth' });
    } else {
      (target as Element).scrollTop += delta;
    }
  }
}

function makeScrollButton(label: string, delta: number, bottom: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-label', label === '▲' ? 'Scroll up' : 'Scroll down');
  btn.textContent = label;
  btn.style.cssText = [
    'position:fixed',
    'right:16px',
    `bottom:${bottom}`,
    'width:64px',
    'height:64px',
    'border-radius:9999px',
    'border:none',
    'background:rgba(15,23,42,0.82)',
    'color:#f8fafc',
    'font-size:28px',
    'line-height:1',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'cursor:pointer',
    'z-index:2147483646',
    'box-shadow:0 8px 24px rgba(0,0,0,0.35)',
    'user-select:none',
    '-webkit-user-select:none',
    'touch-action:manipulation',
    'pointer-events:auto',
  ].join(';');

  // Per-frame scroll for press-and-hold: tiny delta every animation
  // frame feels glidey rather than jerky. On tap, do one smooth scroll
  // of the full step (Chromium interpolates ~250ms).
  let rafId: number | null = null;
  let startTime = 0;
  const PER_FRAME_PX = delta > 0 ? 8 : -8;
  const HOLD_THRESHOLD_MS = 160;

  const frame = (): void => {
    scrollByAmount(PER_FRAME_PX, false);
    rafId = requestAnimationFrame(frame);
  };

  const start = (e: Event): void => {
    e.preventDefault();
    startTime = performance.now();
    // Do a small instant kick so the first frame isn't dead time, then
    // ramp into rAF loop. If the user releases quickly, we'll cancel
    // rAF and replace the in-progress jump with one smooth scroll of
    // the full delta (felt like a "tap to page").
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
  };
  const stop = (): void => {
    if (rafId === null) return;
    cancelAnimationFrame(rafId);
    rafId = null;
    const held = performance.now() - startTime;
    if (held < HOLD_THRESHOLD_MS) {
      // Treat as a discrete tap — replace the tiny per-frame motion
      // with a smooth scroll of the full step.
      scrollByAmount(delta, true);
    }
  };
  btn.addEventListener('pointerdown', start);
  btn.addEventListener('pointerup', stop);
  btn.addEventListener('pointercancel', stop);
  btn.addEventListener('pointerleave', stop);
  btn.addEventListener('touchstart', start, { passive: false });
  btn.addEventListener('touchend', stop);
  btn.addEventListener('touchcancel', stop);
  btn.addEventListener('click', (e) => e.preventDefault());
  return btn;
}

function installScrollButtons(): void {
  const wrap = document.createElement('div');
  wrap.id = 'home-os-kiosk-scroll-buttons';
  wrap.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646';
  wrap.appendChild(makeScrollButton('▲', -320, '144px'));
  wrap.appendChild(makeScrollButton('▼', 320, '64px'));
  document.body.appendChild(wrap);
}

// ---------------------------------------------------------------------------
// Touch-scroll polyfill.
//
// On Electron/Wayland with labwc, touchscreen events are delivered to
// Chromium but the gesture pipeline doesn't always synthesize scroll
// events from touch sequences (we see touchstart/touchmove fire fine,
// but the page never scrolls). Rather than fight Chromium, manually
// translate touchmove deltas into scrollBy calls on the nearest
// scrollable ancestor (or the viewport).
// ---------------------------------------------------------------------------

function findScrollableAncestor(start: Element | null): Element | Window {
  let el: Element | null = start;
  while (el && el !== document.body && el !== document.documentElement) {
    const cs = getComputedStyle(el);
    const ovy = cs.overflowY;
    if ((ovy === 'auto' || ovy === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
      return el;
    }
    el = el.parentElement;
  }
  // Fall back to the viewport — works when html/body are overflow:visible
  // and the document itself is taller than the window.
  return window;
}

function installTouchScrollPolyfill(): void {
  let lastY = 0;
  let activeTarget: Element | Window | null = null;
  let pointerId: number | null = null;
  let moved = false;

  window.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) {
        activeTarget = null;
        return;
      }
      const t = e.touches[0];
      if (!t) return;
      // Don't hijack scrolling for inputs / contenteditable so caret
      // placement still works.
      if (isEditable(t.target)) {
        activeTarget = null;
        return;
      }
      lastY = t.clientY;
      activeTarget = findScrollableAncestor(t.target as Element | null);
      moved = false;
    },
    { capture: true, passive: true },
  );

  window.addEventListener(
    'touchmove',
    (e) => {
      if (!activeTarget || e.touches.length !== 1) return;
      const t = e.touches[0];
      if (!t) return;
      const y = t.clientY;
      const dy = lastY - y;
      lastY = y;
      if (dy === 0) return;
      moved = true;
      if (activeTarget === window) {
        window.scrollBy(0, dy);
      } else {
        (activeTarget as Element).scrollTop += dy;
      }
    },
    { capture: true, passive: true },
  );

  window.addEventListener(
    'touchend',
    () => {
      activeTarget = null;
    },
    { capture: true, passive: true },
  );

  // Pointer-events fallback for environments where Chromium converts
  // touch into pointer events with pointerType==='touch' but does not
  // emit touch events at all.
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType !== 'touch') return;
      if (isEditable(e.target)) {
        pointerId = null;
        return;
      }
      pointerId = e.pointerId;
      lastY = e.clientY;
      activeTarget = findScrollableAncestor(e.target as Element | null);
      moved = false;
    },
    { capture: true, passive: true },
  );

  window.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'touch' || pointerId !== e.pointerId || !activeTarget) return;
      const dy = lastY - e.clientY;
      lastY = e.clientY;
      if (dy === 0) return;
      moved = true;
      if (activeTarget === window) {
        window.scrollBy(0, dy);
      } else {
        (activeTarget as Element).scrollTop += dy;
      }
    },
    { capture: true, passive: true },
  );

  window.addEventListener(
    'pointerup',
    () => {
      pointerId = null;
      activeTarget = null;
      void moved; // reserved for future click suppression after a drag
    },
    { capture: true, passive: true },
  );
}

// ---------------------------------------------------------------------------
// On-screen keyboard trigger.
//
// The Pi kiosk runs wvkbd as a separate systemd unit that starts hidden.
// We show it only when an editable element takes focus, and hide it
// again on blur. wvkbd listens for SIGUSR1/SIGUSR2 to toggle visibility;
// the main process handles that (see ipcMain handlers in main.ts).
// ---------------------------------------------------------------------------

const EDITABLE_INPUT_TYPES = new Set([
  'text',
  'search',
  'url',
  'email',
  'tel',
  'password',
  'number',
  'date',
  'datetime-local',
  'month',
  'time',
  'week',
  // Omitted: 'submit' | 'button' | 'checkbox' | 'radio' | 'file' | 'hidden' | ...
]);

function isEditable(el: EventTarget | null): boolean {
  if (!el || !(el instanceof Element)) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    return EDITABLE_INPUT_TYPES.has(type);
  }
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return false;
}

let oskVisible = false;
function setOskVisible(visible: boolean): void {
  if (visible === oskVisible) return;
  oskVisible = visible;
  ipcRenderer.send(visible ? 'kiosk:osk-show' : 'kiosk:osk-hide');
}

function installOskTrigger(): void {
  console.log('[kiosk-preload] installing OSK focus listeners');
  window.addEventListener(
    'focusin',
    (e) => {
      const ed = isEditable(e.target);
      console.log('[kiosk-preload] focusin', (e.target as Element | null)?.tagName, 'editable=', ed);
      if (ed) {
        setOskVisible(true);
        // Ensure the focused field isn't hidden behind the keyboard.
        // wvkbd paints the bottom ~320px; scrollIntoView('center')
        // handles both shallow scroll containers and the document.
        if (e.target instanceof HTMLElement) {
          queueMicrotask(() =>
            (e.target as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' }),
          );
        }
      }
    },
    { capture: true },
  );
  window.addEventListener(
    'focusout',
    (e) => {
      if (!isEditable(e.target)) return;
      // focusout fires before the next focusin; defer the hide so
      // moving between two fields doesn't make the keyboard flash.
      setTimeout(() => {
        if (!isEditable(document.activeElement)) setOskVisible(false);
      }, 100);
    },
    { capture: true },
  );
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
