/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import { Serwist, NetworkOnly, type PrecacheEntry } from "serwist";

declare const self: ServiceWorkerGlobalScope & {
  __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // IC canister communication — never cache
    {
      matcher: /^https:\/\/.*\.(icp0\.io|ic0\.app|icp-api\.io)(\/|$)/,
      handler: new NetworkOnly(),
    },
    // Internet Identity — never cache
    {
      matcher: /^https:\/\/identity\.ic0\.app/,
      handler: new NetworkOnly(),
    },
    // API routes — never cache
    {
      matcher: /\/api\//,
      handler: new NetworkOnly(),
    },
    // Include serwist defaults for everything else
    ...defaultCache,
  ],
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

// Push notification handler
self.addEventListener("push", (event: PushEvent) => {
  if (!event.data) return;

  let data: { title?: string; body?: string; url?: string; tag?: string };
  try {
    data = event.data.json();
  } catch {
    data = { body: event.data.text() };
  }

  const options: NotificationOptions & { renotify?: boolean } = {
    body: data.body || "Your new briefing is ready.",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag || "aegis-briefing",
    data: { url: data.url || "/" },
    renotify: true,
  };

  event.waitUntil(
    self.registration.showNotification(data.title || "Aegis Briefing", options),
  );
});

// Notification click handler
self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();

  const url = (event.notification.data as { url?: string })?.url || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(clients => {
        for (const client of clients) {
          if ("focus" in client) {
            (client as WindowClient).navigate(url);
            return (client as WindowClient).focus();
          }
        }
        return self.clients.openWindow(url);
      }),
  );
});

serwist.addEventListeners();
