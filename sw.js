const CACHE = 'aurora-mailbox-v1.3';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
    // Do NOT call skipWaiting here; we want to wait until the user clicks "Update now"
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => (k !== CACHE && caches.delete(k)))))
  );
  self.clients.claim();
});

// Listen for a message from the page to activate immediately
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Only cache same-origin navigations and static assets
  if (url.origin === location.origin) {
    if (request.mode === 'navigate') {
      e.respondWith(
        fetch(request).catch(() => caches.match('./'))
      );
      return;
    }

    // Static asset cache: stale-while-revalidate
    e.respondWith(
      caches.match(request).then(cached => {
        const network = fetch(request).then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
          return res;
        }).catch(() => cached || Response.error());
        return cached || network;
      })
    );
  }
  // For GitHub API calls, pass-through (don’t cache secrets/dynamic)
});