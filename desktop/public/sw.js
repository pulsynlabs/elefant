const CACHE_NAME = 'elefant-v1';

// Precache on install: index.html + the JS/CSS bundles
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        '/',
        '/index.html',
      ]);
    }),
  );
  self.skipWaiting();
});

// Activate and claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => n !== CACHE_NAME)
          .map((n) => caches.delete(n)),
      ),
    ),
  );
  self.clients.claim();
});

// Stale-while-revalidate fetch strategy
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET and cross-origin
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) {
    return;
  }

  // Skip API / tools / health proxy paths — those go to the daemon
  const url = new URL(request.url);
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/tools/') ||
    url.pathname === '/health'
  ) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request).then((networkResponse) => {
        if (networkResponse.ok) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return networkResponse;
      });
      return cached || fetchPromise;
    }),
  );
});
