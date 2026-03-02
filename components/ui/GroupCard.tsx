import React from "react";
import type { CurationGroup } from "@/lib/d2a/curationGroup";
import { colors, space, radii, type as t, transitions, fonts } from "@/styles/theme";

interface GroupCardProps {
  group: CurationGroup;
  feedCount: number;
  isOwner: boolean;
  expanded: boolean;
  onToggle: () => void;
  onDelete?: () => void;
  mobile?: boolean;
}

export const GroupCard: React.FC<GroupCardProps> = ({
  group, feedCount, isOwner, expanded, onToggle, onDelete, mobile,
}) => {
  return (
    <div style={{
      background: colors.bg.surface,
      border: `1px solid ${expanded ? colors.purple[400] + "33" : colors.border.default}`,
      borderRadius: radii.lg,
      padding: mobile ? space[3] : space[4],
      marginBottom: space[2],
      cursor: "pointer",
      transition: transitions.fast,
    }} onClick={onToggle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{
            fontSize: mobile ? t.h3.mobileSz : t.h3.size,
            fontWeight: t.h3.weight, color: colors.text.primary,
          }}>
            {group.name}
          </div>
          {group.description && (
            <div style={{
              fontSize: t.bodySm.size, color: colors.text.muted,
              marginTop: 2,
              overflow: "hidden", textOverflow: "ellipsis",
              whiteSpace: expanded ? "normal" : "nowrap",
              maxWidth: expanded ? "none" : 300,
            }}>
              {group.description}
            </div>
          )}
        </div>

        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{
            fontSize: t.h3.size, fontWeight: 700,
            fontFamily: fonts.mono, color: colors.purple[400],
          }}>
            {feedCount}
          </div>
          <div style={{ fontSize: 9, color: colors.text.muted, textTransform: "uppercase" }}>Items</div>
        </div>
      </div>

      {/* Tags and meta */}
      <div style={{ display: "flex", gap: space[2], marginTop: space[2], flexWrap: "wrap", alignItems: "center" }}>
        <span style={{
          fontSize: t.caption.size, color: colors.text.disabled,
          background: colors.bg.raised, padding: `1px ${space[2]}px`,
          borderRadius: radii.sm,
        }}>
          {group.members.length} member{group.members.length !== 1 ? "s" : ""}
        </span>
        {group.topics.map(tp => (
          <span key={tp} style={{
            fontSize: t.caption.size,
            padding: `1px ${space[2]}px`,
            background: `${colors.cyan[400]}10`,
            border: `1px solid ${colors.cyan[400]}20`,
            borderRadius: radii.pill,
            color: colors.cyan[400],
          }}>
            {tp}
          </span>
        ))}
        {isOwner && (
          <span style={{
            fontSize: 9, fontWeight: 700,
            padding: "1px 6px", borderRadius: radii.pill,
            background: "rgba(167,139,250,0.12)",
            color: colors.purple[400],
            textTransform: "uppercase",
          }}>
            Owner
          </span>
        )}
        {isOwner && onDelete && (
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            style={{
              background: "none", border: `1px solid ${colors.red[400]}33`,
              borderRadius: radii.sm, padding: `1px ${space[2]}px`,
              fontSize: t.caption.size, color: colors.red[400],
              cursor: "pointer", fontFamily: "inherit",
              transition: transitions.fast,
            }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
};
