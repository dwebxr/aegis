import React, { useState } from "react";
import { cn } from "@/lib/utils";
import type { D2ACommentPayload } from "@/lib/agent/types";
import { MAX_COMMENT_LENGTH } from "@/lib/agent/protocol";

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
    <div className="mt-2">
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={`Comment to ${peerPubkey.slice(0, 8)}...`}
        maxLength={MAX_COMMENT_LENGTH}
        rows={2}
        className="w-full p-2 bg-navy-lighter border border-border rounded-sm text-secondary-foreground text-body-sm font-sans resize-y min-h-[48px] box-border"
      />
      <div className="flex justify-between items-center mt-1">
        <span className={cn("text-caption", remaining < 20 ? "text-amber-400" : "text-[var(--color-text-disabled)]")}>
          {remaining}
        </span>
        <button
          onClick={handleSend}
          disabled={!canSend}
          className={cn(
            "px-3 py-1 rounded-sm text-caption font-bold cursor-pointer font-[inherit] transition-fast",
            canSend
              ? "bg-amber-400/[0.09] border border-amber-400/20 text-amber-400"
              : "bg-transparent border border-border text-[var(--color-text-disabled)] cursor-default opacity-50"
          )}
        >
          Send
        </button>
      </div>
    </div>
  );
};
