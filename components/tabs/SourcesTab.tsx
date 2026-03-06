"use client";
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { colors } from "@/styles/theme";
import { cn } from "@/lib/utils";
import { RSSIcon, GlobeIcon, LinkIcon, GitHubIcon, CheckIcon } from "@/components/icons";
import { POPULAR_SOURCES, CATALOG_CATEGORIES, type CatalogCategory } from "@/lib/sources/catalog";
import type { AnalyzeResponse } from "@/lib/types/api";
import type { FetchURLResponse, FetchRSSResponse, FetchTwitterResponse, FetchNostrResponse } from "@/lib/types/api";

import { useSources } from "@/contexts/SourceContext";
import { useAuth } from "@/contexts/AuthContext";
import { useDemo } from "@/contexts/DemoContext";
import { parseGitHubRepo, parseBlueskyHandle, parseRedditSubreddit, parseMastodonAccount, parseFarcasterUser, buildTopicFeedUrl } from "@/lib/sources/platformFeed";
import { loadSourceStates, resetSourceErrors, type SourceRuntimeState, getSourceHealth, getSourceKey } from "@/lib/ingestion/sourceState";
import { relativeTime } from "@/lib/utils/scores";
import { getSuggestions, dismissSuggestion, discoverFeed as discoverFeedForDomain, type DomainValidation } from "@/lib/sources/discovery";
import { isTimeout } from "@/lib/utils/errors";

interface SourcesTabProps {
  onAnalyze: (text: string, meta?: { sourceUrl?: string; imageUrl?: string }) => Promise<AnalyzeResponse>;
  isAnalyzing: boolean;
  mobile?: boolean;
  /** Deep link: pre-fill URL input and auto-trigger extraction */
  initialUrl?: string;
}

type QuickAddId = "youtube" | "topic" | "github" | "bluesky" | "reddit" | "mastodon" | "farcaster";

const QUICK_ADD_PRESETS: ReadonlyArray<{
  id: QuickAddId; icon: string; label: string;
  activeClass: string; badgeClass: string;
  formLabel: string; placeholder: string; hint: string;
}> = [
  { id: "youtube", icon: "\u25B6", label: "YouTube", activeClass: "bg-red-400/[0.09] border-red-400/25 text-red-400", badgeClass: "text-red-400", formLabel: "YouTube Channel URL", placeholder: "https://youtube.com/@channelname", hint: "Paste a channel URL \u2014 we\u2019ll find the RSS feed automatically" },
  { id: "topic", icon: "\uD83D\uDCF0", label: "Topic", activeClass: "bg-amber-400/[0.09] border-amber-400/25 text-amber-400", badgeClass: "text-amber-400", formLabel: "Search Keywords", placeholder: "AI safety, machine learning", hint: "Creates a Google News RSS feed for these keywords" },
  { id: "github", icon: "", label: "GitHub", activeClass: "bg-slate-400/[0.09] border-slate-400/25 text-secondary-foreground", badgeClass: "text-secondary-foreground", formLabel: "GitHub Repository", placeholder: "owner/repo or https://github.com/owner/repo", hint: "Subscribes to release notifications for this repository" },
  { id: "bluesky", icon: "\uD83E\uDD8B", label: "Bluesky", activeClass: "bg-sky-400/[0.09] border-sky-400/25 text-sky-400", badgeClass: "text-sky-400", formLabel: "Bluesky Handle", placeholder: "@handle.bsky.social", hint: "Subscribes to this account\u2019s posts via Bluesky native RSS" },
  { id: "reddit", icon: "\uD83D\uDCAC", label: "Reddit", activeClass: "bg-orange-400/[0.09] border-orange-400/25 text-orange-400", badgeClass: "text-orange-400", formLabel: "Subreddit Name", placeholder: "r/programming or subreddit name", hint: "Subscribes to subreddit posts via Reddit native RSS" },
  { id: "mastodon", icon: "\uD83D\uDC18", label: "Mastodon", activeClass: "bg-purple-400/[0.09] border-purple-400/25 text-purple-400", badgeClass: "text-purple-400", formLabel: "Mastodon Account", placeholder: "@user@mastodon.social or profile URL", hint: "Subscribes to posts via Mastodon native RSS (works with any instance)" },
  { id: "farcaster", icon: "\uD83D\uDFE3", label: "Farcaster", activeClass: "bg-purple-600/[0.09] border-purple-600/25 text-purple-600", badgeClass: "text-purple-600", formLabel: "Farcaster Username", placeholder: "@username or https://warpcast.com/username", hint: "Subscribes to casts via Farcaster Hub API (free, no API key needed)" },
];

const HEALTH_BG: Record<string, string> = {
  healthy: "bg-green-400",
  degraded: "bg-amber-400",
  error: "bg-red-400",
  disabled: "bg-disabled",
  rate_limited: "bg-sky-400",
};

const inputClass = "w-full bg-navy-lighter border border-border rounded-md px-4 py-3 text-secondary-foreground text-body-sm font-[inherit] outline-none box-border";

const btnClass = (disabled: boolean, loading: boolean) => cn(
  "px-5 py-3 rounded-md text-white text-body-sm font-bold whitespace-nowrap transition-fast border-none",
  loading ? "bg-sky-400/10" : "bg-gradient-to-br from-blue-600 to-blue-700",
  disabled ? "opacity-50 cursor-default" : "cursor-pointer",
);

const saveBtnClass = "px-4 py-2 bg-gradient-to-br from-green-500 to-green-400 border-none rounded-md text-white text-body-sm font-bold cursor-pointer transition-fast font-[inherit]";

const kpiLabel = "text-tiny font-bold uppercase tracking-[0.5px] text-disabled";

function platformBadgeClass(platform?: string, type?: string): string {
  const key = platform || type;
  switch (key) {
    case "youtube": return "text-red-400";
    case "topic": return "text-amber-400";
    case "github": return "text-secondary-foreground";
    case "bluesky": return "text-sky-400";
    case "reddit": return "text-orange-400";
    case "mastodon": return "text-purple-400";
    case "farcaster": return "text-purple-600";
    case "rss": return "text-amber-400";
    case "nostr": return "text-purple-400";
    default: return "text-amber-400";
  }
}

