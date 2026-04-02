"use client";
import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { typography } from "@/lib/design";
import { ContentCard, YouTubePreview } from "@/components/ui/ContentCard";
import { ShareBriefingModal } from "@/components/ui/ShareBriefingModal";
import { ShareIcon, SearchIcon } from "@/components/icons";
import { generateBriefing } from "@/lib/briefing/ranker";
import { SerendipityBadge } from "@/components/filtering/SerendipityBadge";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { BriefingClassificationBadge } from "@/components/ui/BriefingClassificationBadge";
import { useContent } from "@/contexts/ContentContext";
import type { ContentItem } from "@/lib/types/content";
import type { UserPreferenceProfile } from "@/lib/preferences/types";
import type { SerendipityItem } from "@/lib/filtering/serendipity";
import { errMsg } from "@/lib/utils/errors";
import { getUserApiKey } from "@/lib/apiKey/storage";

interface BriefingTabProps {
  content: ContentItem[];
  profile: UserPreferenceProfile;
  onValidate: (id: string) => void;
  onFlag: (id: string) => void;
  mobile?: boolean;
  nostrKeys?: { sk: Uint8Array; pk: string } | null;
  isLoading?: boolean;
  discoveries?: SerendipityItem[];
  onTabChange?: (tab: string) => void;
  onTranslate?: (id: string) => void;
  isItemTranslating?: (id: string) => boolean;
}

