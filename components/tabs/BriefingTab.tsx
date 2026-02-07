"use client";
import React, { useState, useMemo } from "react";
import { ContentCard } from "@/components/ui/ContentCard";
import { generateBriefing } from "@/lib/briefing/ranker";
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
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: mobile ? 22 : 28, fontWeight: 800, color: "#f1f5f9", margin: 0 }}>
          Your Briefing
        </h1>
        <p style={{ fontSize: 13, color: "#64748b", marginTop: 6 }}>
          {insightCount} insights selected from {briefing.totalItems} items
        </p>
      </div>

      {/* Priority cards */}
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
          padding: 40,
          color: "#64748b",
          background: "rgba(255,255,255,0.02)",
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.05)",
          marginBottom: 16,
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>&#x1F50D;</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#94a3b8" }}>No priority items yet</div>
          <div style={{ fontSize: 12, marginTop: 6 }}>Add sources and evaluate content to build your briefing</div>
        </div>
      )}

      {/* Serendipity card */}
      {briefing.serendipity && (
        <div style={{ marginTop: 8, animation: `slideUp .3s ease ${briefing.priority.length * 0.06 + 0.1}s both` }}>
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

      {/* Filtered out section */}
      {briefing.filteredOut.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <button
            onClick={() => setShowFiltered(!showFiltered)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: "12px 16px",
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 12,
              color: "#64748b",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all .2s",
            }}
          >
            <span style={{ transform: showFiltered ? "rotate(180deg)" : "rotate(0deg)", transition: "transform .2s", display: "inline-block" }}>
              &#x25BC;
            </span>
            Filtered Out ({briefing.filteredOut.length} items)
          </button>

          {showFiltered && (
            <div style={{ marginTop: 12 }}>
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