function formatRetryCountdown(until: number): string {
  const diffSec = Math.max(0, Math.ceil((until - Date.now()) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  return `${Math.ceil(diffSec / 60)} min`;
}

export const SourcesTab: React.FC<SourcesTabProps> = ({ onAnalyze, isAnalyzing, mobile, initialUrl }) => {
  const { sources, syncStatus, syncError, addSource, removeSource, toggleSource, updateSource } = useSources();
  const { isAuthenticated } = useAuth();
  const { isDemoMode } = useDemo();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editFeedUrl, setEditFeedUrl] = useState("");
  const [editRelays, setEditRelays] = useState<string[]>([]);
  const [editPubkeys, setEditPubkeys] = useState<string[]>([]);
  const [editNewRelay, setEditNewRelay] = useState("");
  const [editNewPubkey, setEditNewPubkey] = useState("");
  const [activeSource, setActiveSource] = useState<"url" | "rss" | "twitter" | "nostr">("url");
  const [urlInput, setUrlInput] = useState("");
  const [urlResult, setUrlResult] = useState<FetchURLResponse | null>(null);
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError] = useState("");
  const [rssInput, setRssInput] = useState("");
  const [rssResult, setRssResult] = useState<FetchRSSResponse | null>(null);
  const [rssLoading, setRssLoading] = useState(false);
  const [rssError, setRssError] = useState("");
  const [twitterToken, setTwitterToken] = useState("");
  const [twitterQuery, setTwitterQuery] = useState("");
  const [twitterResult, setTwitterResult] = useState<FetchTwitterResponse | null>(null);
  const [twitterLoading, setTwitterLoading] = useState(false);
  const [twitterError, setTwitterError] = useState("");
  const [nostrRelays, setNostrRelays] = useState("wss://relay.damus.io");
  const [nostrPubkeys, setNostrPubkeys] = useState("");
  const [nostrResult, setNostrResult] = useState<FetchNostrResponse | null>(null);
  const [nostrLoading, setNostrLoading] = useState(false);
  const [nostrError, setNostrError] = useState("");
  const [analyzedUrls, setAnalyzedUrls] = useState<Set<string>>(new Set());

  // Quick Add presets
  const [quickAddMode, setQuickAddMode] = useState<"" | QuickAddId>("");
  const [quickAddInput, setQuickAddInput] = useState("");
  const [quickAddLoading, setQuickAddLoading] = useState(false);
  const [quickAddError, setQuickAddError] = useState("");
  const [resolvedFarcaster, setResolvedFarcaster] = useState<{ fid: number; username: string } | null>(null);
  const [resolvedPlatform, setResolvedPlatform] = useState<QuickAddId | null>(null);

  // Popular Sources catalog
  const [catalogFilter, setCatalogFilter] = useState<CatalogCategory | "all">("all");
  const [justAddedIds, setJustAddedIds] = useState<Set<string>>(new Set());
  const addedFeedUrls = useMemo(
    () => new Set(sources.filter(s => (s.type === "rss" || s.type === "farcaster") && s.feedUrl).map(s => s.feedUrl!)),
    [sources],
  );

  const [sourceStates, setSourceStates] = useState<Record<string, SourceRuntimeState>>(loadSourceStates);
  useEffect(() => {
    const id = setInterval(() => setSourceStates(loadSourceStates()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Deep link: auto-fill URL and trigger extraction
  const initialUrlConsumedRef = useRef(false);
  useEffect(() => {
    if (!initialUrl || initialUrlConsumedRef.current) return;
    initialUrlConsumedRef.current = true;
    setActiveSource("url");
    setUrlInput(initialUrl);
    void fetchUrl(initialUrl);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl]);

  // Source auto-suggestions from validated domains
  const [feedSuggestions, setFeedSuggestions] = useState<Array<DomainValidation & { discoveredFeedUrl?: string | null }>>([]);
  useEffect(() => {
    if (isDemoMode) return;
    let cancelled = false;
    const existingUrls = sources.filter(s => s.type === "rss" && s.feedUrl).map(s => s.feedUrl!);
    const suggestions = getSuggestions(existingUrls);
    if (suggestions.length > 0) {
      Promise.allSettled(suggestions.map(async s => ({
        ...s,
        discoveredFeedUrl: s.feedUrl || await discoverFeedForDomain(s.domain),
      }))).then(results => {
        if (cancelled) return;
        setFeedSuggestions(
          results
            .filter((r): r is PromiseFulfilledResult<typeof suggestions[0] & { discoveredFeedUrl: string | null }> => r.status === "fulfilled")
            .map(r => r.value),
        );
      }).catch(err => console.warn("[sources] Feed suggestion discovery failed:", err));
    } else {
      setFeedSuggestions([]);
    }
    return () => { cancelled = true; };
  }, [sources, isDemoMode]);

  // Feed auto-discovery
  const [discoveredFeeds, setDiscoveredFeeds] = useState<Array<{ url: string; title?: string; type?: string }>>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);

  const discoverFeed = useCallback(async (url: string) => {
    if (!url.trim()) return;
    setDiscoverLoading(true);
    setDiscoveredFeeds([]);
    setRssError("");
    try {
      const res = await fetch("/api/fetch/discover-feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) {
        const data = await res.json();
        const feeds = data.feeds || [];
        setDiscoveredFeeds(feeds);
        if (feeds.length === 0) setRssError("No feeds found at this URL");
      } else {
        const data = await res.json().catch((e: unknown) => {
          console.warn("[sources] Failed to parse error response:", e);
          return {};
        });
        setRssError(data.error || "Feed discovery failed");
      }
    } catch (err) {
      setRssError(isTimeout(err) ? "Request timed out — try again" : "Network error — could not discover feeds");
    } finally {
      setDiscoverLoading(false);
    }
  }, []);

  const fetchUrl = async (overrideUrl?: string) => {
    const target = overrideUrl ?? urlInput;
    if (!target.trim()) return;
    setUrlLoading(true); setUrlError(""); setUrlResult(null);
    try {
      const res = await fetch("/api/fetch/url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: target }), signal: AbortSignal.timeout(20_000) });
      if (!res.ok) { const e = await res.json().catch(() => null); setUrlError(e?.error || "Failed to extract"); return; }
      const data = await res.json();
      setUrlResult(data);
    } catch (err) { setUrlError(isTimeout(err) ? "Request timed out — try again" : "Network error — check connection"); } finally { setUrlLoading(false); }
  };

  const fetchRss = async () => {
    if (!rssInput.trim()) return;
    setRssLoading(true); setRssError(""); setRssResult(null);
    try {
      const res = await fetch("/api/fetch/rss", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feedUrl: rssInput, limit: 10 }), signal: AbortSignal.timeout(15_000) });
      if (!res.ok) { const e = await res.json().catch(() => null); setRssError(e?.error || "Failed to parse feed"); return; }
      const data = await res.json();
      setRssResult(data);
    } catch (err) { setRssError(isTimeout(err) ? "Request timed out — try again" : "Network error — check connection"); } finally { setRssLoading(false); }
  };

  const fetchTwitter = async () => {
    if (!twitterToken.trim() || !twitterQuery.trim()) return;
    setTwitterLoading(true); setTwitterError(""); setTwitterResult(null);
    try {
      const res = await fetch("/api/fetch/twitter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bearerToken: twitterToken, query: twitterQuery, maxResults: 10 }), signal: AbortSignal.timeout(20_000) });
      if (!res.ok) { const e = await res.json().catch(() => null); setTwitterError(e?.error || "Failed to fetch tweets"); return; }
      const data = await res.json();
      setTwitterResult(data);
    } catch (err) { setTwitterError(isTimeout(err) ? "Request timed out — try again" : "Network error — check connection"); } finally { setTwitterLoading(false); }
  };

  const fetchNostr = async () => {
    setNostrLoading(true); setNostrError(""); setNostrResult(null);
    try {
      const relays = nostrRelays.split("\n").map(r => r.trim()).filter(Boolean);
      const pubkeys = nostrPubkeys.split("\n").map(p => p.trim()).filter(Boolean);
      const res = await fetch("/api/fetch/nostr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ relays, pubkeys: pubkeys.length > 0 ? pubkeys : undefined, limit: 20 }), signal: AbortSignal.timeout(15_000) });
      if (!res.ok) { const e = await res.json().catch(() => null); setNostrError(e?.error || "Failed to fetch events"); return; }
      const data = await res.json();
      setNostrResult(data);
    } catch (err) { setNostrError(isTimeout(err) ? "Request timed out — try again" : "Network error — check connection"); } finally { setNostrLoading(false); }
  };

  const handleAnalyzeOnce = async (text: string, meta?: { sourceUrl?: string; imageUrl?: string }) => {
    const key = meta?.sourceUrl || text.slice(0, 200);
    if (analyzedUrls.has(key)) return;
    try {
      const result = await onAnalyze(text, meta);
      setAnalyzedUrls(prev => new Set(prev).add(key));
      return result;
    } catch (err) {
      // Don't mark as analyzed on failure — allow retry
      console.warn("[sources] Analysis failed, will allow retry:", err);
    }
  };

  const handleSaveRss = () => {
    if (!rssResult) return;
    const label = rssResult.feedTitle || rssInput;
    const platform = resolvedPlatform || undefined;
    let added: boolean;
    if (resolvedFarcaster) {
      added = addSource({ type: "farcaster", label, feedUrl: rssInput, fid: resolvedFarcaster.fid, username: resolvedFarcaster.username, platform: "farcaster", enabled: true });
    } else {
      added = addSource({ type: "rss", label, feedUrl: rssInput, platform, enabled: true });
    }
    if (!added) { setRssError("This feed is already saved"); return; }
    setRssInput(""); setRssResult(null); setResolvedFarcaster(null); setResolvedPlatform(null);
  };

  const handleSaveNostr = () => {
    const relays = nostrRelays.split("\n").map(r => r.trim()).filter(Boolean);
    const pubkeys = nostrPubkeys.split("\n").map(p => p.trim()).filter(Boolean);
    if (relays.length === 0) return;
    const invalid = relays.find(r => !r.startsWith("wss://"));
    if (invalid) { setNostrError("Relay URLs must use wss:// protocol"); return; }
    const label = pubkeys.length > 0 ? `Nostr (${pubkeys.length} keys)` : `Nostr (${relays.length} relays)`;
    const added = addSource({ type: "nostr", label, relays, pubkeys, enabled: true });
    if (!added) { setNostrError("This relay config is already saved"); return; }
  };

  const handleQuickAdd = useCallback(async () => {
    const input = quickAddInput.trim();
    if (!input) return;
    setQuickAddLoading(true);
    setQuickAddError("");

    try {
      let feedUrl: string;
      let label: string;

      switch (quickAddMode) {
        case "youtube": {
          const ytUrl = input.startsWith("http") ? input : `https://www.youtube.com/${input}`;
          const res = await fetch("/api/fetch/discover-feed", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: ytUrl }),
            signal: AbortSignal.timeout(15_000),
          });
          if (!res.ok) { setQuickAddError("Could not find a YouTube feed"); return; }
          const data = await res.json();
          if (!data.feeds?.length) { setQuickAddError("No feed found \u2014 check the channel URL"); return; }
          feedUrl = data.feeds[0].url;
          label = data.feeds[0].title || "YouTube Channel";
          break;
        }
        case "topic": {
          feedUrl = buildTopicFeedUrl(input);
          label = `Topic: ${input}`;
          break;
        }
        case "github": {
          const parsed = parseGitHubRepo(input);
          if ("error" in parsed) { setQuickAddError(parsed.error); return; }
          feedUrl = `https://github.com/${parsed.owner}/${parsed.repo}/releases.atom`;
          label = `${parsed.owner}/${parsed.repo} Releases`;
          break;
        }
        case "bluesky": {
          const handle = parseBlueskyHandle(input);
          feedUrl = `https://bsky.app/profile/${handle}/rss`;
          label = `Bluesky: @${handle}`;
          break;
        }
        case "reddit": {
          const sub = parseRedditSubreddit(input);
          if (!sub) { setQuickAddError("Please enter a valid subreddit name"); return; }
          feedUrl = `https://www.reddit.com/r/${sub}/.rss`;
          label = `r/${sub}`;
          break;
        }
        case "mastodon": {
          const acct = parseMastodonAccount(input);
          if ("error" in acct) { setQuickAddError(acct.error); return; }
          feedUrl = `https://${acct.instance}/@${acct.username}.rss`;
          label = `@${acct.username}@${acct.instance}`;
          break;
        }
        case "farcaster": {
          const parsed = parseFarcasterUser(input);
          if ("error" in parsed) { setQuickAddError(parsed.error); return; }
          const resolveRes = await fetch("/api/fetch/farcaster", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "resolve", username: parsed.username }),
            signal: AbortSignal.timeout(10_000),
          });
          if (!resolveRes.ok) {
            const err = await resolveRes.json().catch(() => ({}));
            setQuickAddError(err.error || "User not found on Farcaster");
            return;
          }
          const { fid, displayName } = await resolveRes.json();
          setResolvedFarcaster({ fid, username: parsed.username });
          feedUrl = `https://feeds.fcstr.xyz/rss/user/${fid}`;
          label = displayName ? `Farcaster: ${displayName} (@${parsed.username})` : `Farcaster: @${parsed.username}`;
          break;
        }
        default:
          return;
      }

      setRssInput(feedUrl);
      setRssLoading(true); setRssError(""); setRssResult(null);
      try {
        const res = await fetch("/api/fetch/rss", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feedUrl, limit: 10 }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => null);
          setRssInput("");
          if (quickAddMode === "topic") {
            setRssError("Feed fetch failed — try different keywords or paste a direct RSS URL");
          } else {
            setRssError(e?.error || "Failed to parse feed");
          }
          return;
        }
        const data = await res.json();
        setRssResult({ ...data, feedTitle: data.feedTitle || label });
        setResolvedPlatform(quickAddMode as QuickAddId);
        // Only clear quick add form after successful validation
        setQuickAddMode("");
        setQuickAddInput("");
      } finally {
        setRssLoading(false);
      }
    } catch (err) {
      setQuickAddError(isTimeout(err) ? "Request timed out \u2014 try again" : "Network error \u2014 could not add feed");
    } finally {
      setQuickAddLoading(false);
    }
  }, [quickAddMode, quickAddInput]);

  const handleCatalogAdd = useCallback((src: { id: string; label: string; feedUrl: string }) => {
    if (addedFeedUrls.has(src.feedUrl)) return;
    const added = addSource({ type: "rss", label: src.label, feedUrl: src.feedUrl, enabled: true });
    if (!added) return;
    setJustAddedIds(prev => { const n = new Set(prev); n.add(src.id); return n; });
    setTimeout(() => setJustAddedIds(prev => { const n = new Set(prev); n.delete(src.id); return n; }), 2000);
  }, [addSource, addedFeedUrls]);

  const startEdit = (s: typeof sources[number]) => {
    setEditingId(s.id);
    setEditLabel(s.label);
    setEditFeedUrl(s.feedUrl || "");
    setEditRelays([...(s.relays || [])]);
    setEditPubkeys([...(s.pubkeys || [])]);
    setEditNewRelay("");
    setEditNewPubkey("");
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = () => {
    if (!editingId) return;
    const s = sources.find(x => x.id === editingId);
    if (!s) return;
    if (s.type === "rss") {
      updateSource(editingId, { label: editLabel.trim() || s.label, feedUrl: editFeedUrl.trim() || s.feedUrl });
    } else {
      const filtered = editRelays.filter(Boolean);
      if (filtered.length === 0) return;
      updateSource(editingId, {
        label: editLabel.trim() || s.label,
        relays: filtered,
        pubkeys: editPubkeys.filter(Boolean),
      });
    }
    setEditingId(null);
  };

  const getStateKey = (s: typeof sources[number]): string => {
    const config: Record<string, string> = {};
    if (s.type === "rss") config.feedUrl = s.feedUrl || "";
    if (s.type === "nostr") config.relays = (s.relays || []).join(",");
    return getSourceKey(s.type, config);
  };

  const sourceTabs: Array<{ id: "url" | "rss" | "twitter" | "nostr"; label: string; icon: React.ReactNode; activeClass: string }> = [
    { id: "url", label: "URL", icon: <LinkIcon s={14} />, activeClass: "bg-sky-400/[0.09] border-sky-400/25 text-sky-400" },
    { id: "rss", label: "RSS", icon: <RSSIcon s={14} />, activeClass: "bg-amber-400/[0.09] border-amber-400/25 text-amber-400" },
    { id: "twitter", label: "X (Twitter)", icon: <span className="text-[14px]">{"\u{1D54F}"}</span>, activeClass: "bg-slate-400/[0.09] border-slate-400/25 text-secondary-foreground" },
    { id: "nostr", label: "Nostr", icon: <GlobeIcon s={14} />, activeClass: "bg-purple-400/[0.09] border-purple-400/25 text-purple-400" },
  ];

  return (
    <div className="animate-fade-in">
      <div className={cn("mb-8", !mobile && "mb-12")}>
        <h1 data-testid="aegis-sources-heading" className={cn(
          "font-bold leading-tight tracking-tight text-foreground m-0",
          mobile ? "text-[22px]" : "text-display"
        )}>
          Content Sources
        </h1>
        <p className={cn("text-muted-foreground mt-1", mobile ? "text-body-sm" : "text-body")}>
          Configure where to find content for evaluation
        </p>
      </div>

      {isDemoMode && (
        <div className="bg-blue-600/[0.04] border border-blue-600/15 rounded-lg px-5 py-3 mb-3 text-body-sm text-blue-400 font-semibold">
          Demo sources are read-only. Login to add your own feeds.
        </div>
      )}

      {!isAuthenticated && !isDemoMode && sources.length === 0 && (
        <div className="bg-card border border-border rounded-lg p-5 mb-5 text-center text-muted-foreground text-body-sm">
          Log in to save sources for automatic fetching
        </div>
      )}

      <div className="flex gap-1 mb-5 flex-wrap">
        {sourceTabs.map(s => (
          <button key={s.id} data-testid={`aegis-sources-tab-${s.id}`} onClick={() => setActiveSource(s.id)} className={cn(
            "flex items-center gap-1.5 px-4 py-2 rounded-sm text-body-sm font-semibold cursor-pointer transition-fast font-[inherit] border",
            activeSource === s.id ? s.activeClass : "bg-subtle border-subtle text-muted-foreground"
          )}>
            {s.icon} {s.label}
          </button>
        ))}
      </div>

      <div className={cn("bg-card border border-border rounded-xl", mobile ? "p-5" : "p-8")}>
        {activeSource === "url" && (
          <div>
            <label className={cn(kpiLabel, "block mb-1")}>Article URL</label>
            <div className="flex gap-2">
              <input data-testid="aegis-sources-url-input" value={urlInput} onChange={e => setUrlInput(e.target.value)} placeholder="https://example.com/article" className={cn(inputClass, "flex-1")} />
              <button data-testid="aegis-sources-extract-btn" onClick={() => fetchUrl()} disabled={urlLoading || !urlInput.trim()} className={btnClass(!urlInput.trim(), urlLoading)}>
                {urlLoading ? "Extracting..." : "Extract"}
              </button>
            </div>
            {urlError && <div data-testid="aegis-sources-url-error" className="text-body-sm text-red-400 mt-2">{urlError}</div>}
            {urlResult && (
              <div data-testid="aegis-sources-url-result" className="mt-4 bg-navy-lighter rounded-md p-4">
                <div className="flex gap-3 mb-3">
                  {urlResult.imageUrl && (
                    /* eslint-disable-next-line @next/next/no-img-element -- external user-content URLs */
                    <img
                      src={urlResult.imageUrl}
                      alt=""
                      loading="lazy"
                      className="w-[100px] h-[100px] object-cover rounded-sm border border-border shrink-0"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-body font-bold text-secondary-foreground mb-1">{urlResult.title}</div>
                    <div className="text-caption text-muted-foreground mb-2">by {urlResult.author} &middot; {urlResult.source}</div>
                    <a href={urlInput} target="_blank" rel="noopener noreferrer" className="text-caption text-blue-400 no-underline font-semibold">
                      Open original &rarr;
                    </a>
                  </div>
                </div>
                <div className="text-body-sm text-tertiary leading-relaxed max-h-[200px] overflow-auto mb-3">{urlResult.content.slice(0, 1000)}{urlResult.content.length > 1000 ? "..." : ""}</div>
                <button onClick={() => handleAnalyzeOnce(urlResult.content, { sourceUrl: urlInput, imageUrl: urlResult.imageUrl })} disabled={isAnalyzing || analyzedUrls.has(urlInput)} className={btnClass(isAnalyzing || analyzedUrls.has(urlInput), isAnalyzing)}>
                  {analyzedUrls.has(urlInput) ? "Already Analyzed" : isAnalyzing ? "Analyzing..." : "Analyze This Content"}
                </button>
              </div>
            )}
          </div>
        )}

        {activeSource === "rss" && (
          <div>
            <label className={cn(kpiLabel, "block mb-1")}>RSS Feed URL</label>
            <div className="flex gap-2">
              <input
                data-testid="aegis-sources-rss-input"
                value={rssInput}
                onChange={e => {
                  setRssInput(e.target.value);
                  setDiscoveredFeeds([]);
                  setResolvedPlatform(null);
                }}
                placeholder="https://example.com/feed.xml \u2014 blogs, podcasts, any RSS/Atom feed"
                className={cn(inputClass, "flex-1")}
              />
              <button onClick={fetchRss} disabled={rssLoading || !rssInput.trim()} className={btnClass(!rssInput.trim(), rssLoading)}>
                {rssLoading ? "Fetching..." : "Fetch Feed"}
              </button>
            </div>

            {/* Feed auto-discovery */}
            {rssInput.trim() && !rssResult && !rssLoading && (
              <div className="mt-2">
                <button
                  onClick={() => discoverFeed(rssInput)}
                  disabled={discoverLoading}
                  className={cn(
                    "bg-transparent border-none cursor-pointer text-caption text-blue-400 font-semibold font-[inherit] p-0",
                    discoverLoading && "opacity-50"
                  )}
                >
                  {discoverLoading ? "Discovering feeds..." : "Not a feed URL? Auto-discover feeds"}
                </button>
                {discoveredFeeds.length > 0 && (
                  <div className="mt-2 flex gap-2 flex-wrap">
                    {discoveredFeeds.map((f) => (
                      <button
                        key={f.url}
                        onClick={() => { setRssInput(f.url); setDiscoveredFeeds([]); setResolvedPlatform(null); }}
                        className="px-3 py-1 bg-amber-400/[0.08] border border-amber-400/25 rounded-sm text-caption text-amber-400 cursor-pointer font-[inherit] font-semibold"
                      >
                        {f.title || f.url}
                        {f.type && <span className="opacity-60 ml-1">({f.type})</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Quick Add Presets */}
            {!rssResult && (() => {
              const activePreset = QUICK_ADD_PRESETS.find(p => p.id === quickAddMode);
              return (
                <div className="mt-3">
                  <div className={cn(kpiLabel, "mb-2")}>Quick Add</div>
                  <div className="flex gap-2 flex-wrap">
                    {QUICK_ADD_PRESETS.map(p => (
                      <button
                        key={p.id}
                        onClick={() => { setQuickAddMode(quickAddMode === p.id ? "" : p.id); setQuickAddInput(""); setQuickAddError(""); setRssError(""); setResolvedFarcaster(null); setResolvedPlatform(null); }}
                        className={cn(
                          "flex items-center gap-1 px-3 py-1 rounded-sm text-caption font-semibold cursor-pointer font-[inherit] transition-fast border",
                          quickAddMode === p.id ? p.activeClass : "bg-subtle border-subtle text-muted-foreground"
                        )}
                      >
                        {p.id === "github" ? <GitHubIcon s={12} /> : <span>{p.icon}</span>} {p.label}
                      </button>
                    ))}
                  </div>

                  {activePreset && (
                    <div className="mt-3 bg-navy-lighter rounded-md p-4">
                      <label className={cn(kpiLabel, "block mb-1")}>{activePreset.formLabel}</label>
                      <div className="flex gap-2">
                        <input
                          value={quickAddInput}
                          onChange={e => { setQuickAddInput(e.target.value); setQuickAddError(""); }}
                          onKeyDown={e => { if (e.key === "Enter" && quickAddInput.trim()) handleQuickAdd(); }}
                          placeholder={activePreset.placeholder}
                          className={cn(inputClass, "flex-1")}
                        />
                        <button
                          onClick={handleQuickAdd}
                          disabled={quickAddLoading || !quickAddInput.trim()}
                          className={btnClass(!quickAddInput.trim(), quickAddLoading)}
                        >
                          {quickAddLoading ? "Adding..." : "Add Feed"}
                        </button>
                      </div>
                      <div className="text-caption text-muted-foreground mt-1">{activePreset.hint}</div>
                      {quickAddError && <div className="text-body-sm text-red-400 mt-2">{quickAddError}</div>}
                    </div>
                  )}
                </div>
              );
            })()}

            {rssError && <div className="text-body-sm text-red-400 mt-2">{rssError}</div>}
            {rssResult && (
              <div className="mt-4">
                <div className="flex justify-between items-center mb-3">
                  <div className="text-h3 font-semibold text-secondary-foreground">{rssResult.feedTitle} ({rssResult.items.length} items)</div>
                  {isAuthenticated && (
                    <button onClick={handleSaveRss} className={saveBtnClass}>
                      Save as Source
                    </button>
                  )}
                </div>
                {rssResult.items.map((item, i) => (
                  <div key={item.link ? `${item.link}-${i}` : `${item.title}-${i}`} className="bg-navy-lighter rounded-md p-3 mb-1 flex items-center gap-3">
                    {item.imageUrl && (
                      /* eslint-disable-next-line @next/next/no-img-element -- external user-content URLs */
                      <img
                        src={item.imageUrl}
                        alt=""
                        loading="lazy"
                        className="size-12 object-cover rounded-sm border border-border shrink-0"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      {item.link ? (
                        <a href={item.link} target="_blank" rel="noopener noreferrer" className="text-body-sm text-secondary-foreground font-semibold overflow-hidden text-ellipsis whitespace-nowrap block no-underline">{item.title}</a>
                      ) : (
                        <div className="text-body-sm text-secondary-foreground font-semibold overflow-hidden text-ellipsis whitespace-nowrap">{item.title}</div>
                      )}
                      <div className="text-caption text-muted-foreground">{item.author} &middot; {item.publishedDate}</div>
                    </div>
                    <button onClick={() => handleAnalyzeOnce(item.content || item.title, { sourceUrl: item.link || undefined, imageUrl: item.imageUrl })} disabled={isAnalyzing || !!(item.link && analyzedUrls.has(item.link))} className={cn(btnClass(isAnalyzing || !!(item.link && analyzedUrls.has(item.link)), false), "!px-3 !py-1.5 !text-caption shrink-0")}>
                      {item.link && analyzedUrls.has(item.link) ? "Done" : "Analyze"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeSource === "twitter" && (
          <div>
            <label className={cn(kpiLabel, "block mb-1")}>X API Bearer Token</label>
            <input type="password" value={twitterToken} onChange={e => setTwitterToken(e.target.value)} placeholder="Your X API Bearer Token" className={cn(inputClass, "mb-3")} />
            <label className={cn(kpiLabel, "block mb-1")}>Search Query</label>
            <div className="flex gap-2">
              <input value={twitterQuery} onChange={e => setTwitterQuery(e.target.value)} placeholder="AI research -is:retweet lang:en" className={cn(inputClass, "flex-1")} />
              <button onClick={fetchTwitter} disabled={twitterLoading || !twitterToken.trim() || !twitterQuery.trim()} className={btnClass(!twitterToken.trim() || !twitterQuery.trim(), twitterLoading)}>
                {twitterLoading ? "Searching..." : "Search"}
              </button>
            </div>
            <div className="text-caption text-muted-foreground mt-1">Your token is sent per-request only and never stored on our servers.</div>
            {twitterError && <div className="text-body-sm text-red-400 mt-2">{twitterError}</div>}
            {twitterResult && (
              <div className="mt-4">
                <div className="text-h3 font-semibold text-secondary-foreground mb-3">{twitterResult.tweets.length} tweets found</div>
                {twitterResult.tweets.map(tweet => (
                  <div key={tweet.id} className="bg-navy-lighter rounded-md p-3 mb-1">
                    <div className="flex justify-between items-start gap-3">
                      <div className="flex-1">
                        <div className="text-body-sm text-secondary-foreground font-semibold font-mono">{tweet.authorHandle}</div>
                        <div className="text-body-sm text-tertiary leading-normal mt-1">{tweet.text}</div>
                        <div className="text-caption text-muted-foreground mt-1">{tweet.createdAt}</div>
                      </div>
                      <button onClick={() => handleAnalyzeOnce(tweet.text)} disabled={isAnalyzing || analyzedUrls.has(tweet.text.slice(0, 200))} className={cn(btnClass(isAnalyzing || analyzedUrls.has(tweet.text.slice(0, 200)), false), "!px-3 !py-1.5 !text-caption")}>
                        {analyzedUrls.has(tweet.text.slice(0, 200)) ? "Done" : "Analyze"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeSource === "nostr" && (
          <div>
            <label className={cn(kpiLabel, "block mb-1")}>Relay URLs (one per line, max 20)</label>
            <textarea value={nostrRelays} onChange={e => setNostrRelays(e.target.value)} placeholder={"wss://relay.damus.io\nwss://nos.lol"} className={cn(inputClass, "h-[70px] resize-y mb-3")} />
            <label className={cn(kpiLabel, "block mb-1")}>Public Keys to follow (optional, one per line)</label>
            <textarea value={nostrPubkeys} onChange={e => setNostrPubkeys(e.target.value)} placeholder="npub or hex pubkey..." className={cn(inputClass, "h-[50px] resize-y mb-3")} />
            <div className="flex gap-2">
              <button onClick={fetchNostr} disabled={nostrLoading} className={btnClass(nostrLoading, nostrLoading)}>
                {nostrLoading ? "Fetching..." : "Fetch Latest"}
              </button>
              {isAuthenticated && (
                <button onClick={handleSaveNostr} className={saveBtnClass}>
                  Save Relay Config
                </button>
              )}
            </div>
            {nostrError && <div className="text-body-sm text-red-400 mt-2">{nostrError}</div>}
            {nostrResult && (
              <div className="mt-4">
                <div className="text-h3 font-semibold text-secondary-foreground mb-3">{nostrResult.events.length} events found</div>
                {nostrResult.events.map(event => (
                  <div key={event.id} className="bg-navy-lighter rounded-md p-3 mb-1">
                    <div className="flex justify-between items-start gap-3">
                      <div className="flex-1">
                        <div className="text-caption text-purple-400 font-mono">{event.pubkey.slice(0, 12)}...{event.pubkey.slice(-8)}</div>
                        <div className="text-body-sm text-tertiary leading-normal mt-1">{event.content}</div>
                        <div className="text-caption text-muted-foreground mt-1">{new Date(event.createdAt * 1000).toLocaleString()}</div>
                      </div>
                      <button onClick={() => handleAnalyzeOnce(event.content)} disabled={isAnalyzing || analyzedUrls.has(event.content.slice(0, 200))} className={cn(btnClass(isAnalyzing || analyzedUrls.has(event.content.slice(0, 200)), false), "!px-3 !py-1.5 !text-caption")}>
                        {analyzedUrls.has(event.content.slice(0, 200)) ? "Done" : "Analyze"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Popular Sources Catalog */}
      <div data-testid="aegis-sources-catalog" className={cn("bg-card border border-border rounded-lg mt-5 mb-5", mobile ? "p-4" : "p-5")}>
        <div className="text-h3 font-semibold text-secondary-foreground mb-1">
          Popular Sources
        </div>
        <div className="text-caption text-muted-foreground mb-3">
          Add trusted feeds with a single tap
        </div>

        {/* Category filter chips */}
        <div className="flex gap-1 mb-3 flex-wrap">
          {([{ id: "all" as const, label: "All", emoji: "" }, ...CATALOG_CATEGORIES] as const).map(cat => {
            const isAll = cat.id === "all";
            const active = catalogFilter === cat.id;
            const chipColor = isAll ? colors.text.muted : POPULAR_SOURCES.find(s => s.category === cat.id)?.color ?? colors.text.muted;
            return (
              <button
                key={cat.id}
                onClick={() => setCatalogFilter(cat.id)}
                className="flex items-center gap-1 px-3 py-1 rounded-sm text-caption font-semibold cursor-pointer font-[inherit] transition-fast border"
                style={{
                  background: active ? `${chipColor}18` : undefined,
                  borderColor: active ? `${chipColor}40` : undefined,
                  color: active ? chipColor : undefined,
                }}
              >
                {cat.emoji ? `${cat.emoji} ` : ""}{cat.label}
              </button>
            );
          })}
        </div>

        {/* Source grid */}
        <div className={cn("grid gap-2", mobile ? "grid-cols-2" : "grid-cols-3")}>
          {POPULAR_SOURCES
            .filter(s => catalogFilter === "all" || s.category === catalogFilter)
            .map(source => {
              const isAdded = addedFeedUrls.has(source.feedUrl);
              const justAdded = justAddedIds.has(source.id);
              return (
                <button
                  key={source.id}
                  onClick={() => handleCatalogAdd(source)}
                  disabled={isAdded || isDemoMode}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-md font-[inherit] transition-fast text-left w-full border",
                    (isAdded || isDemoMode) ? "cursor-default" : "cursor-pointer",
                    isAdded && "opacity-60",
                  )}
                  style={{
                    borderColor: isAdded ? `${colors.green[400]}30` : `${source.color}30`,
                    background: isAdded
                      ? `${colors.green[400]}08`
                      : justAdded ? `${colors.green[400]}15` : `${source.color}08`,
                  }}
                >
                  <span className="text-[16px] shrink-0 leading-none">
                    {isAdded ? <CheckIcon /> : source.emoji}
                  </span>
                  <span className={cn(
                    "text-body-sm font-semibold overflow-hidden text-ellipsis whitespace-nowrap",
                    isAdded ? "text-green-400" : "text-secondary-foreground"
                  )}>
                    {source.label}
                  </span>
                </button>
              );
            })}
        </div>
      </div>

      {/* Source auto-suggestions */}
      {feedSuggestions.length > 0 && (
          <div className={cn("bg-blue-500/[0.06] border border-blue-500/15 rounded-lg mb-4", mobile ? "p-4" : "p-5")}>
            <div className="text-body-sm font-semibold text-blue-400 mb-3">
              &#x1F4A1; Suggested Sources
            </div>
            {feedSuggestions.map(s => (
              <div key={s.domain} className="flex items-center gap-3 py-2 border-t border-subtle">
                <div className="flex-1">
                  <div className="text-body-sm text-secondary-foreground font-semibold">
                    {s.domain}
                  </div>
                  <div className="text-caption text-disabled">
                    {s.count} validated items from this domain
                  </div>
                </div>
                {s.discoveredFeedUrl ? (
                  <button
                    onClick={() => {
                      addSource({ type: "rss", label: s.domain, feedUrl: s.discoveredFeedUrl!, enabled: true });
                      setFeedSuggestions(prev => prev.filter(p => p.domain !== s.domain));
                    }}
                    className="px-3 py-1 bg-blue-400 border-none rounded-sm text-white text-caption font-semibold cursor-pointer font-[inherit] whitespace-nowrap"
                  >
                    Add Feed
                  </button>
                ) : (
                  <span className="text-caption text-disabled">No feed found</span>
                )}
                <button
                  onClick={() => {
                    dismissSuggestion(s.domain);
                    setFeedSuggestions(prev => prev.filter(p => p.domain !== s.domain));
                  }}
                  className="bg-transparent border-none text-disabled text-caption cursor-pointer font-[inherit]"
                >
                  Dismiss
                </button>
              </div>
            ))}
          </div>
        )}

      {/* Saved Sources List */}
      {sources.length > 0 && (
        <div className={cn("bg-card border border-border rounded-lg mb-5", mobile ? "p-4" : "p-5")}>
          <div className="flex items-center gap-3 text-h3 font-semibold text-secondary-foreground mb-3">
            <span>Saved Sources ({sources.length})</span>
            {syncStatus === "syncing" && <span className="text-caption text-sky-400 font-semibold">syncing...</span>}
            {syncStatus === "synced" && <span className="text-caption text-green-400 font-semibold">synced</span>}
            {syncStatus === "error" && <span className="text-caption text-red-400 font-semibold">sync error{syncError ? `: ${syncError}` : ""}</span>}
          </div>
          {sources.map(s => {
            const stateKey = getStateKey(s);
            const state = sourceStates[stateKey];
            const health = state ? getSourceHealth(state) : "healthy";

            return (
              <div key={s.id} className="mb-1">
                <div className={cn(
                  "flex items-center gap-3 px-3 py-2",
                  editingId === s.id ? "rounded-t-sm" : "rounded-sm",
                  s.enabled
                    ? (s.type === "rss" ? "bg-amber-400/[0.03]" : "bg-purple-400/[0.03]")
                    : "bg-transparent"
                )}>
                  {/* Health-aware toggle */}
                  <button
                    onClick={() => toggleSource(s.id)}
                    className={cn(
                      "size-[18px] rounded-full border-none cursor-pointer shrink-0 p-0",
                      s.enabled ? (HEALTH_BG[health] || "bg-border") : "bg-border"
                    )}
                    title={s.enabled ? (health === "rate_limited" ? "Rate limited — retrying soon" : `${health} — click to disable`) : "Enable"}
                  />
                  <div className="flex-1 min-w-0">
                    <div className={cn(
                      "text-body-sm font-semibold overflow-hidden text-ellipsis whitespace-nowrap",
                      s.enabled ? "text-secondary-foreground" : "text-disabled"
                    )}>
                      {s.label}
                    </div>
                    <div className="text-tiny text-muted-foreground">
                      {s.type === "rss" ? s.feedUrl : `${(s.relays || []).length} relays · ${(s.pubkeys || []).length} keys`}
                    </div>
                    {/* Runtime stats */}
                    {state && (
                      <div className="text-tiny text-disabled mt-0.5">
                        {state.lastFetchedAt > 0 && (
                          <span>Last fetch: {relativeTime(state.lastFetchedAt)}</span>
                        )}
                        {state.totalItemsScored > 0 && (
                          <span> · {state.totalItemsScored} scored · avg {state.averageScore.toFixed(1)}</span>
                        )}
                        {state.itemsFetched > 0 && !state.totalItemsScored && (
                          <span> · {state.itemsFetched} items</span>
                        )}
                      </div>
                    )}
                    {/* Rate limit notice */}
                    {state && health === "rate_limited" && (
                      <div className="text-tiny text-sky-400 mt-0.5">
                        Rate limited — retries automatically in {formatRetryCountdown(state.rateLimitedUntil)}
                      </div>
                    )}
                    {/* Error message */}
                    {state && state.errorCount > 0 && health !== "rate_limited" && (
                      <div className="text-tiny text-red-400 mt-0.5 flex items-center gap-1.5">
                        <span>
                          {state.errorCount >= 5 ? "Auto-disabled: " : `Error (${state.errorCount}x): `}
                          {state.lastError}
                        </span>
                        {state.errorCount >= 5 && !isDemoMode && (
                          <button
                            onClick={() => { resetSourceErrors(stateKey); setSourceStates(loadSourceStates()); }}
                            className="bg-transparent border border-amber-400 rounded-sm text-amber-400 text-tiny font-semibold px-1.5 py-px cursor-pointer font-[inherit] whitespace-nowrap"
                          >
                            Retry
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <span className={cn(
                    "text-tiny font-bold uppercase tracking-[1px]",
                    platformBadgeClass(s.platform, s.type)
                  )}>
                    {s.platform || s.type}
                  </span>
                  {!isDemoMode && <button
                    onClick={() => editingId === s.id ? cancelEdit() : startEdit(s)}
                    className={cn(
                      "bg-transparent border-none cursor-pointer px-1.5 py-0.5 text-caption font-[inherit] transition-fast",
                      editingId === s.id ? "text-blue-400" : "text-disabled"
                    )}
                    title="Edit source"
                  >
                    &#x270E;
                  </button>}
                  {!isDemoMode && <button
                    onClick={() => removeSource(s.id)}
                    className="bg-transparent border-none cursor-pointer px-1.5 py-0.5 text-caption text-disabled font-[inherit] transition-fast"
                    title="Remove source"
                  >
                    &#x2715;
                  </button>}
                </div>

                {/* Inline Editor */}
                {editingId === s.id && (
                  <div className="bg-navy-lighter border border-border border-t-0 rounded-b-sm px-4 py-3">
                    <div className="mb-3">
                      <label className={cn(kpiLabel, "block mb-1")}>Label</label>
                      <input value={editLabel} onChange={e => setEditLabel(e.target.value)} className={cn(inputClass, "px-3 py-2")} />
                    </div>

                    {s.type === "rss" && (
                      <div className="mb-3">
                        <label className={cn(kpiLabel, "block mb-1")}>Feed URL</label>
                        <input value={editFeedUrl} onChange={e => setEditFeedUrl(e.target.value)} className={cn(inputClass, "px-3 py-2")} />
                      </div>
                    )}

                    {s.type === "nostr" && (
                      <>
                        <div className="mb-3">
                          <label className={cn(kpiLabel, "block mb-1")}>Relays ({editRelays.length})</label>
                          {editRelays.map((relay, i) => (
                            <div key={relay} className="flex items-center gap-2 mb-0.5">
                              <span className="flex-1 text-body-sm text-tertiary font-mono overflow-hidden text-ellipsis whitespace-nowrap">{relay}</span>
                              <button
                                onClick={() => setEditRelays(prev => prev.filter((_, idx) => idx !== i))}
                                className="bg-transparent border-none cursor-pointer px-1 py-px text-caption text-red-400 font-[inherit]"
                              >&#x2715;</button>
                            </div>
                          ))}
                          <div className="flex gap-2 mt-1">
                            <input
                              value={editNewRelay}
                              onChange={e => setEditNewRelay(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter" && editNewRelay.trim()) {
                                  setEditRelays(prev => [...prev, editNewRelay.trim()]);
                                  setEditNewRelay("");
                                }
                              }}
                              placeholder="wss://relay.example.com"
                              className={cn(inputClass, "flex-1 px-3 py-1 text-body-sm")}
                            />
                            <button
                              onClick={() => {
                                if (editNewRelay.trim()) {
                                  setEditRelays(prev => [...prev, editNewRelay.trim()]);
                                  setEditNewRelay("");
                                }
                              }}
                              className="bg-transparent border border-border rounded-sm cursor-pointer px-3 py-1 text-body-sm text-muted-foreground font-[inherit]"
                            >+ Add</button>
                          </div>
                        </div>

                        <div className="mb-3">
                          <label className={cn(kpiLabel, "block mb-1")}>Public Keys ({editPubkeys.length})</label>
                          {editPubkeys.map((pk, i) => (
                            <div key={pk} className="flex items-center gap-2 mb-0.5">
                              <span className="flex-1 text-body-sm text-tertiary font-mono overflow-hidden text-ellipsis whitespace-nowrap">{pk}</span>
                              <button
                                onClick={() => setEditPubkeys(prev => prev.filter((_, idx) => idx !== i))}
                                className="bg-transparent border-none cursor-pointer px-1 py-px text-caption text-red-400 font-[inherit]"
                              >&#x2715;</button>
                            </div>
                          ))}
                          <div className="flex gap-2 mt-1">
                            <input
                              value={editNewPubkey}
                              onChange={e => setEditNewPubkey(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter" && editNewPubkey.trim()) {
                                  setEditPubkeys(prev => [...prev, editNewPubkey.trim()]);
                                  setEditNewPubkey("");
                                }
                              }}
                              placeholder="npub or hex pubkey"
                              className={cn(inputClass, "flex-1 px-3 py-1 text-body-sm")}
                            />
                            <button
                              onClick={() => {
                                if (editNewPubkey.trim()) {
                                  setEditPubkeys(prev => [...prev, editNewPubkey.trim()]);
                                  setEditNewPubkey("");
                                }
                              }}
                              className="bg-transparent border border-border rounded-sm cursor-pointer px-3 py-1 text-body-sm text-muted-foreground font-[inherit]"
                            >+ Add</button>
                          </div>
                        </div>
                      </>
                    )}

                    <div className="flex gap-2 justify-end">
                      <button onClick={cancelEdit} className="bg-transparent border border-border rounded-sm cursor-pointer px-4 py-2 text-body-sm text-muted-foreground font-[inherit]">Cancel</button>
                      <button onClick={saveEdit} className={saveBtnClass}>Save</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
