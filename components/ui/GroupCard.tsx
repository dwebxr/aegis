import React from "react";
import { cn } from "@/lib/utils";
import type { CurationGroup } from "@/lib/d2a/curationGroup";

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
    <div className={cn(
      "bg-card border rounded-lg cursor-pointer transition-fast mb-2",
      mobile ? "p-3" : "p-4",
      expanded ? "border-purple-400/20" : "border-border"
    )} onClick={onToggle}>
      <div className="flex items-center justify-between">
        <div>
          <div className={cn("font-semibold text-foreground", mobile ? "text-body" : "text-h3")}>
            {group.name}
          </div>
          {group.description && (
            <div className={cn(
              "text-body-sm text-muted-foreground mt-0.5 overflow-hidden text-ellipsis",
              expanded ? "whitespace-normal" : "whitespace-nowrap max-w-[300px]"
            )}>
              {group.description}
            </div>
          )}
        </div>

        <div className="text-right shrink-0">
          <div className="text-h3 font-bold font-mono text-purple-400">
            {feedCount}
          </div>
          <div className="text-[9px] text-muted-foreground uppercase">Items</div>
        </div>
      </div>

      {/* Tags and meta */}
      <div className="flex gap-2 mt-2 flex-wrap items-center">
        <span className="text-caption text-[var(--color-text-disabled)] bg-navy-lighter px-2 py-px rounded-sm">
          {group.members.length} member{group.members.length !== 1 ? "s" : ""}
        </span>
        {group.topics.map(tp => (
          <span key={tp} className="text-caption px-2 py-px bg-cyan-400/[0.06] border border-cyan-400/[0.12] rounded-full text-cyan-400">
            {tp}
          </span>
        ))}
        {isOwner && (
          <span className="text-[9px] font-bold px-1.5 py-px rounded-full bg-purple-400/[0.12] text-purple-400 uppercase">
            Owner
          </span>
        )}
        {isOwner && onDelete && (
          <button
            onClick={e => { e.stopPropagation(); onDelete(); }}
            className="bg-transparent border border-red-400/20 rounded-sm px-2 py-px text-caption text-red-400 cursor-pointer font-[inherit] transition-fast"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
};
