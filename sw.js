/* 24点 PWA Service Worker */
const CACHE = 'cal24-v1';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/solver.js',
  './js/audio.js',
  './js/effects.js',
  './js/game.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((resp) => {
        // Cache new resources (same-origin only)
        if (resp.ok && new URL(e.request.url).origin === self.location.origin) {
          const clone = resp.clone();
          caches.open(CACHE).then((cache) => cache.put(e.request, clone));
        }
        return resp;
      }).catch(() => cached || new Response('Offline', { status: 503 }));
    })
  );
});
