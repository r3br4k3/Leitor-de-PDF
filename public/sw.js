const CACHE_NAME = "rotapdf-v2";
const SHARED_CACHE_NAME = "rotapdf-shared-v1";
const SHARED_FILE_URL = "/shared-pdf";
const APP_ASSETS = ["/", "/index.html", "/styles.css", "/app.js", "/manifest.webmanifest", "/icons/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => ![CACHE_NAME, SHARED_CACHE_NAME].includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "DELETE_SHARED_PDF") return;

  event.waitUntil(
    caches.open(SHARED_CACHE_NAME).then((cache) => cache.delete(SHARED_FILE_URL))
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === "POST" && url.pathname === "/share-target") {
    event.respondWith(Response.redirect("/?shared=1", 303));
    event.waitUntil(
      (async () => {
        const formData = await event.request.formData();
        const file = formData.get("pdf");
        if (!(file instanceof File)) return;

        const cache = await caches.open(SHARED_CACHE_NAME);
        await cache.put(
          SHARED_FILE_URL,
          new Response(file, {
            headers: {
              "Content-Type": file.type || "application/pdf",
              "X-File-Name": encodeURIComponent(file.name || "documento.pdf"),
            },
          })
        );
      })()
    );
    return;
  }

  if (event.request.method !== "GET") return;

  if (url.pathname === SHARED_FILE_URL) {
    event.respondWith(
      caches.open(SHARED_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(SHARED_FILE_URL);
        return cached || new Response("Nao encontrado", { status: 404 });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match("/index.html"));
    })
  );
});
