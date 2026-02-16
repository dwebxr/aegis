import { colors } from "@/styles/theme";

export type CatalogCategory = "news" | "tech" | "finance" | "science";

export interface CatalogSource {
  id: string;
  label: string;
  feedUrl: string;
  category: CatalogCategory;
  emoji: string;
  color: string;
}

export const CATALOG_CATEGORIES: ReadonlyArray<{
  id: CatalogCategory; label: string; emoji: string;
}> = [
  { id: "news",    label: "News",    emoji: "\uD83D\uDCF0" },
  { id: "tech",    label: "Tech",    emoji: "\uD83D\uDCBB" },
  { id: "finance", label: "Finance", emoji: "\uD83D\uDCB0" },
  { id: "science", label: "Science", emoji: "\uD83D\uDD2C" },
];

const CAT_COLORS: Record<CatalogCategory, string> = {
  news: colors.blue[400],
  tech: colors.cyan[400],
  finance: colors.green[400],
  science: colors.purple[400],
};

export const POPULAR_SOURCES: ReadonlyArray<CatalogSource> = [
  // ── News ──
  { id: "ap-news",      label: "AP News",       feedUrl: "https://feedx.net/rss/ap.xml",                     category: "news", emoji: "\uD83C\uDF10", color: CAT_COLORS.news },
  { id: "bbc",          label: "BBC News",      feedUrl: "https://feeds.bbci.co.uk/news/rss.xml",           category: "news", emoji: "\uD83C\uDDEC\uD83C\uDDE7", color: CAT_COLORS.news },
  { id: "npr",          label: "NPR",           feedUrl: "https://feeds.npr.org/1001/rss.xml",              category: "news", emoji: "\uD83C\uDFA7", color: CAT_COLORS.news },
  { id: "guardian",     label: "The Guardian",   feedUrl: "https://www.theguardian.com/world/rss",           category: "news", emoji: "\uD83D\uDCF0", color: CAT_COLORS.news },
  { id: "nhk",          label: "NHK World",     feedUrl: "https://www3.nhk.or.jp/rss/news/cat0.xml",        category: "news", emoji: "\uD83C\uDDEF\uD83C\uDDF5", color: CAT_COLORS.news },

  // ── Tech ──
  { id: "hn",           label: "Hacker News",   feedUrl: "https://hnrss.org/frontpage",                     category: "tech", emoji: "\uD83D\uDDA5\uFE0F", color: CAT_COLORS.tech },
  { id: "verge",        label: "The Verge",     feedUrl: "https://www.theverge.com/rss/index.xml",          category: "tech", emoji: "\u25B2",  color: CAT_COLORS.tech },
  { id: "ars",          label: "Ars Technica",  feedUrl: "https://feeds.arstechnica.com/arstechnica/index",  category: "tech", emoji: "\uD83D\uDD27", color: CAT_COLORS.tech },
  { id: "techcrunch",   label: "TechCrunch",    feedUrl: "https://techcrunch.com/feed/",                     category: "tech", emoji: "\uD83D\uDE80", color: CAT_COLORS.tech },
  { id: "wired",        label: "Wired",         feedUrl: "https://www.wired.com/feed/rss",                  category: "tech", emoji: "\u26A1",  color: CAT_COLORS.tech },

  // ── Finance ──
  { id: "coindesk",      label: "CoinDesk",      feedUrl: "https://www.coindesk.com/arc/outboundfeeds/rss/",  category: "finance", emoji: "\u20BF",  color: CAT_COLORS.finance },
  { id: "cointelegraph", label: "CoinTelegraph",  feedUrl: "https://cointelegraph.com/rss",                   category: "finance", emoji: "\uD83E\uDE99", color: CAT_COLORS.finance },
  { id: "defiant",       label: "The Defiant",    feedUrl: "https://thedefiant.io/feed",                      category: "finance", emoji: "\uD83D\uDEE1\uFE0F", color: CAT_COLORS.finance },
  { id: "decrypt",       label: "Decrypt",        feedUrl: "https://decrypt.co/feed",                         category: "finance", emoji: "\uD83D\uDD13", color: CAT_COLORS.finance },
  { id: "dlnews",        label: "DL News",        feedUrl: "https://www.dlnews.com/arc/outboundfeeds/rss/",   category: "finance", emoji: "\uD83D\uDCCA", color: CAT_COLORS.finance },

  // ── Science ──
  { id: "nature",       label: "Nature",         feedUrl: "https://www.nature.com/nature.rss",               category: "science", emoji: "\uD83C\uDF3F", color: CAT_COLORS.science },
  { id: "newscientist", label: "New Scientist",   feedUrl: "https://www.newscientist.com/section/news/feed/", category: "science", emoji: "\uD83E\uDDEA", color: CAT_COLORS.science },
  { id: "sciencedaily", label: "Science Daily",   feedUrl: "https://www.sciencedaily.com/rss/all.xml",        category: "science", emoji: "\uD83D\uDD2C", color: CAT_COLORS.science },
  { id: "phys",         label: "Phys.org",        feedUrl: "https://phys.org/rss-feed/",                     category: "science", emoji: "\u2699\uFE0F", color: CAT_COLORS.science },
  { id: "arxiv-ai",     label: "arXiv AI",        feedUrl: "https://rss.arxiv.org/rss/cs.AI",                category: "science", emoji: "\uD83E\uDDE0", color: CAT_COLORS.science },
];
