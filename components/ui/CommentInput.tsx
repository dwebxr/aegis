import React, { useState } from "react";
import type { D2ACommentPayload } from "@/lib/agent/types";
import { MAX_COMMENT_LENGTH } from "@/lib/agent/protocol";
import { colors, space, radii, type as t, transitions, fonts } from "@/styles/theme";

interface CommentInputProps {
  contentHash: string;
  contentTitle: string;
  peerPubkey: string;
  onSend: (payload: D2ACommentPayload) => void;
}

export const CommentInput: React.FC<CommentInputProps> = ({
  contentHash, contentTitle, peerPubkey, onSend,
}) => {
  const [text, setText] = useState("");
  const remaining = MAX_COMMENT_LENGTH - text.length;
  const canSend = text.trim().length > 0 && remaining >= 0;

  const handleSend = () => {
    if (!canSend) return;
    onSend({
      contentHash,
      contentTitle: contentTitle.slice(0, 80),
      comment: text.trim(),
      timestamp: Date.now(),
    });
    setText("");
  };

  return (
    <div style={{ marginTop: space[2] }}>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={`Comment to ${peerPubkey.slice(0, 8)}...`}
        maxLength={MAX_COMMENT_LENGTH}
        rows={2}
        style={{
          width: "100%",
          padding: space[2],
          background: colors.bg.raised,
          border: `1px solid ${colors.border.default}`,
          borderRadius: radii.sm,
          color: colors.text.secondary,
          fontSize: t.bodySm.size,
          fontFamily: fonts.sans,
          resize: "vertical",
          minHeight: 48,
          boxSizing: "border-box",
        }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: space[1] }}>
        <span style={{
          fontSize: t.caption.size,
          color: remaining < 20 ? colors.amber[400] : colors.text.disabled,
        }}>
          {remaining}
        </span>
        <button
          onClick={handleSend}
          disabled={!canSend}
          style={{
            padding: `${space[1]}px ${space[3]}px`,
            background: canSend ? `${colors.amber[400]}18` : "transparent",
            border: `1px solid ${canSend ? `${colors.amber[400]}33` : colors.border.default}`,
            borderRadius: radii.sm,
            color: canSend ? colors.amber[400] : colors.text.disabled,
            fontSize: t.caption.size,
            fontWeight: 700,
            cursor: canSend ? "pointer" : "default",
            fontFamily: "inherit",
            transition: transitions.fast,
            opacity: canSend ? 1 : 0.5,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
};
