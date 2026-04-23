import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.tsx';
import './index.css';

// Escape hatch: `?reset-sw=1` unregisters all service workers and clears
// every Cache Storage entry, then reloads at the clean URL. Recoverable
// path for kiosks / phones when a broken SW hangs the app.
async function maybeResetServiceWorker(): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  if (params.get('reset-sw') !== '1') return false;
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // best-effort; fall through to reload regardless.
  }
  const clean = new URL(window.location.href);
  clean.searchParams.delete('reset-sw');
  window.location.replace(clean.toString());
  return true;
}

void maybeResetServiceWorker().then((reloading) => {
  if (reloading) return;
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
