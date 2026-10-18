import type { Page } from "@playwright/test";
import type { ContentItem } from "../../lib/types/content";

/** Seed once on an inert same-origin page, before the app reads its cache. */
export async function seedContentCache(page: Page, items: readonly ContentItem[], principal = "anon") {
  await page.route("**/__e2e/storage", route => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><title>E2E storage setup</title>",
  }), { times: 1 });
  await page.goto("/__e2e/storage");
  await page.evaluate(({ items, principal }) => {
    localStorage.setItem(`aegis-content-cache:${principal}`, JSON.stringify(items));
  }, { items, principal });
}

/** Read the app's primary store, without writing or reseeding it. */
export async function readContentCache(page: Page, principal = "anon"): Promise<ContentItem[]> {
  return page.evaluate(principal => new Promise<ContentItem[]>((resolve, reject) => {
    const request = indexedDB.open("aegis-storage", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("content-cache")) {
        db.close();
        resolve([]);
        return;
      }
      const transaction = db.transaction("content-cache", "readonly");
      const read = transaction.objectStore("content-cache").get(`items:${principal}`);
      transaction.oncomplete = () => {
        db.close();
        resolve(read.result ?? []);
      };
      transaction.onabort = transaction.onerror = () => {
        db.close();
        reject(transaction.error);
      };
    };
  }), principal);
}

/** A cached item must not be replaceable by the demo snapshot on reload. */
export async function emptyDemoFeed(page: Page) {
  await page.route("**/demo-feed.json", route => route.fulfill({
    json: { schemaVersion: 1, items: [] },
  }));
}
