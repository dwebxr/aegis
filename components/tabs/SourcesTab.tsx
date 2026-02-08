"use client";
import React, { useState } from "react";
import { fonts, colors, space, type as t, radii, transitions, kpiLabelStyle } from "@/styles/theme";
import { RSSIcon, GlobeIcon, LinkIcon } from "@/components/icons";
import type { AnalyzeResponse } from "@/lib/types/api";
import type { FetchURLResponse, FetchRSSResponse, FetchTwitterResponse, FetchNostrResponse } from "@/lib/types/api";
import { ManualInput } from "@/components/sources/ManualInput";
import { useSources } from "@/contexts/SourceContext";
import { useAuth } from "@/contexts/AuthContext";

interface SourcesTabProps {
  onAnalyze: (text: string) => Promise<AnalyzeResponse>;
  isAnalyzing: boolean;
  mobile?: boolean;
}

export const SourcesTab: React.FC<SourcesTabProps> = ({ onAnalyze, isAnalyzing, mobile }) => {
  const { sources, addSource, removeSource, toggleSource, updateSource } = useSources();
  const { isAuthenticated } = useAuth();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editFeedUrl, setEditFeedUrl] = useState("");
  const [editRelays, setEditRelays] = useState<string[]>([]);
  const [editPubkeys, setEditPubkeys] = useState<string[]>([]);
  const [editNewRelay, setEditNewRelay] = useState("");
  const [editNewPubkey, setEditNewPubkey] = useState("");
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
    try {
      const res = await fetch("/api/fetch/url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: urlInput }) });
      const data = await res.json();
      if (!res.ok) { setUrlError(data.error || "Failed to extract"); return; }
      setUrlResult(data);
    } catch { setUrlError("Network error — check connection"); } finally { setUrlLoading(false); }
  };

  const fetchRss = async () => {
    if (!rssInput.trim()) return;
    setRssLoading(true); setRssError(""); setRssResult(null);
    try {
      const res = await fetch("/api/fetch/rss", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feedUrl: rssInput, limit: 10 }) });
      const data = await res.json();
      if (!res.ok) { setRssError(data.error || "Failed to parse feed"); return; }
      setRssResult(data);
    } catch { setRssError("Network error — check connection"); } finally { setRssLoading(false); }
  };

  const fetchTwitter = async () => {
    if (!twitterToken.trim() || !twitterQuery.trim()) return;
    setTwitterLoading(true); setTwitterError(""); setTwitterResult(null);
    try {
      const res = await fetch("/api/fetch/twitter", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bearerToken: twitterToken, query: twitterQuery, maxResults: 10 }) });
      const data = await res.json();
      if (!res.ok) { setTwitterError(data.error || "Failed to fetch tweets"); return; }
      setTwitterResult(data);
    } catch { setTwitterError("Network error — check connection"); } finally { setTwitterLoading(false); }
  };

  const fetchNostr = async () => {
    setNostrLoading(true); setNostrError(""); setNostrResult(null);
    try {
      const relays = nostrRelays.split("\n").map(r => r.trim()).filter(Boolean);
      const pubkeys = nostrPubkeys.split("\n").map(p => p.trim()).filter(Boolean);
      const res = await fetch("/api/fetch/nostr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ relays, pubkeys: pubkeys.length > 0 ? pubkeys : undefined, limit: 20 }) });
      const data = await res.json();
      if (!res.ok) { setNostrError(data.error || "Failed to fetch events"); return; }
      setNostrResult(data);
    } catch { setNostrError("Network error — check connection"); } finally { setNostrLoading(false); }
  };

  const handleSaveRss = () => {
    if (!rssResult) return;
    addSource({ type: "rss", label: rssResult.feedTitle || rssInput, feedUrl: rssInput, enabled: true });
    setRssInput(""); setRssResult(null);
  };

  const handleSaveNostr = () => {
    const relays = nostrRelays.split("\n").map(r => r.trim()).filter(Boolean);
    const pubkeys = nostrPubkeys.split("\n").map(p => p.trim()).filter(Boolean);
    if (relays.length === 0) return;
    const label = pubkeys.length > 0 ? `Nostr (${pubkeys.length} keys)` : `Nostr (${relays.length} relays)`;
    addSource({ type: "nostr", label, relays, pubkeys, enabled: true });
  };

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

  const sourceTabs: Array<{ id: "manual" | "url" | "rss" | "twitter" | "nostr"; label: string; icon: React.ReactNode; color: string }> = [
    { id: "manual", label: "Manual", icon: <span style={{ fontSize: 14 }}>&#x270D;&#xFE0F;</span>, color: colors.purple[400] },
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

      {/* Saved Sources List */}
      {sources.length > 0 && (
        <div style={{
          background: colors.bg.surface,
          border: `1px solid ${colors.border.default}`,
          borderRadius: radii.lg,
          padding: mobile ? space[4] : space[5],
          marginBottom: space[5],
        }}>
          <div style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.text.tertiary, marginBottom: space[3] }}>
            Saved Sources ({sources.length})
          </div>
          {sources.map(s => (
            <div key={s.id} style={{ marginBottom: space[1] }}>
              <div style={{
                display: "flex", alignItems: "center", gap: space[3],
                padding: `${space[2]}px ${space[3]}px`,
                background: s.enabled ? `${s.type === "rss" ? colors.amber[400] : colors.purple[400]}08` : "transparent",
                borderRadius: editingId === s.id ? `${radii.sm} ${radii.sm} 0 0` : radii.sm,
              }}>
                <button
                  onClick={() => toggleSource(s.id)}
                  style={{
                    width: 18, height: 18, borderRadius: "50%", border: "none", cursor: "pointer",
                    background: s.enabled ? (s.type === "rss" ? colors.amber[400] : colors.purple[400]) : colors.border.default,
                    flexShrink: 0, padding: 0,
                  }}
                  title={s.enabled ? "Disable" : "Enable"}
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
                </div>
                <span style={{
                  fontSize: t.tiny.size, fontWeight: 700, color: s.type === "rss" ? colors.amber[400] : colors.purple[400],
                  textTransform: "uppercase", letterSpacing: 1,
                }}>
                  {s.type}
                </span>
                <button
                  onClick={() => editingId === s.id ? cancelEdit() : startEdit(s)}
                  style={{
                    background: "none", border: "none", cursor: "pointer", padding: `2px 6px`,
                    fontSize: t.caption.size, color: editingId === s.id ? colors.blue[400] : colors.text.disabled,
                    fontFamily: "inherit", transition: transitions.fast,
                  }}
                  title="Edit source"
                >
                  &#x270E;
                </button>
                <button
                  onClick={() => removeSource(s.id)}
                  style={{
                    background: "none", border: "none", cursor: "pointer", padding: `2px 6px`,
                    fontSize: t.caption.size, color: colors.text.disabled, fontFamily: "inherit",
                    transition: transitions.fast,
                  }}
                  title="Remove source"
                >
                  &#x2715;
                </button>
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
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: space[2], marginBottom: 3 }}>
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
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: space[2], marginBottom: 3 }}>
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
          ))}
        </div>
      )}

      {!isAuthenticated && sources.length === 0 && (
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
        {activeSource === "manual" && (
          <ManualInput onAnalyze={onAnalyze} isAnalyzing={isAnalyzing} mobile={mobile} />
        )}

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
            <div style={{ display: "flex", gap: space[2] }}>
              <input value={rssInput} onChange={e => setRssInput(e.target.value)} placeholder="https://example.com/feed.xml" style={{ ...inputStyle, flex: 1 }} />
              <button onClick={fetchRss} disabled={rssLoading || !rssInput.trim()} style={btnStyle(!rssInput.trim(), rssLoading)}>
                {rssLoading ? "Fetching..." : "Fetch Feed"}
              </button>
            </div>
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
                    <button onClick={() => onAnalyze(item.content || item.title)} disabled={isAnalyzing} style={{ ...btnStyle(isAnalyzing, false), padding: `6px ${space[3]}px`, fontSize: t.caption.size, flexShrink: 0 }}>
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
                      <button onClick={() => onAnalyze(tweet.text)} disabled={isAnalyzing} style={{ ...btnStyle(isAnalyzing, false), padding: `6px ${space[3]}px`, fontSize: t.caption.size }}>
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
                      <button onClick={() => onAnalyze(event.content)} disabled={isAnalyzing} style={{ ...btnStyle(isAnalyzing, false), padding: `6px ${space[3]}px`, fontSize: t.caption.size }}>
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
