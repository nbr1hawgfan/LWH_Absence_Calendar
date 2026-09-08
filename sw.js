// Caches only the static app shell so the PWA can install and open
// offline. Data fetches (the published CSVs, on a different origin)
// are deliberately left to the network every time - caching those would
// mean managers looking at stale absence data without knowing it.

const CACHE_NAME = 'lwh-pto-calendar-v1';
const SHELL_FILES = ['./index.html', './app.js', './manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only manage caching for same-origin shell files. Everything else
  // (the CSV data fetches) passes straight through to the network.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