export const BriefingTab: React.FC<BriefingTabProps> = ({ content, profile, onValidate, onFlag, mobile, nostrKeys, isLoading, discoveries = [], onTabChange, onTranslate, isItemTranslating }) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const handleToggle = useCallback((id: string) => {
    setExpanded(prev => prev === id ? null : id);
  }, []);
  const [showFiltered, setShowFiltered] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [digestLoading, setDigestLoading] = useState(false);
  const [digestError, setDigestError] = useState<string | null>(null);
  const { syncBriefing } = useContent();

  const briefing = useMemo(() => generateBriefing(content, profile), [content, profile]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    const matches = content.filter(item =>
      item.text.toLowerCase().includes(q)
      || item.author.toLowerCase().includes(q)
      || item.topics?.some(t => t.toLowerCase().includes(q)),
    );
    matches.sort((a, b) => b.scores.composite - a.scores.composite || a.id.localeCompare(b.id));
    return matches;
  }, [content, searchQuery]);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setSearchQuery("");
      if (mobile) setSearchOpen(false);
      searchInputRef.current?.blur();
    }
  }, [mobile]);

  useEffect(() => {
    if (searchOpen && searchInputRef.current) searchInputRef.current.focus();
  }, [searchOpen]);

  const dedupedDiscoveries = useMemo(() => {
    const briefingIds = new Set(briefing.priority.map(b => b.item.id));
    if (briefing.serendipity) briefingIds.add(briefing.serendipity.item.id);
    return discoveries.filter(d => !briefingIds.has(d.item.id));
  }, [discoveries, briefing.priority, briefing.serendipity]);

  const briefingSyncKey = useMemo(
    () => briefing.priority.map(b => b.item.id).join(",") + "|" + (briefing.serendipity?.item.id ?? ""),
    [briefing.priority, briefing.serendipity],
  );
  const briefingRef = useRef(briefing);
  briefingRef.current = briefing;
  useEffect(() => {
    if (briefingRef.current.priority.length > 0) {
      syncBriefing(briefingRef.current, nostrKeys?.pk ?? null);
    }
  }, [briefingSyncKey, syncBriefing, nostrKeys?.pk]);

  useEffect(() => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const cached = localStorage.getItem(`aegis-digest-${today}`);
      if (cached) setDigest(cached);
    } catch (e) { console.debug("[briefing] Digest cache load failed:", e); }
  }, []);

  const generateDigest = useCallback(async () => {
    if (briefing.priority.length === 0) return;
    setDigestLoading(true);
    setDigestError(null);
    try {
      const articles = briefing.priority.map(b => ({
        title: b.item.text.split("\n")[0].slice(0, 80),
        text: b.item.text.slice(0, 200),
        score: b.item.scores.composite,
        topics: b.item.topics ?? [],
      }));
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const byokKey = getUserApiKey();
      if (byokKey) headers["X-User-API-Key"] = byokKey;
      const res = await fetch("/api/briefing/digest", {
        method: "POST",
        headers,
        body: JSON.stringify({ articles }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `API ${res.status}`);
      }
      const data = await res.json();
      setDigest(data.digest);
      const today = new Date().toISOString().slice(0, 10);
      try { localStorage.setItem(`aegis-digest-${today}`, data.digest); } catch (err) { console.warn("[briefing] Failed to cache digest:", err); }
    } catch (err) {
      setDigestError(errMsg(err));
    } finally {
      setDigestLoading(false);
    }
  }, [briefing.priority]);

  const insightCount = briefing.priority.length + (briefing.serendipity ? 1 : 0) + dedupedDiscoveries.length;
  const canShare = nostrKeys && briefing.priority.length > 0;

  return (
    <div className="animate-fade-in">
      <div className={mobile ? "mb-8" : "mb-12"}>
        <div className="flex items-center justify-between">
          <h1 data-testid="aegis-briefing-heading" className={cn(
            typography.display,
            "text-foreground m-0",
            mobile && "text-[24px]"
          )}>
            Your Briefing
          </h1>
          <div className="flex items-center gap-2">
            {mobile && (
              <button
                onClick={() => setSearchOpen(prev => !prev)}
                className={cn(
                  "p-2 rounded-md transition-colors cursor-pointer bg-transparent border-none font-[inherit]",
                  searchOpen ? "text-cyan-400" : "text-muted-foreground hover:text-foreground",
                )}
                aria-label="Toggle search"
              >
                <SearchIcon s={18} />
              </button>
            )}
            {canShare && (
              <button
                onClick={() => setShowShareModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-md text-purple-400 text-body-sm font-semibold cursor-pointer font-[inherit] transition-all duration-150 hover:border-purple-400/25 hover:shadow-glow-purple"
              >
                <ShareIcon s={16} />
                {!mobile && "Share"}
              </button>
            )}
          </div>
        </div>

        {(!mobile || searchOpen) && (
          <div className={cn("flex items-center gap-2 mt-3", mobile && "animate-fade-in")}>
            {!mobile && <span className="text-muted-foreground shrink-0"><SearchIcon s={16} /></span>}
            <input
              ref={searchInputRef}
              type="search"
              placeholder="Search by text, author, or topic..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className={cn(
                "flex-1 bg-card border border-border rounded-md px-3 py-2 text-foreground placeholder:text-disabled outline-none transition-colors focus:border-cyan-500/40 font-sans",
                mobile ? "text-[14px]" : "text-body-sm",
              )}
              aria-label="Search briefing content"
            />
            {searchQuery && (
              <button
                onClick={() => { setSearchQuery(""); searchInputRef.current?.focus(); }}
                className="text-muted-foreground hover:text-foreground text-caption px-2 py-1 shrink-0 cursor-pointer bg-transparent border-none font-[inherit]"
                aria-label="Clear search"
              >
                Clear
              </button>
            )}
          </div>
        )}

        <p data-testid="aegis-briefing-insight-count" className={cn("text-muted-foreground mt-2", mobile ? "text-[13px]" : "text-body")}>
          {searchResults !== null
            ? `${searchResults.length} result${searchResults.length !== 1 ? "s" : ""} for \u201C${searchQuery.trim()}\u201D`
            : `${insightCount} insights selected from ${briefing.totalItems} items`
          }
        </p>
      </div>

      {showShareModal && nostrKeys && (
        <ShareBriefingModal
          briefing={briefing}
          nostrKeys={nostrKeys}
          onClose={() => setShowShareModal(false)}
          mobile={mobile}
          onTabChange={onTabChange}
        />
      )}

      {searchResults !== null ? (
        searchResults.length > 0 ? (
          <div data-testid="aegis-briefing-search-results">
            {searchResults.map((item, i) => (
              <div key={item.id} style={{ animation: `slideUp .3s ease ${Math.min(i * 0.04, 0.8)}s both` }}>
                <ContentCard
                  item={item}
                  expanded={expanded === item.id}
                  onToggle={handleToggle}
                  onValidate={onValidate}
                  onFlag={onFlag}
                  onTranslate={onTranslate}
                  isTranslating={isItemTranslating?.(item.id)}
                  mobile={mobile}
                />
              </div>
            ))}
          </div>
        ) : (
          <div data-testid="aegis-briefing-search-empty" className="text-center p-10 text-muted-foreground bg-card rounded-lg border border-border mb-4">
            <div className="text-[32px] mb-3">&#x1F50D;</div>
            <div className="text-h3 font-semibold text-tertiary">No matches found</div>
            <div className="text-body-sm mt-2">
              Try a different search term or{" "}
              <button
                onClick={() => { setSearchQuery(""); if (mobile) setSearchOpen(false); }}
                className="text-cyan-400 underline cursor-pointer font-[inherit] bg-transparent border-none p-0"
              >
                clear the search
              </button>
            </div>
          </div>
        )
      ) : (
        <>
        {isLoading ? (
        <div data-testid="aegis-briefing-loading" className="text-center p-10 text-muted-foreground bg-card rounded-lg border border-border mb-4">
          <div className="text-[32px] mb-3 animate-pulse">&#x1F6E1;</div>
          <div className="text-h3 font-semibold text-tertiary">Loading briefing...</div>
          <div className="text-body-sm mt-2">Syncing from Internet Computer</div>
        </div>
      ) : briefing.priority.length > 0 ? (
        <div data-testid="aegis-briefing-priority-list">
          {briefing.priority.map((b, i) => (
            <div key={b.item.id} style={{ animation: `slideUp .3s ease ${i * 0.06}s both` }}>
              {b.classification !== "mixed" && (
                <div className="mb-1 flex items-center">
                  <BriefingClassificationBadge classification={b.classification} />
                </div>
              )}
              <ContentCard
                item={b.item}
                variant="priority"
                rank={i + 1}
                expanded={expanded === b.item.id}
                onToggle={handleToggle}
                onValidate={onValidate}
                onFlag={onFlag}
                onTranslate={onTranslate}
                isTranslating={isItemTranslating?.(b.item.id)}
                mobile={mobile}
              />
            </div>
          ))}
        </div>
      ) : (
        <div data-testid="aegis-briefing-empty" className="text-center p-10 text-muted-foreground bg-card rounded-lg border border-border mb-4">
          <div className="text-[32px] mb-3">&#x1F50D;</div>
          <div className="text-h3 font-semibold text-tertiary">No priority items yet</div>
          <div className="text-body-sm mt-2">Evaluate content and validate quality items to build your personalized briefing</div>
          {onTabChange && (
            <div className="mt-4">
              <button
                data-testid="aegis-briefing-start-eval"
                onClick={() => onTabChange("incinerator")}
                className="px-4 py-2 bg-navy-lighter border border-emphasis rounded-md text-purple-400 text-body-sm font-semibold cursor-pointer font-[inherit] transition-all duration-150 hover:bg-navy-hover"
              >
                Start Evaluating &rarr;
              </button>
            </div>
          )}
        </div>
      )}

      {/* AI Digest */}
      {briefing.priority.length > 0 && getUserApiKey() && (
        <div className="my-4 px-5 py-4 bg-card border border-border rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <span className="text-h3 font-semibold text-tertiary">
              Today&apos;s Digest
            </span>
            {!digest && (
              <button
                onClick={generateDigest}
                disabled={digestLoading}
                className={cn(
                  "px-3 py-1 rounded-md text-caption font-semibold cursor-pointer font-[inherit] transition-all duration-150",
                  digestLoading
                    ? "bg-overlay border border-subtle text-disabled cursor-not-allowed"
                    : "bg-cyan-500/[0.09] border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/[0.15]"
                )}
              >
                {digestLoading ? "Generating..." : "Generate Digest"}
              </button>
            )}
          </div>
          {digest ? (
            <p className="text-body text-secondary-foreground leading-body m-0">{digest}</p>
          ) : digestError ? (
            <p className="text-caption text-red-400 m-0">{digestError}</p>
          ) : (
            <p className="text-caption text-disabled m-0">
              AI-generated summary of your top priority articles.
            </p>
          )}
        </div>
      )}

      {/* Serendipity */}
      {briefing.serendipity && (
        <div className="mt-2" style={{ animation: `slideUp .3s ease ${briefing.priority.length * 0.06 + 0.1}s both` }}>
          <ContentCard
            item={briefing.serendipity.item}
            variant="serendipity"
            expanded={expanded === briefing.serendipity.item.id}
            onToggle={handleToggle}
            onValidate={onValidate}
            onFlag={onFlag}
            onTranslate={onTranslate}
            isTranslating={isItemTranslating?.(briefing.serendipity.item.id)}
            mobile={mobile}
          />
        </div>
      )}

      {/* Discoveries */}
      {dedupedDiscoveries.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">&#x1F52D;</span>
            <span className="text-h3 font-semibold text-purple-400">Discoveries</span>
            <span className="text-caption text-muted-foreground bg-navy-lighter px-2 py-0.5 rounded-sm">
              {dedupedDiscoveries.length}
            </span>
            <InfoTooltip
              text="High-quality content from outside your usual topics or network. These items scored well but cover areas you haven't explored yet."
              mobile={mobile}
            />
          </div>

          {dedupedDiscoveries.map((d, i) => (
            <div
              key={d.item.id}
              className="mb-2"
              style={{ animation: `slideUp .3s ease ${(briefing.priority.length + 1 + i) * 0.06}s both` }}
            >
              <div className={cn(
                "bg-gradient-to-br from-purple-600/[0.06] to-blue-600/[0.04] border border-purple-600/15 rounded-lg relative overflow-hidden",
                mobile ? "p-4" : "px-5 py-4"
              )}>
                <div className="absolute top-2 right-2">
                  <SerendipityBadge discoveryType={d.discoveryType} mobile={mobile} />
                </div>

                <div
                  className="flex items-center gap-2 pb-2 border-b border-subtle mb-2"
                  style={{ paddingRight: mobile ? 40 : 130 }}
                >
                  {d.item.avatar && d.item.avatar.startsWith("http") ? (
                    /* eslint-disable-next-line @next/next/no-img-element -- external user-content URLs */
                    <img src={d.item.avatar} alt="" loading="lazy" className="size-5 rounded-full object-cover border border-border" />
                  ) : (
                    <span className="text-base">{d.item.avatar}</span>
                  )}
                  <span className="font-bold text-secondary-foreground text-body font-mono">{d.item.author}</span>
                  <span className="text-caption text-muted-foreground bg-navy-lighter px-2 py-0.5 rounded-sm">
                    {d.item.platform || d.item.source}
                  </span>
                </div>

                <p className={cn("text-purple-300 leading-body m-0 break-words", mobile ? "text-[13px]" : "text-body")}>
                  {d.item.text}
                </p>

                <YouTubePreview sourceUrl={d.item.sourceUrl} />

                <div className="mt-2 text-caption text-purple-400 italic">{d.reason}</div>

                {d.item.sourceUrl && /^https?:\/\//i.test(d.item.sourceUrl) && (
                  <a
                    href={d.item.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-2 text-caption text-cyan-400 no-underline font-semibold break-all hover:underline"
                  >
                    {(() => { try { return new URL(d.item.sourceUrl).hostname; } catch { return d.item.sourceUrl; } })()}
                    <span className="text-caption">{"\u2197"}</span>
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filtered Out */}
      {briefing.filteredOut.length > 0 && (
        <div className="mt-5">
          <button
            data-testid="aegis-briefing-filtered-toggle"
            onClick={() => setShowFiltered(prev => !prev)}
            aria-expanded={showFiltered}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-card border border-border rounded-md text-muted-foreground text-body-sm font-semibold cursor-pointer transition-all duration-250 font-[inherit] hover:border-emphasis"
          >
            <span className={cn("inline-block transition-transform duration-200", showFiltered && "rotate-180")}>
              &#x25BC;
            </span>
            Filtered Out ({briefing.filteredOut.length} items)
          </button>

          {showFiltered && (
            <div className="mt-3">
              {briefing.filteredOut.map((it, i) => (
                <div key={it.id} style={{ animation: `slideUp .2s ease ${i * 0.03}s both` }}>
                  <ContentCard
                    item={it}
                    expanded={expanded === it.id}
                    onToggle={handleToggle}
                    onValidate={onValidate}
                    onFlag={onFlag}
                    onTranslate={onTranslate}
                    isTranslating={isItemTranslating?.(it.id)}
                    mobile={mobile}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

        </>
      )}

      {/* Chrome Extension CTA */}
      <div className="mt-6 px-4 py-3 bg-card border border-border rounded-lg flex items-center gap-3">
        <span className="text-lg shrink-0">&#x1F9E9;</span>
        <span className="text-body-sm text-muted-foreground flex-1">
          Send any page to Aegis directly from Chrome
        </span>
        <a
          href="https://chromewebstore.google.com/detail/aegis-score/pnnpkepiojfpkppjpoimolkamflhbjhh"
          target="_blank"
          rel="noopener noreferrer"
          className="text-caption font-semibold text-cyan-400 no-underline whitespace-nowrap shrink-0 hover:underline"
        >
          Aegis Score &rarr;
        </a>
      </div>
    </div>
  );
};
