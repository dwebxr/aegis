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

serwist.addEventListeners();
