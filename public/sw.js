// Ribbon service worker: makes the app installable and keeps its static files fast and available offline.
// It never stores gift data: /api/* always goes to the network, and nothing from it is cached.
// Registered as /sw.js?v=<app version>, so each release gets a fresh cache and old ones are removed.
const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const SHELL = `ribbon-shell-${VERSION}`;
const ASSETS = "ribbon-assets";
const PRECACHE = ["/offline.html", "/favicon.svg", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/icon-180.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("ribbon-shell-") && key !== SHELL).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Data and auth: network only. Falling back to a stored copy could show someone else's gifts.
  if (url.pathname.startsWith("/api/")) return;

  // Pages: network first, a friendly offline page when the server can't be reached.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
    return;
  }

  // Built files carry a content hash in their name, so a cached copy never goes stale.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(ASSETS).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  // Icons, manifest, favicon: from the shell cache, refreshed in the background.
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(
      caches.open(SHELL).then(async (cache) => {
        const hit = await cache.match(request);
        const refresh = fetch(request)
          .then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => hit);
        return hit || refresh;
      }),
    );
  }
});
