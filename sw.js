/* MeldInn service worker. Øk versjonen ved hver endring av appen. */
const CACHE = "meldinn-v4";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/shared/meldinn-core.js", "/shared/icons.js", "/shared/store.js",
  "/icons/icon-192.png", "/icons/icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // Aldri cache API, innlogging, kommuneportal eller kartfliser
  if (url.origin === location.origin && /^\/(api|\.auth|admin)(\/|$)/.test(url.pathname)) return;
  if (url.hostname.includes("tile.openstreetmap.org")) return;
  // Nettverk først, cache som reserve (offline)
  e.respondWith(fetch(e.request).then(res => {
    if (res.ok && (url.origin === location.origin || url.hostname === "unpkg.com")) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then(r => r || (e.request.mode === "navigate" ? caches.match("/index.html") : Response.error()))));
});
