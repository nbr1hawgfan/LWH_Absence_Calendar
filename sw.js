// Caches only the static app shell so the PWA can install and open
// offline. Data fetches (the published CSVs, on a different origin)
// are deliberately left to the network every time - caching those would
// mean managers looking at stale absence data without knowing it.
//
// Network-first for the shell too: always prefer whatever's actually
// deployed, only fall back to the cached copy if there's no network at
// all. A cache-first strategy here meant editing app.js (e.g. updating
// CONFIG URLs) and redeploying had no effect until this file itself
// changed - the browser had no reason to check for a newer app.js.

const CACHE_NAME = 'lwh-pto-calendar-v2';
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

  // Only manage same-origin shell files. The CSV data fetches (a
  // different origin) pass straight through, untouched.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
