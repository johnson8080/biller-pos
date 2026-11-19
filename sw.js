/* Till POS - offline shell cache */
const VERSION = "till-v3.4.3";
const SHELL = [
  "./",
  "./index.html",
  "./app.css",
  "./manifest.json",
  "./js/daraja.js",
  "./js/notify.js",
  "./js/core.js",
  "./js/cloud.js",
  "./js/mpesa.js",
  "./js/screens.js",
  "./js/sheets.js",
  "./js/scanner.js",
  "./js/auth.js",
  "./js/app.js",
  "./assets/vendor/zxing.min.js",
  "./assets/icon.svg",
  "./assets/icon-192.png",
  "./assets/icon-512.png"
];

// Cache each file on its own: one missing file must never fail the whole
// install, or the app ends up with no offline copy at all.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: "window" }))
      .then((clients) => clients.forEach((client) => client.postMessage({ type: "sw-activated", version: VERSION })))
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Connectivity probe: always go to the network, never answer from cache.
  if (url.pathname.endsWith("/__ping") || url.pathname === "/generate_204") {
    event.respondWith(fetch(request, { cache: "no-store" }).catch(() => Response.error()));
    return;
  }

  // App shell navigations: always go to the network (no-store, so a stale
  // HTTP cache copy cannot resurrect an old version), fall back to the cached
  // shell when there is no connection.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put("./index.html", copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match("./index.html")
          .then((cached) => cached || caches.match("./"))
          .then((cached) => cached || new Response(
            "<!doctype html><meta charset=utf-8><title>Offline</title><body style=\"font:16px system-ui;padding:24px\">Biller is offline and no cached copy exists yet. Reconnect once so the app can save itself to this device.</body>",
            { headers: { "Content-Type": "text/html; charset=utf-8" } }
          )))
    );
    return;
  }

  // Everything else: cache first, then network, and keep the cache warm.
  // Cross-origin files (the Firebase SDK, Google Fonts) are cached too, so the
  // app can boot with no connection at all.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        const cacheable = response.ok || response.type === "opaque";
        if (cacheable) {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      }).catch(() => cached || Response.error());
    })
  );
});
