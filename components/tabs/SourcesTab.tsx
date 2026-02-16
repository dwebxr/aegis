"use client";
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { fonts, colors, space, type as t, radii, transitions, kpiLabelStyle } from "@/styles/theme";
import { RSSIcon, GlobeIcon, LinkIcon, GitHubIcon, CheckIcon } from "@/components/icons";
import { POPULAR_SOURCES, CATALOG_CATEGORIES, type CatalogCategory } from "@/lib/sources/catalog";
import type { AnalyzeResponse } from "@/lib/types/api";
import type { FetchURLResponse, FetchRSSResponse, FetchTwitterResponse, FetchNostrResponse } from "@/lib/types/api";

import { useSources } from "@/contexts/SourceContext";
import { useAuth } from "@/contexts/AuthContext";
import { useDemo } from "@/contexts/DemoContext";
import { parseGitHubRepo, parseBlueskyHandle, buildTopicFeedUrl } from "@/lib/sources/platformFeed";
import { loadSourceStates, type SourceRuntimeState, getSourceHealth, getSourceKey } from "@/lib/ingestion/sourceState";
import { relativeTime } from "@/lib/utils/scores";

function isTimeout(err: unknown): boolean {
  return err instanceof DOMException && err.name === "TimeoutError";
}

interface SourcesTabProps {
  onAnalyze: (text: string, meta?: { sourceUrl?: string; imageUrl?: string }) => Promise<AnalyzeResponse>;
  isAnalyzing: boolean;
  mobile?: boolean;
}

type QuickAddId = "youtube" | "topic" | "github" | "bluesky";

const QUICK_ADD_PRESETS: ReadonlyArray<{
  id: QuickAddId; icon: string; label: string; color: string;
  formLabel: string; placeholder: string; hint: string;
}> = [
  { id: "youtube", icon: "\u25B6", label: "YouTube", color: colors.red[400], formLabel: "YouTube Channel URL", placeholder: "https://youtube.com/@channelname", hint: "Paste a channel URL \u2014 we\u2019ll find the RSS feed automatically" },
  { id: "topic", icon: "\uD83D\uDCF0", label: "Topic", color: colors.amber[400], formLabel: "Search Keywords", placeholder: "AI safety, machine learning", hint: "Creates a Google News RSS feed for these keywords" },
  { id: "github", icon: "", label: "GitHub", color: colors.text.secondary, formLabel: "GitHub Repository", placeholder: "owner/repo or https://github.com/owner/repo", hint: "Subscribes to release notifications for this repository" },
  { id: "bluesky", icon: "\uD83E\uDD8B", label: "Bluesky", color: colors.sky[400], formLabel: "Bluesky Handle", placeholder: "@handle.bsky.social", hint: "Subscribes to this account\u2019s posts via Bluesky native RSS" },
];

const HEALTH_COLORS: Record<string, string> = {
  healthy: colors.green[400],
  degraded: colors.amber[400],
  error: colors.red[400],
  disabled: colors.text.disabled,
};

