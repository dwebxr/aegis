import React from "react";
import { cn } from "@/lib/utils";
import type { StoredComment } from "@/lib/d2a/comments";

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
    <div className="mt-2 flex flex-col gap-1">
      {sorted.map(c => {
        const isSent = c.direction === "sent" || (currentUserPk && c.senderPk === currentUserPk);
        return (
          <div key={c.id} className={cn("flex", isSent ? "justify-end" : "justify-start")}>
            <div className={cn(
              "max-w-[80%] px-2 py-1 rounded-sm",
              isSent
                ? "bg-cyan-400/[0.07] border border-cyan-400/[0.14]"
                : "bg-raised border border-border"
            )}>
              <div className="text-body-sm text-secondary-foreground leading-body-sm break-words">
                {c.comment}
              </div>
              <div className={cn(
                "text-tiny text-disabled mt-0.5",
                isSent ? "text-right" : "text-left"
              )}>
                {isSent ? "You" : c.senderPk.slice(0, 8) + "..."} · {formatTime(c.timestamp)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
