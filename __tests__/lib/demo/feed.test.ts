/**
 * @jest-environment jsdom
 */
/**
 * The demo reads a committed snapshot instead of running the live ingestion
 * pipeline, which is what removes /api/fetch/* from every anonymous visit.
 * These tests cover the loader's contract and guard the snapshot itself against
 * drifting away from lib/demo/sources.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { loadDemoFeed, DEMO_FEED_PATH, DEMO_FEED_SCHEMA_VERSION } from "@/lib/demo/feed";
import { DEMO_SOURCES } from "@/lib/demo/sources";

const snapshotPath = path.join(process.cwd(), "public", "demo-feed.json");
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as {
  schemaVersion: number;
  generatedAt: string;
  items: Array<{ text: string; author: string; sourceUrl?: string; feedUrl: string }>;
};

function respondWith(body: unknown, ok = true): void {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 404,
    json: async () => body,
  }) as unknown as typeof fetch;
}

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

describe("public/demo-feed.json", () => {
  it("declares the schema version the loader accepts", () => {
    expect(snapshot.schemaVersion).toBe(DEMO_FEED_SCHEMA_VERSION);
  });

  it("only contains items from feeds listed in lib/demo/sources.ts", () => {
    const allowed = new Set(DEMO_SOURCES.map(s => s.feedUrl));
    for (const item of snapshot.items) {
      expect(allowed).toContain(item.feedUrl);
    }
  });

  it("carries enough items for the demo to look populated", () => {
    expect(snapshot.items.length).toBeGreaterThanOrEqual(5);
  });

  it("records when it was generated, so staleness is visible", () => {
    expect(Number.isNaN(Date.parse(snapshot.generatedAt))).toBe(false);
  });
});

describe("loadDemoFeed", () => {
  it("reads the static asset, never an API route", async () => {
    respondWith(snapshot);
    await loadDemoFeed();
    expect(global.fetch).toHaveBeenCalledWith(DEMO_FEED_PATH, expect.anything());
    expect(DEMO_FEED_PATH.startsWith("/api/")).toBe(false);
  });

  it("scores items through the real heuristic pipeline", async () => {
    respondWith(snapshot);
    const items = await loadDemoFeed();

    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(typeof item.scores.composite).toBe("number");
      expect(["quality", "slop"]).toContain(item.verdict);
      // owner "" is what marks these as demo content for clearDemoContent().
      expect(item.owner).toBe("");
    }
  });

  it("rejects a snapshot from an unsupported schema version", async () => {
    respondWith({ ...snapshot, schemaVersion: 999 });
    await expect(loadDemoFeed()).rejects.toThrow(/schema/i);
  });

  it("rejects a missing snapshot rather than silently showing nothing", async () => {
    respondWith({}, false);
    await expect(loadDemoFeed()).rejects.toThrow(/unavailable/i);
  });

  it("drops malformed items instead of failing the whole load", async () => {
    respondWith({
      schemaVersion: DEMO_FEED_SCHEMA_VERSION,
      items: [{ nope: true }, ...snapshot.items.slice(0, 2)],
    });
    const items = await loadDemoFeed();
    expect(items.length).toBeLessThanOrEqual(2);
  });
});

describe("public/demo-feed.json thumbnails", () => {
  it("ships images so the runtime og-image backfill has nothing to do", () => {
    // The backfill is a server fetch-and-parse per visit; baking the images in
    // at generation time is what keeps a demo visit at zero server functions.
    const withImage = snapshot.items.filter(i => (i as { imageUrl?: string }).imageUrl).length;
    expect(withImage / snapshot.items.length).toBeGreaterThan(0.8);
  });
});
