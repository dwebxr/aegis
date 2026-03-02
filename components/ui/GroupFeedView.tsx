"use client";
import React, { useState } from "react";
import { ContentCard } from "./ContentCard";
import type { ContentItem } from "@/lib/types/content";
import type { CurationGroup } from "@/lib/d2a/curationGroup";
import { colors, space, radii, type as t, transitions, fonts } from "@/styles/theme";

interface GroupFeedViewProps {
  group: CurationGroup;
  feed: ContentItem[];
  isOwner: boolean;
  currentUserPk?: string;
  onValidate: (id: string) => void;
  onFlag: (id: string) => void;
  onAddMember?: (pubkey: string) => void;
  onRemoveMember?: (pubkey: string) => void;
  onSync?: () => void;
  mobile?: boolean;
}

export const GroupFeedView: React.FC<GroupFeedViewProps> = ({
  group, feed, isOwner, currentUserPk, onValidate, onFlag,
  onAddMember, onRemoveMember, onSync, mobile,
}) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [memberInput, setMemberInput] = useState("");
  const [showMembers, setShowMembers] = useState(false);

  return (
    <div style={{ marginTop: space[2] }}>
      {/* Header actions */}
      <div style={{
        display: "flex", alignItems: "center", gap: space[2],
        marginBottom: space[3], flexWrap: "wrap",
      }}>
        <button
          onClick={() => setShowMembers(!showMembers)}
          style={{
            background: showMembers ? `${colors.purple[400]}12` : "transparent",
            border: `1px solid ${showMembers ? `${colors.purple[400]}33` : colors.border.default}`,
            borderRadius: radii.sm, padding: `${space[1]}px ${space[2]}px`,
            fontSize: t.caption.size, fontWeight: 600,
            color: showMembers ? colors.purple[400] : colors.text.muted,
            cursor: "pointer", fontFamily: "inherit", transition: transitions.fast,
          }}
        >
          Members ({group.members.length})
        </button>
        {onSync && (
          <button onClick={onSync} style={{
            background: "transparent",
            border: `1px solid ${colors.border.default}`,
            borderRadius: radii.sm, padding: `${space[1]}px ${space[2]}px`,
            fontSize: t.caption.size, fontWeight: 600,
            color: colors.text.muted, cursor: "pointer",
            fontFamily: "inherit", transition: transitions.fast,
          }}>
            Sync
          </button>
        )}
      </div>

      {/* Members panel */}
      {showMembers && (
        <div style={{
          background: colors.bg.surface, border: `1px solid ${colors.border.default}`,
          borderRadius: radii.md, padding: space[3], marginBottom: space[3],
        }}>
          {group.members.map(pk => (
            <div key={pk} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: `${space[1]}px 0`,
              borderBottom: `1px solid ${colors.border.default}`,
            }}>
              <code style={{ fontFamily: fonts.mono, fontSize: t.caption.size, color: colors.text.secondary }}>
                {pk.slice(0, 12)}...{pk.slice(-4)}
                {pk === currentUserPk && " (you)"}
                {pk === group.ownerPk && " (owner)"}
              </code>
              {isOwner && pk !== group.ownerPk && onRemoveMember && (
                <button onClick={() => onRemoveMember(pk)} style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: t.caption.size, color: colors.red[400],
                  fontFamily: "inherit",
                }}>
                  Remove
                </button>
              )}
            </div>
          ))}
          {isOwner && onAddMember && (
            <div style={{ display: "flex", gap: space[1], marginTop: space[2] }}>
              <input
                value={memberInput}
                onChange={e => setMemberInput(e.target.value)}
                placeholder="npub or hex pubkey..."
                style={{
                  flex: 1, padding: `${space[1]}px ${space[2]}px`,
                  background: colors.bg.raised, border: `1px solid ${colors.border.default}`,
                  borderRadius: radii.sm, color: colors.text.secondary,
                  fontSize: t.caption.size, fontFamily: fonts.sans,
                }}
              />
              <button
                onClick={() => {
                  if (memberInput.trim()) {
                    onAddMember(memberInput.trim());
                    setMemberInput("");
                  }
                }}
                style={{
                  padding: `${space[1]}px ${space[2]}px`,
                  background: `${colors.purple[400]}12`,
                  border: `1px solid ${colors.purple[400]}33`,
                  borderRadius: radii.sm, color: colors.purple[400],
                  fontSize: t.caption.size, fontWeight: 600,
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Add
              </button>
            </div>
          )}
        </div>
      )}

      {/* Feed items */}
      {feed.length > 0 ? (
        feed.map((item, i) => (
          <div key={item.id} style={{ animation: `slideUp .3s ease ${i * 0.04}s both` }}>
            <ContentCard
              item={item}
              expanded={expanded === item.id}
              onToggle={() => setExpanded(expanded === item.id ? null : item.id)}
              onValidate={onValidate}
              onFlag={onFlag}
              mobile={mobile}
            />
          </div>
        ))
      ) : (
        <div style={{
          textAlign: "center", padding: space[8],
          color: colors.text.muted, fontSize: t.bodySm.size,
        }}>
          No validated content from group members yet.
        </div>
      )}
    </div>
  );
};
