/* 仅缓存界面文件，账号资料由IndexedDB按账号保存；API绝不进入公共缓存。 */
const CACHE = "study-resume-shell-v1";
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const response = await fetch("/", { cache: "reload" });
      const html = await response.clone().text();
      const assets = [
        ...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g),
      ].map((m) => m[1]);
      await cache.put("/", response);
      await cache.addAll([...assets, "/icon.svg", "/manifest.webmanifest"]);
      // 不强制接管正在编辑的页面，下一次重新打开时再使用新版。
    })(),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith("study-resume-shell-") && key !== CACHE)
          await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  )
    return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/")));
  } else if (
    url.pathname.startsWith("/assets/") ||
    url.pathname === "/icon.svg"
  ) {
    event.respondWith(
      caches.match(event.request).then((hit) => hit || fetch(event.request)),
    );
  }
});
