/* 24点 PWA Service Worker */
// 版本号: 每次部署递增 (配合 index.html 中资源的 ?v= 缓存破坏, 保证新 HTML 拉到新 JS/CSS)
const CACHE = 'cal24-v4';
const SHELL = [
  './',
  './index.html',
  './css/style.css?v=4',
  './js/solver.js?v=4',
  './js/audio.js?v=4',
  './js/effects.js?v=4',
  './js/game.js?v=4',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
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
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // 页面/HTML: network-first — 每次打开都拿最新版本, 离线时才用缓存
  if (e.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request)
        .then((resp) => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE).then((cache) => cache.put(e.request, clone));
          }
          return resp;
        })
        .catch(() => caches.match(e.request).then((c) => c || new Response('Offline', { status: 503 })))
    );
    return;
  }

  // 静态资源: stale-while-revalidate — 先返回缓存, 后台拉新更新缓存
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const network = fetch(e.request)
        .then((resp) => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE).then((cache) => cache.put(e.request, clone));
          }
          return resp;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
