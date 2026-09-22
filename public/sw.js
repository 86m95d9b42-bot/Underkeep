/**
 * Service worker: the game must run in airplane mode once installed.
 *
 * The release is a single index.html with the JS, CSS, and fonts already
 * inlined, so there is very little to cache: the page, the manifest, and the
 * icons. Everything is precached on install and served cache-first; navigations
 * always resolve to the cached page.
 *
 * VERSION is stamped by tools/build.js, so a new build replaces the old cache.
 */
const VERSION = '__UK_VERSION__';
const CACHE = `underkeep-${VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // A navigation always gets the app shell, online or off.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((hit) => hit ?? fetch(request)),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          // Cache same-origin successes so a later offline run has them.
          if (response.ok && new URL(request.url).origin === self.location.origin) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