export const SourcesTab: React.FC<SourcesTabProps> = ({ onAnalyze, isAnalyzing, mobile }) => {
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

  // Popular Sources catalog
  const [catalogFilter, setCatalogFilter] = useState<CatalogCategory | "all">("all");
  const [justAddedIds, setJustAddedIds] = useState<Set<string>>(new Set());
  const addedFeedUrls = useMemo(
    () => new Set(sources.filter(s => s.type === "rss" && s.feedUrl).map(s => s.feedUrl!)),
    [sources],
  );

  const [sourceStates, setSourceStates] = useState<Record<string, SourceRuntimeState>>({});
  useEffect(() => {
    const refresh = () => setSourceStates(loadSourceStates());
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, []);

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
        const data = await res.json().catch(() => ({}));
        setRssError(data.error || "Feed discovery failed");
      }
    } catch (err) {
      setRssError(isTimeout(err) ? "Request timed out — try again" : "Network error — could not discover feeds");
    } finally {
      setDiscoverLoading(false);
    }
  }, []);

  const fetchUrl = async () => {
    if (!urlInput.trim()) return;
    setUrlLoading(true); setUrlError(""); setUrlResult(null);
    try {
      const res = await fetch("/api/fetch/url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: urlInput }), signal: AbortSignal.timeout(20_000) });
      const data = await res.json();
      if (!res.ok) { setUrlError(data.error || "Failed to extract"); return; }
      setUrlResult(data);
    } catch (err) { setUrlError(isTimeout(err) ? "Request timed out — try again" : "Network error — check connection"); } finally { setUrlLoading(false); }
  };

  const fetchRss = async () => {
    if (!rssInput.trim()) return;
    setRssLoading(true); setRssError(""); setRssResult(null);
    try {
      const res = await fetch("/api/fetch/rss", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feedUrl: rssInput, limit: 10 }), signal: AbortSignal.timeout(15_000) });
      const data = await res.json();
      if (!res.ok) { setRssError(data.error || "Failed to parse feed"); return; }
      setRssResult(data);
    } catch (err) { setRssError(isTimeout(err) ? "Request timed out — try again" : "Network error — check connection"); } finally { setRssLoading(false); }
  };

  const fetchTwitter = async () => {
    if (!twitterToken.trim() || !twitterQuery.trim()) return;
    setTwitterLoading(true); setTwitterError(""); setTwitterResult(null);
    try {
      const res = await fetch("/api/fetch/twitter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bearerToken: twitterToken, query: twitterQuery, maxResults: 10 }), signal: AbortSignal.timeout(20_000) });
      const data = await res.json();
      if (!res.ok) { setTwitterError(data.error || "Failed to fetch tweets"); return; }
      setTwitterResult(data);
    } catch (err) { setTwitterError(isTimeout(err) ? "Request timed out — try again" : "Network error — check connection"); } finally { setTwitterLoading(false); }
  };

  const fetchNostr = async () => {
    setNostrLoading(true); setNostrError(""); setNostrResult(null);
    try {
      const relays = nostrRelays.split("\n").map(r => r.trim()).filter(Boolean);
      const pubkeys = nostrPubkeys.split("\n").map(p => p.trim()).filter(Boolean);
      const res = await fetch("/api/fetch/nostr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ relays, pubkeys: pubkeys.length > 0 ? pubkeys : undefined, limit: 20 }), signal: AbortSignal.timeout(15_000) });
      const data = await res.json();
      if (!res.ok) { setNostrError(data.error || "Failed to fetch events"); return; }
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
    const added = addSource({ type: "rss", label: rssResult.feedTitle || rssInput, feedUrl: rssInput, enabled: true });
    if (!added) { setRssError("This feed is already saved"); return; }
    setRssInput(""); setRssResult(null);
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
        const data = await res.json();
        if (!res.ok) {
          setRssInput("");
          if (quickAddMode === "topic") {
            setRssError("Google News may be blocking this request. Try different keywords or paste a direct RSS URL instead.");
          } else {
            setRssError(data.error || "Failed to parse feed");
          }
          return;
        }
        setRssResult({ ...data, feedTitle: data.feedTitle || label });
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

  const sourceTabs: Array<{ id: "url" | "rss" | "twitter" | "nostr"; label: string; icon: React.ReactNode; color: string }> = [
    { id: "url", label: "URL", icon: <LinkIcon s={14} />, color: colors.sky[400] },
    { id: "rss", label: "RSS", icon: <RSSIcon s={14} />, color: colors.amber[400] },
    { id: "twitter", label: "X (Twitter)", icon: <span style={{ fontSize: 14 }}>{"\u{1D54F}"}</span>, color: colors.text.secondary },
    { id: "nostr", label: "Nostr", icon: <GlobeIcon s={14} />, color: colors.purple[400] },
  ];

  const inputStyle: React.CSSProperties = {
    width: "100%", background: colors.bg.raised, border: `1px solid ${colors.border.default}`,
    borderRadius: radii.md, padding: `${space[3]}px ${space[4]}px`, color: colors.text.secondary, fontSize: t.body.mobileSz,
    fontFamily: "inherit", outline: "none", boxSizing: "border-box",
  };

  const btnStyle = (disabled: boolean, loading: boolean): React.CSSProperties => ({
    padding: `${space[3]}px ${space[5]}px`,
    background: loading ? "rgba(56,189,248,0.1)" : `linear-gradient(135deg,${colors.blue[600]},${colors.blue[700]})`,
    border: "none", borderRadius: radii.md, color: "#fff", fontSize: t.body.mobileSz, fontWeight: 700,
    cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1, whiteSpace: "nowrap",
    transition: transitions.fast,
  });

  const saveBtnStyle: React.CSSProperties = {
    padding: `${space[2]}px ${space[4]}px`,
    background: `linear-gradient(135deg,${colors.green[500]},${colors.green[400]})`,
    border: "none", borderRadius: radii.md, color: "#fff", fontSize: t.bodySm.size, fontWeight: 700,
    cursor: "pointer", transition: transitions.fast, fontFamily: "inherit",
  };

  const errorStyle: React.CSSProperties = { fontSize: t.bodySm.size, color: colors.red[400], marginTop: space[2] };
  const labelStyle: React.CSSProperties = { ...kpiLabelStyle, display: "block", marginBottom: space[1] };

  return (
    <div style={{ animation: "fadeIn .4s ease" }}>
      <div style={{ marginBottom: mobile ? space[8] : space[12] }}>
        <h1 style={{
          fontSize: mobile ? t.display.mobileSz : t.display.size,
          fontWeight: t.display.weight,
          lineHeight: t.display.lineHeight,
          letterSpacing: t.display.letterSpacing,
          color: colors.text.primary,
          margin: 0,
        }}>
          Content Sources
        </h1>
        <p style={{ fontSize: mobile ? t.body.mobileSz : t.body.size, color: colors.text.muted, marginTop: space[1] }}>
          Configure where to find content for evaluation
        </p>
      </div>

      {isDemoMode && (
        <div style={{
          background: "rgba(37,99,235,0.04)", border: "1px solid rgba(37,99,235,0.15)",
          borderRadius: radii.lg, padding: `${space[3]}px ${space[5]}px`, marginBottom: space[3],
          fontSize: t.bodySm.size, color: colors.blue[400], fontWeight: 600,
        }}>
          Demo sources are read-only. Login to add your own feeds.
        </div>
      )}

      {!isAuthenticated && !isDemoMode && sources.length === 0 && (
        <div style={{
          background: colors.bg.surface, border: `1px solid ${colors.border.default}`,
          borderRadius: radii.lg, padding: space[5], marginBottom: space[5],
          textAlign: "center", color: colors.text.muted, fontSize: t.bodySm.size,
        }}>
          Log in to save sources for automatic fetching
        </div>
      )}

      <div style={{ display: "flex", gap: space[1], marginBottom: space[5], flexWrap: "wrap" }}>
        {sourceTabs.map(s => (
          <button key={s.id} onClick={() => setActiveSource(s.id)} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: `${space[2]}px ${space[4]}px`, borderRadius: radii.sm, fontSize: t.bodySm.size, fontWeight: 600,
            cursor: "pointer", transition: transitions.fast,
            background: activeSource === s.id ? `${s.color}18` : colors.border.subtle,
            border: activeSource === s.id ? `1px solid ${s.color}40` : `1px solid ${colors.border.subtle}`,
            color: activeSource === s.id ? s.color : colors.text.muted,
            fontFamily: "inherit",
          }}>
            {s.icon} {s.label}
          </button>
        ))}
      </div>

      <div style={{
        background: colors.bg.surface,
        border: `1px solid ${colors.border.default}`,
        borderRadius: radii.xl,
        padding: mobile ? space[5] : space[8],
      }}>
        {activeSource === "url" && (
          <div>
            <label style={labelStyle}>Article URL</label>
            <div style={{ display: "flex", gap: space[2] }}>
              <input value={urlInput} onChange={e => setUrlInput(e.target.value)} placeholder="https://example.com/article" style={{ ...inputStyle, flex: 1 }} />
              <button onClick={fetchUrl} disabled={urlLoading || !urlInput.trim()} style={btnStyle(!urlInput.trim(), urlLoading)}>
                {urlLoading ? "Extracting..." : "Extract"}
              </button>
            </div>
            {urlError && <div style={errorStyle}>{urlError}</div>}
            {urlResult && (
              <div style={{ marginTop: space[4], background: colors.bg.raised, borderRadius: radii.md, padding: space[4] }}>
                <div style={{ display: "flex", gap: space[3], marginBottom: space[3] }}>
                  {urlResult.imageUrl && (
                    /* eslint-disable-next-line @next/next/no-img-element -- external user-content URLs */
                    <img
                      src={urlResult.imageUrl}
                      alt=""
                      style={{ width: 100, height: 100, objectFit: "cover", borderRadius: radii.sm, border: `1px solid ${colors.border.default}`, flexShrink: 0 }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: t.body.size, fontWeight: 700, color: colors.text.secondary, marginBottom: space[1] }}>{urlResult.title}</div>
                    <div style={{ fontSize: t.caption.size, color: colors.text.muted, marginBottom: space[2] }}>by {urlResult.author} &middot; {urlResult.source}</div>
                    <a href={urlInput} target="_blank" rel="noopener noreferrer" style={{ fontSize: t.caption.size, color: colors.blue[400], textDecoration: "none", fontWeight: 600 }}>
                      Open original &rarr;
                    </a>
                  </div>
                </div>
                <div style={{ fontSize: t.body.mobileSz, color: colors.text.tertiary, lineHeight: 1.6, maxHeight: 200, overflow: "auto", marginBottom: space[3] }}>{urlResult.content.slice(0, 1000)}{urlResult.content.length > 1000 ? "..." : ""}</div>
                <button onClick={() => handleAnalyzeOnce(urlResult.content, { sourceUrl: urlInput, imageUrl: urlResult.imageUrl })} disabled={isAnalyzing || analyzedUrls.has(urlInput)} style={btnStyle(isAnalyzing || analyzedUrls.has(urlInput), isAnalyzing)}>
                  {analyzedUrls.has(urlInput) ? "Already Analyzed" : isAnalyzing ? "Analyzing..." : "Analyze This Content"}
                </button>
              </div>
            )}
          </div>
        )}

        {activeSource === "rss" && (
          <div>
            <label style={labelStyle}>RSS Feed URL</label>
            <div style={{ display: "flex", gap: space[2] }}>
              <input
                value={rssInput}
                onChange={e => {
                  setRssInput(e.target.value);
                  setDiscoveredFeeds([]);
                }}
                placeholder="https://example.com/feed.xml \u2014 blogs, podcasts, any RSS/Atom feed"
                style={{ ...inputStyle, flex: 1 }}
              />
              <button onClick={fetchRss} disabled={rssLoading || !rssInput.trim()} style={btnStyle(!rssInput.trim(), rssLoading)}>
                {rssLoading ? "Fetching..." : "Fetch Feed"}
              </button>
            </div>

            {/* Feed auto-discovery */}
            {rssInput.trim() && !rssResult && !rssLoading && (
              <div style={{ marginTop: space[2] }}>
                <button
                  onClick={() => discoverFeed(rssInput)}
                  disabled={discoverLoading}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    fontSize: t.caption.size, color: colors.blue[400], fontWeight: 600,
                    fontFamily: "inherit", padding: 0, opacity: discoverLoading ? 0.5 : 1,
                  }}
                >
                  {discoverLoading ? "Discovering feeds..." : "Not a feed URL? Auto-discover feeds"}
                </button>
                {discoveredFeeds.length > 0 && (
                  <div style={{ marginTop: space[2], display: "flex", gap: space[2], flexWrap: "wrap" }}>
                    {discoveredFeeds.map((f, i) => (
                      <button
                        key={i}
                        onClick={() => { setRssInput(f.url); setDiscoveredFeeds([]); }}
                        style={{
                          padding: `${space[1]}px ${space[3]}px`,
                          background: `${colors.amber[400]}15`,
                          border: `1px solid ${colors.amber[400]}40`,
                          borderRadius: radii.sm,
                          fontSize: t.caption.size,
                          color: colors.amber[400],
                          cursor: "pointer",
                          fontFamily: "inherit",
                          fontWeight: 600,
                        }}
                      >
                        {f.title || f.url}
                        {f.type && <span style={{ opacity: 0.6, marginLeft: 4 }}>({f.type})</span>}
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
                <div style={{ marginTop: space[3] }}>
                  <div style={{ ...kpiLabelStyle, marginBottom: space[2] }}>Quick Add</div>
                  <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
                    {QUICK_ADD_PRESETS.map(p => (
                      <button
                        key={p.id}
                        onClick={() => { setQuickAddMode(quickAddMode === p.id ? "" : p.id); setQuickAddInput(""); setQuickAddError(""); setRssError(""); }}
                        style={{
                          display: "flex", alignItems: "center", gap: 4,
                          padding: `${space[1]}px ${space[3]}px`, borderRadius: radii.sm,
                          fontSize: t.caption.size, fontWeight: 600, cursor: "pointer",
                          background: quickAddMode === p.id ? `${p.color}18` : colors.border.subtle,
                          border: quickAddMode === p.id ? `1px solid ${p.color}40` : `1px solid ${colors.border.subtle}`,
                          color: quickAddMode === p.id ? p.color : colors.text.muted,
                          fontFamily: "inherit", transition: transitions.fast,
                        }}
                      >
                        {p.id === "github" ? <GitHubIcon s={12} /> : <span>{p.icon}</span>} {p.label}
                      </button>
                    ))}
                  </div>

                  {activePreset && (
                    <div style={{ marginTop: space[3], background: colors.bg.raised, borderRadius: radii.md, padding: space[4] }}>
                      <label style={{ ...kpiLabelStyle, display: "block", marginBottom: space[1] }}>{activePreset.formLabel}</label>
                      <div style={{ display: "flex", gap: space[2] }}>
                        <input
                          value={quickAddInput}
                          onChange={e => { setQuickAddInput(e.target.value); setQuickAddError(""); }}
                          onKeyDown={e => { if (e.key === "Enter" && quickAddInput.trim()) handleQuickAdd(); }}
                          placeholder={activePreset.placeholder}
                          style={{ ...inputStyle, flex: 1 }}
                        />
                        <button
                          onClick={handleQuickAdd}
                          disabled={quickAddLoading || !quickAddInput.trim()}
                          style={btnStyle(!quickAddInput.trim(), quickAddLoading)}
                        >
                          {quickAddLoading ? "Adding..." : "Add Feed"}
                        </button>
                      </div>
                      <div style={{ fontSize: t.caption.size, color: colors.text.muted, marginTop: space[1] }}>{activePreset.hint}</div>
                      {quickAddError && <div style={errorStyle}>{quickAddError}</div>}
                    </div>
                  )}
                </div>
              );
            })()}

            {rssError && <div style={errorStyle}>{rssError}</div>}
            {rssResult && (
              <div style={{ marginTop: space[4] }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: space[3] }}>
                  <div style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.text.tertiary }}>{rssResult.feedTitle} ({rssResult.items.length} items)</div>
                  {isAuthenticated && (
                    <button onClick={handleSaveRss} style={saveBtnStyle}>
                      Save as Source
                    </button>
                  )}
                </div>
                {rssResult.items.map((item, i) => (
                  <div key={i} style={{ background: colors.bg.raised, borderRadius: radii.md, padding: space[3], marginBottom: space[1], display: "flex", alignItems: "center", gap: space[3] }}>
                    {item.imageUrl && (
                      /* eslint-disable-next-line @next/next/no-img-element -- external user-content URLs */
                      <img
                        src={item.imageUrl}
                        alt=""
                        style={{ width: 48, height: 48, objectFit: "cover", borderRadius: radii.sm, border: `1px solid ${colors.border.default}`, flexShrink: 0 }}
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {item.link ? (
                        <a href={item.link} target="_blank" rel="noopener noreferrer" style={{ fontSize: t.body.mobileSz, color: colors.text.secondary, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block", textDecoration: "none" }}>{item.title}</a>
                      ) : (
                        <div style={{ fontSize: t.body.mobileSz, color: colors.text.secondary, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
                      )}
                      <div style={{ fontSize: t.caption.size, color: colors.text.muted }}>{item.author} &middot; {item.publishedDate}</div>
                    </div>
                    <button onClick={() => handleAnalyzeOnce(item.content || item.title, { sourceUrl: item.link || undefined, imageUrl: item.imageUrl })} disabled={isAnalyzing || !!(item.link && analyzedUrls.has(item.link))} style={{ ...btnStyle(isAnalyzing || !!(item.link && analyzedUrls.has(item.link)), false), padding: `6px ${space[3]}px`, fontSize: t.caption.size, flexShrink: 0 }}>
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
            <label style={labelStyle}>X API Bearer Token</label>
            <input type="password" value={twitterToken} onChange={e => setTwitterToken(e.target.value)} placeholder="Your X API Bearer Token" style={{ ...inputStyle, marginBottom: space[3] }} />
            <label style={labelStyle}>Search Query</label>
            <div style={{ display: "flex", gap: space[2] }}>
              <input value={twitterQuery} onChange={e => setTwitterQuery(e.target.value)} placeholder="AI research -is:retweet lang:en" style={{ ...inputStyle, flex: 1 }} />
              <button onClick={fetchTwitter} disabled={twitterLoading || !twitterToken.trim() || !twitterQuery.trim()} style={btnStyle(!twitterToken.trim() || !twitterQuery.trim(), twitterLoading)}>
                {twitterLoading ? "Searching..." : "Search"}
              </button>
            </div>
            <div style={{ fontSize: t.caption.size, color: colors.text.muted, marginTop: space[1] }}>Your token is sent per-request only and never stored on our servers.</div>
            {twitterError && <div style={errorStyle}>{twitterError}</div>}
            {twitterResult && (
              <div style={{ marginTop: space[4] }}>
                <div style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.text.tertiary, marginBottom: space[3] }}>{twitterResult.tweets.length} tweets found</div>
                {twitterResult.tweets.map(tweet => (
                  <div key={tweet.id} style={{ background: colors.bg.raised, borderRadius: radii.md, padding: space[3], marginBottom: space[1] }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: space[3] }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: t.bodySm.size, color: colors.text.secondary, fontWeight: 600, fontFamily: fonts.mono }}>{tweet.authorHandle}</div>
                        <div style={{ fontSize: t.body.mobileSz, color: colors.text.tertiary, lineHeight: 1.5, marginTop: space[1] }}>{tweet.text}</div>
                        <div style={{ fontSize: t.caption.size, color: colors.text.muted, marginTop: space[1] }}>{tweet.createdAt}</div>
                      </div>
                      <button onClick={() => handleAnalyzeOnce(tweet.text)} disabled={isAnalyzing || analyzedUrls.has(tweet.text.slice(0, 200))} style={{ ...btnStyle(isAnalyzing || analyzedUrls.has(tweet.text.slice(0, 200)), false), padding: `6px ${space[3]}px`, fontSize: t.caption.size }}>
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
            <label style={labelStyle}>Relay URLs (one per line)</label>
            <textarea value={nostrRelays} onChange={e => setNostrRelays(e.target.value)} placeholder={"wss://relay.damus.io\nwss://nos.lol"} style={{ ...inputStyle, height: 70, resize: "vertical", marginBottom: space[3] }} />
            <label style={labelStyle}>Public Keys to follow (optional, one per line)</label>
            <textarea value={nostrPubkeys} onChange={e => setNostrPubkeys(e.target.value)} placeholder="npub or hex pubkey..." style={{ ...inputStyle, height: 50, resize: "vertical", marginBottom: space[3] }} />
            <div style={{ display: "flex", gap: space[2] }}>
              <button onClick={fetchNostr} disabled={nostrLoading} style={btnStyle(nostrLoading, nostrLoading)}>
                {nostrLoading ? "Fetching..." : "Fetch Latest"}
              </button>
              {isAuthenticated && (
                <button onClick={handleSaveNostr} style={saveBtnStyle}>
                  Save Relay Config
                </button>
              )}
            </div>
            {nostrError && <div style={errorStyle}>{nostrError}</div>}
            {nostrResult && (
              <div style={{ marginTop: space[4] }}>
                <div style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.text.tertiary, marginBottom: space[3] }}>{nostrResult.events.length} events found</div>
                {nostrResult.events.map(event => (
                  <div key={event.id} style={{ background: colors.bg.raised, borderRadius: radii.md, padding: space[3], marginBottom: space[1] }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: space[3] }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: t.caption.size, color: colors.purple[400], fontFamily: fonts.mono }}>{event.pubkey.slice(0, 12)}...{event.pubkey.slice(-8)}</div>
                        <div style={{ fontSize: t.body.mobileSz, color: colors.text.tertiary, lineHeight: 1.5, marginTop: space[1] }}>{event.content}</div>
                        <div style={{ fontSize: t.caption.size, color: colors.text.muted, marginTop: space[1] }}>{new Date(event.createdAt * 1000).toLocaleString()}</div>
                      </div>
                      <button onClick={() => handleAnalyzeOnce(event.content)} disabled={isAnalyzing || analyzedUrls.has(event.content.slice(0, 200))} style={{ ...btnStyle(isAnalyzing || analyzedUrls.has(event.content.slice(0, 200)), false), padding: `6px ${space[3]}px`, fontSize: t.caption.size }}>
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
      <div style={{
        background: colors.bg.surface,
        border: `1px solid ${colors.border.default}`,
        borderRadius: radii.lg,
        padding: mobile ? space[4] : space[5],
        marginTop: space[5],
        marginBottom: space[5],
      }}>
        <div style={{
          fontSize: t.h3.size, fontWeight: t.h3.weight,
          color: colors.text.tertiary, marginBottom: space[1],
        }}>
          Popular Sources
        </div>
        <div style={{
          fontSize: t.caption.size, color: colors.text.muted, marginBottom: space[3],
        }}>
          Add trusted feeds with a single tap
        </div>

        {/* Category filter chips */}
        <div style={{ display: "flex", gap: space[1], marginBottom: space[3], flexWrap: "wrap" }}>
          {([{ id: "all" as const, label: "All", emoji: "" }, ...CATALOG_CATEGORIES] as const).map(cat => {
            const isAll = cat.id === "all";
            const active = catalogFilter === cat.id;
            const chipColor = isAll ? colors.text.muted : POPULAR_SOURCES.find(s => s.category === cat.id)?.color ?? colors.text.muted;
            return (
              <button
                key={cat.id}
                onClick={() => setCatalogFilter(cat.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: `${space[1]}px ${space[3]}px`,
                  borderRadius: radii.sm,
                  fontSize: t.caption.size, fontWeight: 600,
                  cursor: "pointer",
                  background: active ? `${chipColor}18` : colors.border.subtle,
                  border: active ? `1px solid ${chipColor}40` : `1px solid ${colors.border.subtle}`,
                  color: active ? chipColor : colors.text.muted,
                  fontFamily: "inherit",
                  transition: transitions.fast,
                }}
              >
                {cat.emoji ? `${cat.emoji} ` : ""}{cat.label}
              </button>
            );
          })}
        </div>

        {/* Source grid */}
        <div style={{
          display: "grid",
          gridTemplateColumns: mobile ? "1fr 1fr" : "1fr 1fr 1fr",
          gap: space[2],
        }}>
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
                  style={{
                    display: "flex", alignItems: "center", gap: space[2],
                    padding: `${space[2]}px ${space[3]}px`,
                    borderRadius: radii.md,
                    border: isAdded
                      ? `1px solid ${colors.green[400]}30`
                      : `1px solid ${source.color}30`,
                    background: isAdded
                      ? `${colors.green[400]}08`
                      : justAdded ? `${colors.green[400]}15` : `${source.color}08`,
                    cursor: isAdded || isDemoMode ? "default" : "pointer",
                    opacity: isAdded ? 0.6 : 1,
                    fontFamily: "inherit",
                    transition: transitions.fast,
                    textAlign: "left" as const,
                    width: "100%",
                  }}
                >
                  <span style={{ fontSize: 16, flexShrink: 0, lineHeight: 1 }}>
                    {isAdded ? <CheckIcon /> : source.emoji}
                  </span>
                  <span style={{
                    fontSize: t.bodySm.size, fontWeight: 600,
                    color: isAdded ? colors.green[400] : colors.text.secondary,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {source.label}
                  </span>
                </button>
              );
            })}
        </div>
      </div>

      {/* Saved Sources List */}
      {sources.length > 0 && (
        <div style={{
          background: colors.bg.surface,
          border: `1px solid ${colors.border.default}`,
          borderRadius: radii.lg,
          padding: mobile ? space[4] : space[5],
          marginBottom: space[5],
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: space[3], fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.text.tertiary, marginBottom: space[3] }}>
            <span>Saved Sources ({sources.length})</span>
            {syncStatus === "syncing" && <span style={{ fontSize: t.caption.size, color: colors.sky[400], fontWeight: 600 }}>syncing...</span>}
            {syncStatus === "synced" && <span style={{ fontSize: t.caption.size, color: colors.green[400], fontWeight: 600 }}>synced</span>}
            {syncStatus === "error" && <span style={{ fontSize: t.caption.size, color: colors.red[400], fontWeight: 600 }}>sync error{syncError ? `: ${syncError}` : ""}</span>}
          </div>
          {sources.map(s => {
            const stateKey = getStateKey(s);
            const state = sourceStates[stateKey];
            const health = state ? getSourceHealth(state) : "healthy";
            const healthColor = HEALTH_COLORS[health];

            return (
              <div key={s.id} style={{ marginBottom: space[1] }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: space[3],
                  padding: `${space[2]}px ${space[3]}px`,
                  background: s.enabled ? `${s.type === "rss" ? colors.amber[400] : colors.purple[400]}08` : "transparent",
                  borderRadius: editingId === s.id ? `${radii.sm} ${radii.sm} 0 0` : radii.sm,
                }}>
                  {/* Health-aware toggle */}
                  <button
                    onClick={() => toggleSource(s.id)}
                    style={{
                      width: 18, height: 18, borderRadius: "50%", border: "none", cursor: "pointer",
                      background: s.enabled ? healthColor : colors.border.default,
                      flexShrink: 0, padding: 0,
                    }}
                    title={s.enabled ? `${health} — click to disable` : "Enable"}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: t.body.mobileSz, fontWeight: 600,
                      color: s.enabled ? colors.text.secondary : colors.text.disabled,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {s.label}
                    </div>
                    <div style={{ fontSize: t.tiny.size, color: colors.text.muted }}>
                      {s.type === "rss" ? s.feedUrl : `${(s.relays || []).length} relays · ${(s.pubkeys || []).length} keys`}
                    </div>
                    {/* Runtime stats */}
                    {state && (
                      <div style={{ fontSize: t.tiny.size, color: colors.text.disabled, marginTop: 2 }}>
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
                    {/* Error message */}
                    {state && state.errorCount > 0 && (
                      <div style={{ fontSize: t.tiny.size, color: colors.red[400], marginTop: 2 }}>
                        {state.errorCount >= 5 ? "Auto-disabled: " : `Error (${state.errorCount}x): `}
                        {state.lastError}
                      </div>
                    )}
                  </div>
                  <span style={{
                    fontSize: t.tiny.size, fontWeight: 700, color: s.type === "rss" ? colors.amber[400] : colors.purple[400],
                    textTransform: "uppercase", letterSpacing: 1,
                  }}>
                    {s.type}
                  </span>
                  {!isDemoMode && <button
                    onClick={() => editingId === s.id ? cancelEdit() : startEdit(s)}
                    style={{
                      background: "none", border: "none", cursor: "pointer", padding: `2px 6px`,
                      fontSize: t.caption.size, color: editingId === s.id ? colors.blue[400] : colors.text.disabled,
                      fontFamily: "inherit", transition: transitions.fast,
                    }}
                    title="Edit source"
                  >
                    &#x270E;
                  </button>}
                  {!isDemoMode && <button
                    onClick={() => removeSource(s.id)}
                    style={{
                      background: "none", border: "none", cursor: "pointer", padding: `2px 6px`,
                      fontSize: t.caption.size, color: colors.text.disabled, fontFamily: "inherit",
                      transition: transitions.fast,
                    }}
                    title="Remove source"
                  >
                    &#x2715;
                  </button>}
                </div>

                {/* Inline Editor */}
                {editingId === s.id && (
                  <div style={{
                    background: colors.bg.raised, border: `1px solid ${colors.border.default}`,
                    borderTop: "none", borderRadius: `0 0 ${radii.sm} ${radii.sm}`,
                    padding: `${space[3]}px ${space[4]}px`,
                  }}>
                    <div style={{ marginBottom: space[3] }}>
                      <label style={{ ...kpiLabelStyle, display: "block", marginBottom: 4 }}>Label</label>
                      <input value={editLabel} onChange={e => setEditLabel(e.target.value)} style={{ ...inputStyle, padding: `${space[2]}px ${space[3]}px` }} />
                    </div>

                    {s.type === "rss" && (
                      <div style={{ marginBottom: space[3] }}>
                        <label style={{ ...kpiLabelStyle, display: "block", marginBottom: 4 }}>Feed URL</label>
                        <input value={editFeedUrl} onChange={e => setEditFeedUrl(e.target.value)} style={{ ...inputStyle, padding: `${space[2]}px ${space[3]}px` }} />
                      </div>
                    )}

                    {s.type === "nostr" && (
                      <>
                        <div style={{ marginBottom: space[3] }}>
                          <label style={{ ...kpiLabelStyle, display: "block", marginBottom: 4 }}>Relays ({editRelays.length})</label>
                          {editRelays.map((relay, i) => (
                            <div key={relay} style={{ display: "flex", alignItems: "center", gap: space[2], marginBottom: 3 }}>
                              <span style={{ flex: 1, fontSize: t.bodySm.size, color: colors.text.tertiary, fontFamily: fonts.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{relay}</span>
                              <button
                                onClick={() => setEditRelays(prev => prev.filter((_, idx) => idx !== i))}
                                style={{ background: "none", border: "none", cursor: "pointer", padding: "1px 4px", fontSize: t.caption.size, color: colors.red[400], fontFamily: "inherit" }}
                              >&#x2715;</button>
                            </div>
                          ))}
                          <div style={{ display: "flex", gap: space[2], marginTop: space[1] }}>
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
                              style={{ ...inputStyle, flex: 1, padding: `${space[1]}px ${space[3]}px`, fontSize: t.bodySm.size }}
                            />
                            <button
                              onClick={() => {
                                if (editNewRelay.trim()) {
                                  setEditRelays(prev => [...prev, editNewRelay.trim()]);
                                  setEditNewRelay("");
                                }
                              }}
                              style={{
                                background: "none", border: `1px solid ${colors.border.default}`, borderRadius: radii.sm,
                                cursor: "pointer", padding: `${space[1]}px ${space[3]}px`,
                                fontSize: t.bodySm.size, color: colors.text.muted, fontFamily: "inherit",
                              }}
                            >+ Add</button>
                          </div>
                        </div>

                        <div style={{ marginBottom: space[3] }}>
                          <label style={{ ...kpiLabelStyle, display: "block", marginBottom: 4 }}>Public Keys ({editPubkeys.length})</label>
                          {editPubkeys.map((pk, i) => (
                            <div key={pk} style={{ display: "flex", alignItems: "center", gap: space[2], marginBottom: 3 }}>
                              <span style={{ flex: 1, fontSize: t.bodySm.size, color: colors.text.tertiary, fontFamily: fonts.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pk}</span>
                              <button
                                onClick={() => setEditPubkeys(prev => prev.filter((_, idx) => idx !== i))}
                                style={{ background: "none", border: "none", cursor: "pointer", padding: "1px 4px", fontSize: t.caption.size, color: colors.red[400], fontFamily: "inherit" }}
                              >&#x2715;</button>
                            </div>
                          ))}
                          <div style={{ display: "flex", gap: space[2], marginTop: space[1] }}>
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
                              style={{ ...inputStyle, flex: 1, padding: `${space[1]}px ${space[3]}px`, fontSize: t.bodySm.size }}
                            />
                            <button
                              onClick={() => {
                                if (editNewPubkey.trim()) {
                                  setEditPubkeys(prev => [...prev, editNewPubkey.trim()]);
                                  setEditNewPubkey("");
                                }
                              }}
                              style={{
                                background: "none", border: `1px solid ${colors.border.default}`, borderRadius: radii.sm,
                                cursor: "pointer", padding: `${space[1]}px ${space[3]}px`,
                                fontSize: t.bodySm.size, color: colors.text.muted, fontFamily: "inherit",
                              }}
                            >+ Add</button>
                          </div>
                        </div>
                      </>
                    )}

                    <div style={{ display: "flex", gap: space[2], justifyContent: "flex-end" }}>
                      <button onClick={cancelEdit} style={{
                        background: "none", border: `1px solid ${colors.border.default}`, borderRadius: radii.sm,
                        cursor: "pointer", padding: `${space[2]}px ${space[4]}px`,
                        fontSize: t.bodySm.size, color: colors.text.muted, fontFamily: "inherit",
                      }}>Cancel</button>
                      <button onClick={saveEdit} style={saveBtnStyle}>Save</button>
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
