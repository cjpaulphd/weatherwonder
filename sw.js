// WeatherWonder Service Worker
// Provides offline shell caching for PWA install support

const CACHE_NAME = 'weatherwonder-v10';
const SHELL_ASSETS = [
    './',
    './index.html',
    './app.js',
    './styles.css',
    './icon.svg',
    './og-image.png',
    './og-image-square.png'
];

// Absolute URLs of the shell assets, resolved against the service worker's
// scope. Used to decide what to cache so that only same-origin app-shell
// assets are stored — never third-party API responses or map tiles.
const SHELL_URLS = SHELL_ASSETS.map((a) => new URL(a, self.location.href).href);

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
    if (event.request.method !== 'GET') return;
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Only cache same-origin app-shell assets. Previously this used
                // endsWith() against asset names, but './' became endsWith('')
                // which matched every URL and cached all API/tile responses.
                const url = event.request.url.split('?')[0];
                if (response.ok && SHELL_URLS.includes(url)) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                }
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});
