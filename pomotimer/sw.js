/* AMS PomoTimer — service worker (offline cache)
   Paths are relative to this file so the app works from any folder or repo. */

const CACHE_NAME = 'ams-pomotimer-v2';

const urlsToCache = [
    './',
    './index.html',
    './manifest.json',
    './css/style.css',
    './js/store.js',
    './js/timer.js',
    './js/app.js',
    './icons/icon.svg',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon-512-maskable.png',
    './icons/apple-touch-icon.png',
    './icons/favicon-64.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) =>
            Promise.all(urlsToCache.map((url) => cache.add(url).catch((e) => console.warn('Cache skip', url, e))))
        )
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((names) =>
            Promise.all(names.filter((n) => n.startsWith('ams-pomotimer-') && n !== CACHE_NAME).map((n) => caches.delete(n)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;

    // Cache first, then network; refresh the cache in the background so the
    // next launch picks up a new deploy without a hard refresh.
    event.respondWith(
        caches.match(event.request).then((cached) => {
            const network = fetch(event.request).then((response) => {
                if (response && response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                }
                return response;
            }).catch(() => cached || caches.match('./index.html'));
            return cached || network;
        })
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Tapping a notification brings the app back to the front.
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
            const client = clients.find((c) => 'focus' in c);
            if (client) return client.focus();
            return self.clients.openWindow('./');
        })
    );
});
