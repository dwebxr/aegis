// Kill switch for the retired Aegis PWA service worker.
//
// Browsers that still have the old Serwist worker registered at /sw.js check
// this URL for updates on every navigation. This replacement installs at once,
// deletes every Cache Storage entry the old worker created, unregisters itself,
// and reloads the windows it controlled, so they fetch the end page from the
// network. It has no fetch, push, or notification handlers on purpose.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      } finally {
        await self.registration.unregister();
        const windows = await self.clients.matchAll({ type: "window" });
        await Promise.all(
          windows.map((client) => {
            // Drop the fragment: navigating to the same URL with a fragment
            // can be a same-document jump that never fetches the end page.
            const target = new URL(client.url);
            target.hash = "";
            return client.navigate(target.href).catch(() => undefined);
          }),
        );
      }
    })(),
  );
});
