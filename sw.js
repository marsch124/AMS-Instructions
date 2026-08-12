const CACHE_NAME = 'ams-instructions-v9';
const APP_VERSION = '9.0';

const urlsToCache = [
    '/AMS-Instructions/',
    '/AMS-Instructions/index.html',
    '/AMS-Instructions/css/style.css',
    '/AMS-Instructions/js/app.js',
    '/AMS-Instructions/js/db.js',
    '/AMS-Instructions/js/qr.js',
    '/AMS-Instructions/js/ui.js',
    '/AMS-Instructions/manifest.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(urlsToCache).catch((error) => {
                console.error('Cache addAll error:', error);
                // Continue even if some resources fail to cache
                return cache.addAll(urlsToCache.filter((url) => {
                    return url !== '/AMS-Instructions/';
                }));
            });
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            console.log('🔄 [SW Activate] Current cache:', CACHE_NAME, 'Found:', cacheNames);
            return Promise.all(
                cacheNames.map((cacheName) => {
                    // Delete ALL caches that don't match current version
                    if (cacheName !== CACHE_NAME) {
                        console.log('🗑️  [SW Activate] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                    return Promise.resolve();
                })
            );
        })
    );
    self.clients.claim();
    
    // Notify all clients to refresh
    self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
            client.postMessage({ type: 'CACHE_CLEARED', version: CACHE_NAME });
        });
    });
});

self.addEventListener('fetch', (event) => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') {
        return;
    }

    // Handle API calls differently (if needed in future)
    if (event.request.url.includes('/api/')) {
        event.respondWith(
            fetch(event.request)
                .then((response) => {
                    if (response.status === 200) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    return caches.match(event.request);
                })
        );
        return;
    }

    // Cache first, fallback to network for other resources
    event.respondWith(
        caches.match(event.request).then((response) => {
            if (response) {
                return response;
            }

            return fetch(event.request)
                .then((response) => {
                    // Cache successful responses
                    if (response && response.status === 200) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    // Return offline page or cached version if available
                    return caches.match('/AMS-Instructions/index.html');
                });
        })
    );
});

// Handle messages from clients
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
