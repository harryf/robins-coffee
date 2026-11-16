// Service worker of the editor. It makes the editor installable and lets its own
// pages open on a bad connection: every file of this site is fetched from the network
// first and kept; the kept copy is used only when the network fails. Nothing sent to
// another site (GitHub above all) is touched or stored.
const CACHE = "robins-editor-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request).then((response) => {
      if (response.ok) { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(request, copy)); }
      return response;
    }).catch(() => caches.match(request).then((kept) => kept || Response.error())),
  );
});
