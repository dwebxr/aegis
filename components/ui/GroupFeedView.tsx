"use client";
import React, { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { ContentCard } from "./ContentCard";
import type { ContentItem } from "@/lib/types/content";
import type { CurationGroup } from "@/lib/d2a/curationGroup";

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
  const handleToggle = useCallback((id: string) => {
    setExpanded(prev => prev === id ? null : id);
  }, []);
  const [memberInput, setMemberInput] = useState("");
  const [showMembers, setShowMembers] = useState(false);

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button
          onClick={() => setShowMembers(!showMembers)}
          className={cn(
            "rounded-sm px-2 py-1 text-caption font-semibold cursor-pointer font-[inherit] transition-fast border",
            showMembers
              ? "bg-purple-400/[0.07] border-purple-400/20 text-purple-400"
              : "bg-transparent border-border text-muted-foreground"
          )}
        >
          Members ({group.members.length})
        </button>
        {onSync && (
          <button onClick={onSync} className="bg-transparent border border-border rounded-sm px-2 py-1 text-caption font-semibold text-muted-foreground cursor-pointer font-[inherit] transition-fast">
            Sync
          </button>
        )}
      </div>

      {showMembers && (
        <div className="bg-card border border-border rounded-md p-3 mb-3">
          {group.members.map(pk => (
            <div key={pk} className="flex items-center justify-between py-1 border-b border-border">
              <code className="font-mono text-caption text-secondary-foreground">
                {pk.slice(0, 12)}...{pk.slice(-4)}
                {pk === currentUserPk && " (you)"}
                {pk === group.ownerPk && " (owner)"}
              </code>
              {isOwner && pk !== group.ownerPk && onRemoveMember && (
                <button onClick={() => onRemoveMember(pk)} className="bg-transparent border-none cursor-pointer text-caption text-red-400 font-[inherit]">
                  Remove
                </button>
              )}
            </div>
          ))}
          {isOwner && onAddMember && (
            <div className="flex gap-1 mt-2">
              <input
                value={memberInput}
                onChange={e => setMemberInput(e.target.value)}
                placeholder="npub or hex pubkey..."
                className="flex-1 px-2 py-1 bg-navy-lighter border border-border rounded-sm text-secondary-foreground text-caption font-sans"
              />
              <button
                onClick={() => {
                  if (memberInput.trim()) {
                    onAddMember(memberInput.trim());
                    setMemberInput("");
                  }
                }}
                className="px-2 py-1 bg-purple-400/[0.07] border border-purple-400/20 rounded-sm text-purple-400 text-caption font-semibold cursor-pointer font-[inherit]"
              >
                Add
              </button>
            </div>
          )}
        </div>
      )}

      {feed.length > 0 ? (
        feed.map((item, i) => (
          <div key={item.id} style={{ animation: `slideUp .3s ease ${i * 0.04}s both` }}>
            <ContentCard
              item={item}
              expanded={expanded === item.id}
              onToggle={handleToggle}
              onValidate={onValidate}
              onFlag={onFlag}
              mobile={mobile}
            />
          </div>
        ))
      ) : (
        <div className="text-center p-8 text-muted-foreground text-body-sm">
          No validated content from group members yet.
        </div>
      )}
    </div>
  );
};
