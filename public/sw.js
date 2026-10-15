// sw.js — service worker PWA «Братство Электриков»
// Кеширует оболочку приложения; API (кросс-домен script.google.com) пропускает насквозь.
const CACHE = 'bratstvo-v2';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/core/util.js',
  './js/core/store.js',
  './js/core/offline.js',
  './js/core/api.js',
  './js/core/router.js',
  './js/features/auth.js',
  './js/features/objects.js',
  './js/features/objectCard.js',
  './js/features/admin.js',
  './js/features/cabinet.js',
  './js/app.js',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(SHELL).catch(function () { return Promise.resolve(); });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  const url = new URL(e.request.url);
  // Только собственные GET-ресурсы кешируем; всё остальное — в сеть.
  if (e.request.method === 'GET' && url.origin === self.location.origin) {
    e.respondWith(
      caches.match(e.request).then(function (cached) {
        if (cached) return cached;
        return fetch(e.request).then(function (resp) {
          if (resp && resp.ok && resp.type === 'basic') {
            const copy = resp.clone();
            caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
          }
          return resp;
        }).catch(function () {
          // офлайн и нет в кеше — для навигации отдадим кешированный index
          if (e.request.mode === 'navigate') return caches.match('./index.html');
          return new Response('', { status: 504 });
        });
      })
    );
  }
  // API-запросы (POST к script.google.com и др.) — без кеша, уходим в сеть.
});
