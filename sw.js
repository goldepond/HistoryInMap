// 지형 타일(NASA GIBS) 영구 캐시 — 한 번 받은 타일은 다시 네트워크 안 타고 즉시 표시.
// 앱 파일(html/js/css/데이터)은 건드리지 않음: GIBS 호스트 요청만 가로채 cache-first.
const TILE_CACHE = "gibs-tiles-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  let url;
  try { url = new URL(e.request.url); } catch { return; }
  if (url.hostname !== "gibs.earthdata.nasa.gov") return; // 지형 타일만 처리, 나머지는 기본 동작
  e.respondWith((async () => {
    const cache = await caches.open(TILE_CACHE);
    const hit = await cache.match(e.request);
    if (hit) return hit;                       // 캐시 적중 → 즉시
    try {
      const res = await fetch(e.request);      // no-cors(opaque) 응답도 캐시 가능
      cache.put(e.request, res.clone());
      return res;
    } catch (err) {
      return hit || Response.error();
    }
  })());
});
