// WeatherWonder Service Worker
// Provides offline shell caching for PWA install support

const CACHE_NAME = 'weatherwonder-v2';
const SHELL_ASSETS = [
    './',
    './index.html',
    './app.js',
    './styles.css',
    './icon.svg'
];

// Cache app shell on install
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
    );
    self.skipWaiting();
});

// Clean up old caches on activate
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Network-first strategy: try network, fall back to cache
self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Cache successful responses for shell assets
                if (response.ok && SHELL_ASSETS.some((a) => event.request.url.endsWith(a.replace('./', '')))) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                }
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});
