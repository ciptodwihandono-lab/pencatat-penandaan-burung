const CACHE_NAME = "ringing-burung-cache-v13";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./js/db.js",
  "./js/export.js",
  "./js/fields.js",
  "./js/utm.js",
  "./js/backup.js",
  "./js/charts.js",
  "./js/cloud.js",
  "./js/firebase-config.js",
  "./icons/icon-v2-192.png",
  "./icons/icon-v2-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache-first untuk app shell, dengan fallback jaringan untuk request lain.
// PENTING: pencarian cache dibatasi ke CACHE_NAME saat ini saja (bukan
// caches.match() global) -- supaya kalau ada sisa cache versi lama yang
// gagal terhapus di activate (pernah terjadi), isinya tidak "membayangi"
// versi baru selamanya. Tanpa pembatasan ini, cache lama bisa terus
// tersaji meski CACHE_NAME sudah dinaikkan.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request)
          .then((response) => {
            if (response.ok && event.request.url.startsWith(self.location.origin)) {
              cache.put(event.request, response.clone());
            }
            return response;
          })
          .catch(() => cache.match("./index.html"));
      })
    )
  );
});
