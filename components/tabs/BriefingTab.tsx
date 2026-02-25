"use client";
import React, { useState, useMemo, useEffect, useRef } from "react";
import { ContentCard } from "@/components/ui/ContentCard";
import { ShareBriefingModal } from "@/components/ui/ShareBriefingModal";
import { ShareIcon } from "@/components/icons";
import { generateBriefing } from "@/lib/briefing/ranker";
import { SerendipityBadge } from "@/components/filtering/SerendipityBadge";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { BriefingClassificationBadge } from "@/components/ui/BriefingClassificationBadge";
import { useContent } from "@/contexts/ContentContext";
import { colors, space, fonts, type as t, radii, transitions } from "@/styles/theme";
import type { ContentItem } from "@/lib/types/content";
import type { UserPreferenceProfile } from "@/lib/preferences/types";
import type { SerendipityItem } from "@/lib/filtering/serendipity";

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
}

export const BriefingTab: React.FC<BriefingTabProps> = ({ content, profile, onValidate, onFlag, mobile, nostrKeys, isLoading, discoveries = [], onTabChange }) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showFiltered, setShowFiltered] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const { syncBriefing } = useContent();

  const briefing = useMemo(() => generateBriefing(content, profile), [content, profile]);

  // Deduplicate discoveries against priority + serendipity items
  const dedupedDiscoveries = useMemo(() => {
    const briefingIds = new Set(briefing.priority.map(b => b.item.id));
    if (briefing.serendipity) briefingIds.add(briefing.serendipity.item.id);
    return discoveries.filter(d => !briefingIds.has(d.item.id));
  }, [discoveries, briefing.priority, briefing.serendipity]);

  // Stable key: only changes when the actual briefing composition changes
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

  const insightCount = briefing.priority.length + (briefing.serendipity ? 1 : 0) + dedupedDiscoveries.length;
  const canShare = nostrKeys && briefing.priority.length > 0;

  return (
    <div style={{ animation: "fadeIn .4s ease" }}>
      <div style={{ marginBottom: mobile ? space[8] : space[12] }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h1 style={{
            fontSize: mobile ? t.display.mobileSz : t.display.size,
            fontWeight: t.display.weight,
            lineHeight: t.display.lineHeight,
            letterSpacing: t.display.letterSpacing,
            color: colors.text.primary,
            margin: 0,
          }}>
            Your Briefing
          </h1>
          {canShare && (
            <button
              onClick={() => setShowShareModal(true)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: space[2],
                padding: `${space[2]}px ${space[4]}px`,
                background: colors.bg.surface,
                border: `1px solid ${colors.border.default}`,
                borderRadius: radii.md,
                color: colors.purple[400],
                fontSize: t.bodySm.size,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: transitions.fast,
              }}
            >
              <ShareIcon s={16} />
              Share
            </button>
          )}
        </div>
        <p style={{ fontSize: mobile ? t.body.mobileSz : t.body.size, color: colors.text.muted, marginTop: space[2] }}>
          {insightCount} insights selected from {briefing.totalItems} items
        </p>
      </div>

      {showShareModal && nostrKeys && (
        <ShareBriefingModal
          briefing={briefing}
          nostrKeys={nostrKeys}
          onClose={() => setShowShareModal(false)}
          mobile={mobile}
        />
      )}

      {isLoading ? (
        <div style={{
          textAlign: "center", padding: space[10],
          color: colors.text.muted, background: colors.bg.surface,
          borderRadius: radii.lg, border: `1px solid ${colors.border.default}`,
          marginBottom: space[4],
        }}>
          <div style={{ fontSize: 32, marginBottom: space[3], animation: "pulse 2s infinite" }}>&#x1F6E1;</div>
          <div style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.text.tertiary }}>Loading briefing...</div>
          <div style={{ fontSize: t.bodySm.size, marginTop: space[2] }}>Syncing from Internet Computer</div>
        </div>
      ) : briefing.priority.length > 0 ? (
        <div>
          {briefing.priority.map((b, i) => (
            <div key={b.item.id} style={{ animation: `slideUp .3s ease ${i * 0.06}s both` }}>
              {b.classification !== "mixed" && (
                <div style={{ marginBottom: space[1], display: "flex", alignItems: "center" }}>
                  <BriefingClassificationBadge classification={b.classification} />
                </div>
              )}
              <ContentCard
                item={b.item}
                variant="priority"
                rank={i + 1}
                expanded={expanded === b.item.id}
                onToggle={() => setExpanded(expanded === b.item.id ? null : b.item.id)}
                onValidate={onValidate}
                onFlag={onFlag}
                mobile={mobile}
              />
            </div>
          ))}
        </div>
      ) : (
        <div style={{
          textAlign: "center",
          padding: space[10],
          color: colors.text.muted,
          background: colors.bg.surface,
          borderRadius: radii.lg,
          border: `1px solid ${colors.border.default}`,
          marginBottom: space[4],
        }}>
          <div style={{ fontSize: 32, marginBottom: space[3] }}>&#x1F50D;</div>
          <div style={{ fontSize: t.h3.size, fontWeight: t.h3.weight, color: colors.text.tertiary }}>No priority items yet</div>
          <div style={{ fontSize: t.bodySm.size, marginTop: space[2] }}>Evaluate content and validate quality items to build your personalized briefing</div>
          {onTabChange && (
            <div style={{ marginTop: space[4] }}>
              <button onClick={() => onTabChange("incinerator")} style={{
                padding: `${space[2]}px ${space[4]}px`, background: colors.bg.raised,
                border: `1px solid ${colors.border.emphasis}`, borderRadius: radii.md,
                color: colors.purple[400], fontSize: t.bodySm.size, fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit", transition: transitions.fast,
              }}>
                Start Evaluating &rarr;
              </button>
            </div>
          )}
        </div>
      )}

      {briefing.serendipity && (
        <div style={{ marginTop: space[2], animation: `slideUp .3s ease ${briefing.priority.length * 0.06 + 0.1}s both` }}>
          <ContentCard
            item={briefing.serendipity.item}
            variant="serendipity"
            expanded={expanded === briefing.serendipity.item.id}
            onToggle={() => setExpanded(expanded === briefing.serendipity!.item.id ? null : briefing.serendipity!.item.id)}
            onValidate={onValidate}
            onFlag={onFlag}
            mobile={mobile}
          />
        </div>
      )}

      {dedupedDiscoveries.length > 0 && (
        <div style={{ marginTop: space[4] }}>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: space[2],
            marginBottom: space[3],
          }}>
            <span style={{ fontSize: 18 }}>&#x1F52D;</span>
            <span style={{
              fontSize: t.h3.size,
              fontWeight: t.h3.weight,
              color: colors.purple[400],
            }}>
              Discoveries
            </span>
            <span style={{
              fontSize: t.caption.size,
              color: colors.text.muted,
              background: colors.bg.raised,
              padding: "2px 8px",
              borderRadius: radii.sm,
            }}>
              {dedupedDiscoveries.length}
            </span>
            <InfoTooltip
              text="High-quality content from outside your usual topics or network. These items scored well but cover areas you haven't explored yet."
              mobile={mobile}
            />
          </div>

          {dedupedDiscoveries.map((d, i) => (
            <div key={d.item.id} style={{
              animation: `slideUp .3s ease ${(briefing.priority.length + 1 + i) * 0.06}s both`,
              marginBottom: space[2],
            }}>
              <div style={{
                background: "linear-gradient(135deg, rgba(124,58,237,0.06), rgba(37,99,235,0.04))",
                border: "1px solid rgba(124,58,237,0.15)",
                borderRadius: radii.lg,
                padding: mobile ? `${space[4]}px` : `${space[4]}px ${space[5]}px`,
                position: "relative",
                overflow: "hidden",
              }}>
                <div style={{ position: "absolute", top: space[2], right: space[2] }}>
                  <SerendipityBadge discoveryType={d.discoveryType} mobile={mobile} />
                </div>

                <div style={{
                  display: "flex", alignItems: "center", gap: space[2],
                  paddingBottom: space[2],
                  borderBottom: `1px solid ${colors.border.subtle}`,
                  marginBottom: space[2],
                  paddingRight: mobile ? 40 : 130,
                }}>
                  {d.item.avatar && d.item.avatar.startsWith("http") ? (
                    /* eslint-disable-next-line @next/next/no-img-element -- external user-content URLs */
                    <img src={d.item.avatar} alt="" style={{
                      width: 20, height: 20, borderRadius: "50%", objectFit: "cover",
                      border: `1px solid ${colors.border.default}`,
                    }} />
                  ) : (
                    <span style={{ fontSize: 16 }}>{d.item.avatar}</span>
                  )}
                  <span style={{
                    fontWeight: 700, color: colors.text.secondary,
                    fontSize: t.body.size, fontFamily: fonts.mono,
                  }}>
                    {d.item.author}
                  </span>
                  <span style={{
                    fontSize: t.caption.size, color: colors.text.muted,
                    background: colors.bg.raised, padding: "2px 8px", borderRadius: radii.sm,
                  }}>
                    {d.item.source}
                  </span>
                </div>

                <p style={{
                  color: colors.purple[300],
                  fontSize: mobile ? t.body.mobileSz : t.body.size,
                  lineHeight: t.body.lineHeight,
                  margin: 0,
                  wordBreak: "break-word",
                }}>
                  {d.item.text}
                </p>

                <div style={{
                  marginTop: space[2],
                  fontSize: t.caption.size,
                  color: colors.purple[400],
                  fontStyle: "italic",
                }}>
                  {d.reason}
                </div>

                {d.item.sourceUrl && /^https?:\/\//i.test(d.item.sourceUrl) && (
                  <a
                    href={d.item.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      marginTop: space[2],
                      fontSize: t.caption.size,
                      color: colors.cyan[400],
                      textDecoration: "none",
                      fontWeight: 600,
                      wordBreak: "break-all",
                    }}
                  >
                    {(() => { try { return new URL(d.item.sourceUrl).hostname; } catch { return d.item.sourceUrl; } })()}
                    <span style={{ fontSize: 10 }}>{"\u2197"}</span>
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {briefing.filteredOut.length > 0 && (
        <div style={{ marginTop: space[5] }}>
          <button
            onClick={() => setShowFiltered(!showFiltered)}
            aria-expanded={showFiltered}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: space[2],
              padding: `${space[3]}px ${space[4]}px`,
              background: colors.bg.surface,
              border: `1px solid ${colors.border.default}`,
              borderRadius: radii.md,
              color: colors.text.muted,
              fontSize: t.bodySm.size,
              fontWeight: 600,
              cursor: "pointer",
              transition: transitions.normal,
              fontFamily: "inherit",
            }}
          >
            <span style={{ transform: showFiltered ? "rotate(180deg)" : "rotate(0deg)", transition: "transform .2s", display: "inline-block" }}>
              &#x25BC;
            </span>
            Filtered Out ({briefing.filteredOut.length} items)
          </button>

          {showFiltered && (
            <div style={{ marginTop: space[3] }}>
              {briefing.filteredOut.map((it, i) => (
                <div key={it.id} style={{ animation: `slideUp .2s ease ${i * 0.03}s both` }}>
                  <ContentCard
                    item={it}
                    expanded={expanded === it.id}
                    onToggle={() => setExpanded(expanded === it.id ? null : it.id)}
                    onValidate={onValidate}
                    onFlag={onFlag}
                    mobile={mobile}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
