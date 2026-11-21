// Served as /edit/sw.js. The phone editor that lived at /edit/ was retired on 21 Nov 2026:
// the website is changed with ROBIN's Studio on a Mac. A phone that installed the editor
// as an app still runs its old service worker, which kept the editor's files. The browser
// checks this address for a new worker, finds this one and runs it: it deletes the
// editor's caches, unregisters itself and reloads open windows, so they show the note at
// /edit/ and the old editor code never runs again. It has no fetch handler.
const OLD_CACHE = /^robins-editor/;
const clearCaches = async () => {
  for (const key of await caches.keys()) if (OLD_CACHE.test(key)) await caches.delete(key);
};
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(clearCaches());
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await clearCaches();
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: "window" })) await client.navigate(client.url).catch(() => undefined);
  })());
});
