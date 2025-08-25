// Simple app-shell service worker.
// Caches static assets; skips caching authenticated API calls.

const CACHE = "aurora-inbox-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/maskable.svg"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Don't cache GitHub API or any request with Authorization header
  if (url.hostname === "api.github.com") return;
  if (e.request.headers.get("Authorization")) return;

  // App shell: stale-while-revalidate
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetchPromise = fetch(e.request).then(network => {
        if (network && network.ok && e.request.method === "GET") {
          const clone = network.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return network;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});