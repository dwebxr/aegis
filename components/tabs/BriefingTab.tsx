"use client";
import React, { useState, useMemo } from "react";
import { ContentCard } from "@/components/ui/ContentCard";
import { generateBriefing } from "@/lib/briefing/ranker";
import { colors, space, type as t, radii, transitions } from "@/styles/theme";
import type { ContentItem } from "@/lib/types/content";
import type { UserPreferenceProfile } from "@/lib/preferences/types";
import { createEmptyProfile } from "@/lib/preferences/types";

interface BriefingTabProps {
  content: ContentItem[];
  profile: UserPreferenceProfile;
  onValidate: (id: string) => void;
  onFlag: (id: string) => void;
  mobile?: boolean;
}

export const BriefingTab: React.FC<BriefingTabProps> = ({ content, profile, onValidate, onFlag, mobile }) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showFiltered, setShowFiltered] = useState(false);

  const briefing = useMemo(() => {
    const p = profile.principalId ? profile : createEmptyProfile("anonymous");
    return generateBriefing(content, p);
  }, [content, profile]);

  const insightCount = briefing.priority.length + (briefing.serendipity ? 1 : 0);

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
          Your Briefing
        </h1>
        <p style={{ fontSize: mobile ? t.body.mobileSz : t.body.size, color: colors.text.muted, marginTop: space[2] }}>
          {insightCount} insights selected from {briefing.totalItems} items
        </p>
      </div>

      {briefing.priority.length > 0 ? (
        <div>
          {briefing.priority.map((b, i) => (
            <div key={b.item.id} style={{ animation: `slideUp .3s ease ${i * 0.06}s both` }}>
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
          <div style={{ fontSize: t.bodySm.size, marginTop: space[2] }}>Add sources and evaluate content to build your briefing</div>
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

      {briefing.filteredOut.length > 0 && (
        <div style={{ marginTop: space[5] }}>
          <button
            onClick={() => setShowFiltered(!showFiltered)}
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
