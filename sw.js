const CACHE_NAME = 'bespoke-cache-v2';
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
  '/manifest.json',
  '/offline.html',
];

// Install: pre-cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch strategy
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept admin or netlify functions — let the browser handle them normally
  if (url.pathname.startsWith('/admin') || url.pathname.startsWith('/.netlify')) return;

  // Network first for HTML pages (keeps stock up to date)
  if (event.request.mode === 'navigate' || event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          return res;
        })
        .catch(() =>
          caches.match(event.request).then((cached) => cached || caches.match('/offline.html'))
        )
    );
    return;
  }

  // Network first for CSS/JS assets so updates always propagate; cache first for everything else
  const isCssOrJs = url.pathname.endsWith('.css') || url.pathname.endsWith('.js');
  if (isCssOrJs) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache first for other static assets (images, fonts, etc.)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
        }
        return res;
      });
    })
  );
});
