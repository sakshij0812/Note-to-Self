// Aurora Inbox Service Worker - app shell caching with update prompt
// New SW waits until page asks for activation via SKIP_WAITING to show update banner.

const CACHE = "aurora-inbox-v3";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/maskable.svg",
  "./icons/spandan-signature.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c)=>c.addAll(APP_SHELL)));
  // don't skipWaiting automatically
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if(event.data && event.data.type === "SKIP_WAITING"){
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Do not cache API or authorized requests
  if(url.hostname === "api.github.com") return;
  if(e.request.headers.get("Authorization")) return;

  // Stale-while-revalidate app-shell
  e.respondWith(
    caches.match(e.request).then((cached)=>{
      const fetchPromise = fetch(e.request).then((net)=>{
        if(net && net.ok && e.request.method === "GET"){
          const clone = net.clone();
          caches.open(CACHE).then((cache)=> cache.put(e.request, clone));
        }
        return net;
      }).catch(()=> cached);
      return cached || fetchPromise;
    })
  );
});