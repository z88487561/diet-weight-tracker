// 積木式減脂 PWA — Service Worker
// 每次更新任何檔案 (index.html / tailwind.css / vendor...) 後，請把下面版本號 +1，
// 使用者才會拿到新版本。
const VERSION = "v8";
const CACHE = `fatloss-${VERSION}`;

const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./tailwind.css",
  "./js/weight.js",
  "./vendor/chart.umd.min.js",
  "./vendor/lucide.min.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("fatloss-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 頁面導覽：優先走網路 (拿最新版)，3 秒沒回應或離線就用快取
  if (req.mode === "navigate") {
    event.respondWith(
      Promise.race([
        fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy));
          return res;
        }),
        new Promise((_, reject) => setTimeout(reject, 3000))
      ]).catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  // 其他靜態檔：先給快取，背景更新
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
