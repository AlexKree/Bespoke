const CACHE_NAME = 'bespoke-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/fr/index.html',
  '/fr/stock.html',
  '/fr/services.html',
  '/fr/contact.html',
  '/fr/a-propos.html',
  '/fr/partenaires.html',
  '/fr/track-record.html',
  '/fr/opportunites.html',
  '/en/index.html',
  '/en/stock.html',
  '/en/services.html',
  '/en/contact.html',
  '/en/a-propos.html',
  '/en/partenaires.html',
  '/en/track-record.html',
  '/en/opportunites.html',
  '/assets/styles.css',
  '/assets/site.js',
  '/manifest.webmanifest',
  '/offline.html',
];

// Install: pre-cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch strategy
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never intercept admin or netlify functions
  if (url.pathname.startsWith('/admin') || url.pathname.startsWith('/.netlify')) return;

  // For navigate requests (HTML pages): Network first, fallback to cache, then offline page
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          return res;
        })
        .catch(() =>
          caches.match(event.request).then(cached => cached || caches.match('/offline.html'))
        )
    );
    return;
  }

  // For static assets: Cache first, fallback to network
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return res;
      });
    })
  );
});
