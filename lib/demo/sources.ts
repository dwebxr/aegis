import type { SavedSource } from "@/lib/types/sources";

/** Preset RSS feeds for demo mode */
export const DEMO_SOURCES: SavedSource[] = [
  {
    id: "demo-hn",
    type: "rss",
    label: "Hacker News",
    feedUrl: "https://hnrss.org/frontpage",
    enabled: true,
    createdAt: 0,
  },
  {
    id: "demo-coindesk",
    type: "rss",
    label: "CoinDesk",
    feedUrl: "https://www.coindesk.com/arc/outboundfeeds/rss/",
    enabled: true,
    createdAt: 0,
  },
  {
    id: "demo-verge",
    type: "rss",
    label: "The Verge",
    feedUrl: "https://www.theverge.com/rss/index.xml",
    enabled: true,
    createdAt: 0,
  },
];
