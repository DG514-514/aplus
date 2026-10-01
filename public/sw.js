/* A+ Cleaning Solutions service worker: fast loading, offline fallback and push notifications. */
'use strict';

const VERSION = 'v3';
const STATIC_CACHE = `aplus-static-${VERSION}`;
const PAGE_CACHE = `aplus-pages-${VERSION}`;
const PRECACHE = [
  '/offline.html',
  '/css/site.css',
  '/css/portal.css',
  '/css/admin.css',
  '/css/terms.css',
  '/js/main.js',
  '/js/portal.js',
  '/js/admin.js',
  '/js/login.js',
  '/js/app.js',
  '/img/logo.png',
  '/img/icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![STATIC_CACHE, PAGE_CACHE].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Never cache account data or payments — always go to the server.
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    // Pages: always try the network first so content is fresh; fall back offline.
    // /app redirects to the portal or the homepage, so it's never cached itself.
    if (url.pathname === '/app') {
      event.respondWith(fetch(request).catch(async () => (await caches.match('/')) || caches.match('/offline.html')));
      return;
    }
    const isPrivate = url.pathname.startsWith('/portal') || url.pathname.startsWith('/admin');
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (!isPrivate && response.ok) {
            const copy = response.clone();
            caches.open(PAGE_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => (!isPrivate && (await caches.match(request))) || caches.match('/offline.html')),
    );
    return;
  }

  // Styles and scripts: network first so updates show up right away; cached copy when offline.
  if (/\.(css|js)$/.test(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  // Images and fonts: serve instantly from cache, refresh in the background.
  if (/\.(png|jpg|jpeg|webp|svg|woff2?)$/.test(url.pathname)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request).then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        }).catch(() => cached);
        return cached || network;
      }),
    );
  }
});

/* ---------- Push notifications ---------- */

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'A+ Cleaning Solutions';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: data.icon || '/icons/client-192.png',
    badge: '/icons/client-192.png',
    tag: data.tag,
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((w) => w.url.startsWith(target));
      if (existing) return existing.focus();
      return self.clients.openWindow(target);
    }),
  );
});
