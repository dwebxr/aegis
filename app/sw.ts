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
    // IC canister communication
    {
      matcher: /^https:\/\/.*\.(icp0\.io|ic0\.app|icp-api\.io)(\/|$)/,
      handler: new NetworkOnly(),
    },
    // Internet Identity
    {
      matcher: /^https:\/\/identity\.ic0\.app/,
      handler: new NetworkOnly(),
    },
    // API routes
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

// Background Sync: replay offline action queue when connectivity resumes
interface SyncEvent extends ExtendableEvent {
  tag: string;
}

self.addEventListener("sync", ((event: SyncEvent) => {
  if (event.tag === "aegis-offline-queue") {
    event.waitUntil(drainOfflineQueueFromSW());
  }
}) as EventListener);

async function drainOfflineQueueFromSW(): Promise<void> {
  const DB_NAME = "aegis-offline-queue";
  const STORE_NAME = "pending-actions";

  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE_NAME)) {
        d.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const actions = await new Promise<Array<{ id: number; type: string; payload: unknown }>>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });

  for (const action of actions) {
    try {
      const res = await fetch("/api/offline-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: action.type, payload: action.payload }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readwrite");
          tx.objectStore(STORE_NAME).delete(action.id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      }
    } catch {
      // Will retry on next sync event
    }
  }

  db.close();
}

serwist.addEventListeners();
