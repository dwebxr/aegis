import { v4 as uuidv4 } from "uuid";
import { quickSlopFilter } from "./quickFilter";
import type { ContentItem } from "@/lib/types/content";
import type { AnalyzeResponse } from "@/lib/types/api";
import type { UserContext } from "@/lib/preferences/types";
import { errMsg } from "@/lib/utils/errors";

const CYCLE_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes
const MAX_ITEMS_PER_SOURCE = 5;

interface SourceConfig {
  type: "rss" | "url" | "nostr";
  config: Record<string, string>;
  enabled: boolean;
}

interface SchedulerCallbacks {
  onNewContent: (item: ContentItem) => void;
  getSources: () => SourceConfig[];
  getUserContext: () => UserContext | null;
}

export class IngestionScheduler {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private initialTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private callbacks: SchedulerCallbacks;
  private running = false;

  constructor(callbacks: SchedulerCallbacks) {
    this.callbacks = callbacks;
  }

  start(): void {
    if (this.intervalId) return;
    this.initialTimeoutId = setTimeout(() => this.runCycle(), 5000);
    this.intervalId = setInterval(() => this.runCycle(), CYCLE_INTERVAL_MS);
  }

  stop(): void {
    if (this.initialTimeoutId) {
      clearTimeout(this.initialTimeoutId);
      this.initialTimeoutId = null;
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async runCycle(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const sources = this.callbacks.getSources();
      const userContext = this.callbacks.getUserContext();

      for (const source of sources) {
        if (!source.enabled) continue;
        const items = await this.fetchSource(source);

        // Quick filter to reduce API calls
        const passed = items.filter(raw => quickSlopFilter(raw.text));

        // Send top N to Claude for full scoring
        const toScore = passed.slice(0, MAX_ITEMS_PER_SOURCE);
        for (const raw of toScore) {
          const scored = await this.scoreItem(raw, userContext);
          if (scored) {
            this.callbacks.onNewContent(scored);
          }
        }
      }
    } catch (err) {
      console.error("[scheduler] Ingestion cycle failed:", errMsg(err));
    } finally {
      this.running = false;
    }
  }

  private async fetchSource(source: SourceConfig): Promise<Array<{ text: string; author: string; sourceUrl?: string; imageUrl?: string }>> {
    switch (source.type) {
      case "rss":
        return this.fetchRSS(source.config.feedUrl);
      case "nostr":
        return this.fetchNostr(
          source.config.relays?.split(",").map(r => r.trim()) || ["wss://relay.damus.io"],
          source.config.pubkeys?.split(",").map(p => p.trim()),
        );
      case "url":
        return this.fetchURL(source.config.url);
      default:
        return [];
    }
  }

  private async fetchRSS(feedUrl: string): Promise<Array<{ text: string; author: string; sourceUrl?: string; imageUrl?: string }>> {
    try {
      const res = await fetch("/api/fetch/rss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedUrl, limit: 10 }),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.items || []).map((item: { title: string; content: string; author?: string; link?: string; imageUrl?: string }) => ({
        text: `${item.title}\n\n${item.content}`.slice(0, 2000),
        author: item.author || data.feedTitle || "RSS",
        sourceUrl: item.link,
        imageUrl: item.imageUrl,
      }));
    } catch (err) {
      console.error("[scheduler] RSS fetch failed:", errMsg(err));
      return [];
    }
  }

  private async fetchNostr(relays: string[], pubkeys?: string[]): Promise<Array<{ text: string; author: string; sourceUrl?: string; imageUrl?: string }>> {
    try {
      const res = await fetch("/api/fetch/nostr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relays, pubkeys: pubkeys?.length ? pubkeys : undefined, limit: 20 }),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.events || []).map((ev: { content: string; pubkey: string; id: string }) => ({
        text: ev.content.slice(0, 2000),
        author: ev.pubkey.slice(0, 12) + "...",
        sourceUrl: `nostr:${ev.id}`,
      }));
    } catch (err) {
      console.error("[scheduler] Nostr fetch failed:", errMsg(err));
      return [];
    }
  }

  private async fetchURL(url: string): Promise<Array<{ text: string; author: string; sourceUrl?: string; imageUrl?: string }>> {
    try {
      const res = await fetch("/api/fetch/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) return [];
      const data = await res.json();
      let hostname = "unknown";
      try { hostname = new URL(url).hostname; } catch { /* invalid URL */ }
      return [{
        text: `${data.title || ""}\n\n${data.content || ""}`.slice(0, 2000),
        author: data.author || hostname,
        sourceUrl: url,
        imageUrl: data.imageUrl,
      }];
    } catch (err) {
      console.error("[scheduler] URL fetch failed:", errMsg(err));
      return [];
    }
  }

  private async scoreItem(
    raw: { text: string; author: string; sourceUrl?: string; imageUrl?: string },
    userContext: UserContext | null,
  ): Promise<ContentItem | null> {
    try {
      const body: Record<string, unknown> = { text: raw.text, source: "auto" };
      if (userContext) body.userContext = userContext;

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const result: AnalyzeResponse = data.fallback || data;

      return {
        id: uuidv4(),
        owner: "",
        author: raw.author,
        avatar: raw.sourceUrl?.startsWith("nostr:") ? "\uD83D\uDD2E" : "\uD83D\uDCE1",
        text: raw.text.slice(0, 300),
        source: raw.sourceUrl?.startsWith("nostr:") ? "nostr" : "rss",
        sourceUrl: raw.sourceUrl,
        imageUrl: raw.imageUrl,
        scores: {
          originality: result.originality,
          insight: result.insight,
          credibility: result.credibility,
          composite: result.composite,
        },
        verdict: result.verdict,
        reason: result.reason,
        createdAt: Date.now(),
        validated: false,
        flagged: false,
        timestamp: "just now",
        topics: result.topics,
        vSignal: result.vSignal,
        cContext: result.cContext,
        lSlop: result.lSlop,
      };
    } catch (err) {
      console.error("[scheduler] Score item failed:", errMsg(err));
      return null;
    }
  }
}
