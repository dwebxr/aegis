import React from "react";
import type { StoredComment } from "@/lib/d2a/comments";
import { colors, space, radii, type as t } from "@/styles/theme";

interface CommentThreadProps {
  comments: StoredComment[];
  currentUserPk?: string;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export const CommentThread: React.FC<CommentThreadProps> = ({ comments, currentUserPk }) => {
  if (comments.length === 0) return null;

  const sorted = [...comments].sort((a, b) => a.timestamp - b.timestamp);

  return (
    <div style={{ marginTop: space[2], display: "flex", flexDirection: "column", gap: space[1] }}>
      {sorted.map(c => {
        const isSent = c.direction === "sent" || (currentUserPk && c.senderPk === currentUserPk);
        return (
          <div key={c.id} style={{
            display: "flex",
            justifyContent: isSent ? "flex-end" : "flex-start",
          }}>
            <div style={{
              maxWidth: "80%",
              padding: `${space[1]}px ${space[2]}px`,
              borderRadius: radii.sm,
              background: isSent ? `${colors.cyan[400]}12` : colors.bg.raised,
              border: `1px solid ${isSent ? `${colors.cyan[400]}25` : colors.border.default}`,
            }}>
              <div style={{
                fontSize: t.bodySm.size,
                color: colors.text.secondary,
                lineHeight: 1.5,
                wordBreak: "break-word",
              }}>
                {c.comment}
              </div>
              <div style={{
                fontSize: 9,
                color: colors.text.disabled,
                marginTop: 2,
                textAlign: isSent ? "right" : "left",
              }}>
                {isSent ? "You" : c.senderPk.slice(0, 8) + "..."} · {formatTime(c.timestamp)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
