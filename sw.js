const CACHE_NAME = 'bespoke-cache-v24';
const STATIC_ASSETS = [
  // Pas de '/' ici : la racine renvoie desormais une redirection 302 par pays
  // (voir netlify.toml). cache.addAll suivrait le 302 et cache.put rejette une
  // reponse redirigee — l'install du SW echouerait en entier.
  '/index.html',
  '/fr/index.html',
  '/fr/stock.html',
  '/fr/concierge.html',
  '/fr/import.html',
  '/fr/inspection.html',
  '/fr/services.html',
  '/fr/contact.html',
  '/fr/a-propos.html',
  '/fr/marche.html',
  '/fr/track-record.html',
  '/en/index.html',
  '/en/stock.html',
  '/en/concierge.html',
  '/en/import.html',
  '/en/inspection.html',
  '/en/services.html',
  '/en/contact.html',
  '/en/a-propos.html',
  '/fr/galerie.html',
  '/en/gallery.html',
  '/en/market.html',
  '/en/track-record.html',
  '/assets/styles.css',
  '/assets/site.js',
  '/assets/img.js',
  '/assets/ai/concierge.js',
  '/assets/ai/import.js',
  '/assets/ai/inspection.js',
  '/manifest.webmanifest',
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

  // La racine est une redirection 302 resolue par pays a la peripherie Netlify.
  // Le SW ne doit jamais la mettre en cache ni la servir : la decision de langue
  // doit rester fraiche a chaque visite.
  if (url.pathname === '/') return;

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
