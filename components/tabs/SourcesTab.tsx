"use client";
import React, { useState } from "react";
import { fonts } from "@/styles/theme";
import { RSSIcon, GlobeIcon, LinkIcon } from "@/components/icons";
import type { AnalyzeResponse } from "@/lib/types/api";
import type { FetchURLResponse, FetchRSSResponse, FetchTwitterResponse, FetchNostrResponse } from "@/lib/types/api";
import { ManualInput } from "@/components/sources/ManualInput";

interface SourcesTabProps {
  onAnalyze: (text: string) => Promise<AnalyzeResponse>;
  isAnalyzing: boolean;
  mobile?: boolean;
}

export const SourcesTab: React.FC<SourcesTabProps> = ({ onAnalyze, isAnalyzing, mobile }) => {
  const [activeSource, setActiveSource] = useState<"manual" | "url" | "rss" | "twitter" | "nostr">("manual");
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

  const fetchUrl = async () => {
    if (!urlInput.trim()) return;
    setUrlLoading(true); setUrlError(""); setUrlResult(null);
    const res = await fetch("/api/fetch/url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: urlInput }) });
    const data = await res.json();
    setUrlLoading(false);
    if (!res.ok) { setUrlError(data.error || "Failed to extract"); return; }
    setUrlResult(data);
  };

  const fetchRss = async () => {
    if (!rssInput.trim()) return;
    setRssLoading(true); setRssError(""); setRssResult(null);
    const res = await fetch("/api/fetch/rss", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feedUrl: rssInput, limit: 10 }) });
    const data = await res.json();
    setRssLoading(false);
    if (!res.ok) { setRssError(data.error || "Failed to parse feed"); return; }
    setRssResult(data);
  };

  const fetchTwitter = async () => {
    if (!twitterToken.trim() || !twitterQuery.trim()) return;
    setTwitterLoading(true); setTwitterError(""); setTwitterResult(null);
    const res = await fetch("/api/fetch/twitter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bearerToken: twitterToken, query: twitterQuery, maxResults: 10 }) });
    const data = await res.json();
    setTwitterLoading(false);
    if (!res.ok) { setTwitterError(data.error || "Failed to fetch tweets"); return; }
    setTwitterResult(data);
  };

  const fetchNostr = async () => {
    setNostrLoading(true); setNostrError(""); setNostrResult(null);
    const relays = nostrRelays.split("\n").map(r => r.trim()).filter(Boolean);
    const pubkeys = nostrPubkeys.split("\n").map(p => p.trim()).filter(Boolean);
    const res = await fetch("/api/fetch/nostr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ relays, pubkeys: pubkeys.length > 0 ? pubkeys : undefined, limit: 20 }) });
    const data = await res.json();
    setNostrLoading(false);
    if (!res.ok) { setNostrError(data.error || "Failed to fetch events"); return; }
    setNostrResult(data);
  };

  const sources: Array<{ id: "manual" | "url" | "rss" | "twitter" | "nostr"; label: string; icon: React.ReactNode; color: string }> = [
    { id: "manual", label: "Manual", icon: <span style={{ fontSize: 14 }}>✍️</span>, color: "#818cf8" },
    { id: "url", label: "URL", icon: <LinkIcon s={14} />, color: "#38bdf8" },
    { id: "rss", label: "RSS", icon: <RSSIcon s={14} />, color: "#fbbf24" },
    { id: "twitter", label: "X (Twitter)", icon: <span style={{ fontSize: 14 }}>𝕏</span>, color: "#e2e8f0" },
    { id: "nostr", label: "Nostr", icon: <GlobeIcon s={14} />, color: "#a78bfa" },
  ];

  const inputStyle: React.CSSProperties = {
    width: "100%", background: "#0c1322", border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 10, padding: "10px 14px", color: "#e2e8f0", fontSize: 13,
    fontFamily: "inherit", outline: "none", boxSizing: "border-box" as const,
  };

  const btnStyle = (disabled: boolean, loading: boolean): React.CSSProperties => ({
    padding: "10px 20px", background: loading ? "rgba(56,189,248,0.1)" : "linear-gradient(135deg,#2563eb,#1d4ed8)",
    border: "none", borderRadius: 10, color: "#fff", fontSize: 13, fontWeight: 700,
    cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1, whiteSpace: "nowrap",
  });

  const errorStyle: React.CSSProperties = { fontSize: 12, color: "#f87171", marginTop: 8 };
  const labelStyle: React.CSSProperties = { display: "block", fontSize: 10, color: "#64748b", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 };

  return (
    <div style={{ animation: "fadeIn .4s ease" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: mobile ? 22 : 26, fontWeight: 800, color: "#f1f5f9", margin: 0 }}>Content Sources</h1>
        <p style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>Configure where to find content for evaluation</p>
      </div>

      <div style={{ display: "flex", gap: 5, marginBottom: 20, flexWrap: "wrap" }}>
        {sources.map(s => (
          <button key={s.id} onClick={() => setActiveSource(s.id)} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "8px 14px", borderRadius: 9, fontSize: 12, fontWeight: 600,
            cursor: "pointer", transition: "all .2s",
            background: activeSource === s.id ? `${s.color}18` : "rgba(255,255,255,0.03)",
            border: activeSource === s.id ? `1px solid ${s.color}40` : "1px solid rgba(255,255,255,0.06)",
            color: activeSource === s.id ? s.color : "#64748b",
          }}>
            {s.icon} {s.label}
          </button>
        ))}
      </div>

      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 18, padding: mobile ? 18 : 28 }}>
        {activeSource === "manual" && (
          <ManualInput onAnalyze={onAnalyze} isAnalyzing={isAnalyzing} mobile={mobile} />
        )}

        {activeSource === "url" && (
          <div>
            <label style={labelStyle}>Article URL</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={urlInput} onChange={e => setUrlInput(e.target.value)} placeholder="https://example.com/article" style={{ ...inputStyle, flex: 1 }} />
              <button onClick={fetchUrl} disabled={urlLoading || !urlInput.trim()} style={btnStyle(!urlInput.trim(), urlLoading)}>
                {urlLoading ? "Extracting..." : "Extract"}
              </button>
            </div>
            {urlError && <div style={errorStyle}>{urlError}</div>}
            {urlResult && (
              <div style={{ marginTop: 16, background: "rgba(0,0,0,0.2)", borderRadius: 12, padding: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>{urlResult.title}</div>
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 10 }}>by {urlResult.author} · {urlResult.source}</div>
                <div style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.6, maxHeight: 200, overflow: "auto", marginBottom: 12 }}>{urlResult.content.slice(0, 1000)}{urlResult.content.length > 1000 ? "..." : ""}</div>
                <button onClick={() => onAnalyze(urlResult.content)} disabled={isAnalyzing} style={btnStyle(isAnalyzing, isAnalyzing)}>
                  {isAnalyzing ? "Analyzing..." : "Analyze This Content"}
                </button>
              </div>
            )}
          </div>
        )}

        {activeSource === "rss" && (
          <div>
            <label style={labelStyle}>RSS Feed URL</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={rssInput} onChange={e => setRssInput(e.target.value)} placeholder="https://example.com/feed.xml" style={{ ...inputStyle, flex: 1 }} />
              <button onClick={fetchRss} disabled={rssLoading || !rssInput.trim()} style={btnStyle(!rssInput.trim(), rssLoading)}>
                {rssLoading ? "Fetching..." : "Fetch Feed"}
              </button>
            </div>
            {rssError && <div style={errorStyle}>{rssError}</div>}
            {rssResult && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", marginBottom: 10 }}>{rssResult.feedTitle} ({rssResult.items.length} items)</div>
                {rssResult.items.map((item, i) => (
                  <div key={i} style={{ background: "rgba(0,0,0,0.2)", borderRadius: 10, padding: 12, marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
                      <div style={{ fontSize: 10, color: "#64748b" }}>{item.author} · {item.publishedDate}</div>
                    </div>
                    <button onClick={() => onAnalyze(item.content || item.title)} disabled={isAnalyzing} style={{ ...btnStyle(isAnalyzing, false), padding: "6px 12px", fontSize: 11 }}>
                      Analyze
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
            <input type="password" value={twitterToken} onChange={e => setTwitterToken(e.target.value)} placeholder="Your X API Bearer Token" style={{ ...inputStyle, marginBottom: 12 }} />
            <label style={labelStyle}>Search Query</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={twitterQuery} onChange={e => setTwitterQuery(e.target.value)} placeholder="AI research -is:retweet lang:en" style={{ ...inputStyle, flex: 1 }} />
              <button onClick={fetchTwitter} disabled={twitterLoading || !twitterToken.trim() || !twitterQuery.trim()} style={btnStyle(!twitterToken.trim() || !twitterQuery.trim(), twitterLoading)}>
                {twitterLoading ? "Searching..." : "Search"}
              </button>
            </div>
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 6 }}>Your token is sent per-request only and never stored on our servers.</div>
            {twitterError && <div style={errorStyle}>{twitterError}</div>}
            {twitterResult && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", marginBottom: 10 }}>{twitterResult.tweets.length} tweets found</div>
                {twitterResult.tweets.map(tweet => (
                  <div key={tweet.id} style={{ background: "rgba(0,0,0,0.2)", borderRadius: 10, padding: 12, marginBottom: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, color: "#e2e8f0", fontWeight: 600, fontFamily: fonts.mono }}>{tweet.authorHandle}</div>
                        <div style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.5, marginTop: 4 }}>{tweet.text}</div>
                        <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>{tweet.createdAt}</div>
                      </div>
                      <button onClick={() => onAnalyze(tweet.text)} disabled={isAnalyzing} style={{ ...btnStyle(isAnalyzing, false), padding: "6px 12px", fontSize: 11 }}>
                        Analyze
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
            <textarea value={nostrRelays} onChange={e => setNostrRelays(e.target.value)} placeholder={"wss://relay.damus.io\nwss://nos.lol"} style={{ ...inputStyle, height: 70, resize: "vertical", marginBottom: 12 }} />
            <label style={labelStyle}>Public Keys to follow (optional, one per line)</label>
            <textarea value={nostrPubkeys} onChange={e => setNostrPubkeys(e.target.value)} placeholder="npub or hex pubkey..." style={{ ...inputStyle, height: 50, resize: "vertical", marginBottom: 12 }} />
            <button onClick={fetchNostr} disabled={nostrLoading} style={btnStyle(nostrLoading, nostrLoading)}>
              {nostrLoading ? "Fetching..." : "Fetch Latest"}
            </button>
            {nostrError && <div style={errorStyle}>{nostrError}</div>}
            {nostrResult && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", marginBottom: 10 }}>{nostrResult.events.length} events found</div>
                {nostrResult.events.map(event => (
                  <div key={event.id} style={{ background: "rgba(0,0,0,0.2)", borderRadius: 10, padding: 12, marginBottom: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: "#a78bfa", fontFamily: fonts.mono }}>{event.pubkey.slice(0, 12)}...{event.pubkey.slice(-8)}</div>
                        <div style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.5, marginTop: 4 }}>{event.content}</div>
                        <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>{new Date(event.createdAt * 1000).toLocaleString()}</div>
                      </div>
                      <button onClick={() => onAnalyze(event.content)} disabled={isAnalyzing} style={{ ...btnStyle(isAnalyzing, false), padding: "6px 12px", fontSize: 11 }}>
                        Analyze
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
