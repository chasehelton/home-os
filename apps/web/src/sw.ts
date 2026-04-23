/// <reference lib="webworker" />
/// <reference types="vite-plugin-pwa/client" />

import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope;

// Precache hashed static assets (JS/CSS/images). index.html is intentionally
// excluded in vite.config.ts — see the NetworkFirst navigation handler below.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Navigations (HTML document loads) use NetworkFirst with a short timeout so
// a freshly deployed build is picked up on the next load, and we only fall
// back to cache when the network is unreachable (offline kiosk scenario).
registerRoute(
  new NavigationRoute(
    new NetworkFirst({
      cacheName: 'home-os-navigations',
      networkTimeoutSeconds: 3,
    }),
  ),
);

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

interface ReminderPushPayload {
  id: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
}

// Web Push handler for fired reminders. The payload shape is owned by
// apps/api/src/reminders/worker.ts (PushPayload).
self.addEventListener('push', (event) => {
  event.waitUntil(handlePush(event));
});

async function handlePush(event: PushEvent): Promise<void> {
  let data: ReminderPushPayload | null = null;
  try {
    data = event.data ? (event.data.json() as ReminderPushPayload) : null;
  } catch {
    data = null;
  }
  const title = data?.title ?? 'Reminder';
  const body = data?.body ?? undefined;
  const tag = data?.id ?? 'home-os-reminder';
  await self.registration.showNotification(title, {
    body,
    tag,
    data: data ?? {},
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(focusOrOpen('/?tab=reminders'));
});

async function focusOrOpen(targetPath: string): Promise<void> {
  const origin = self.location.origin;
  const target = origin + targetPath;
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of clients) {
    if (c.url.startsWith(origin)) {
      await c.focus();
      try {
        await c.navigate(target);
      } catch {
        // some browsers disallow cross-scope navigate; ignore.
      }
      return;
    }
  }
  await self.clients.openWindow(target);
}
