"use client";

import React, { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./dialog";
import { WhyFilteredModal, type BurnReasonKind } from "./WhyFilteredModal";
import type { ContentItem } from "@/lib/types/content";
import type { BurnedByRule } from "@/lib/filtering/types";

export interface BurnedItemsDrawerProps {
  open: boolean;
  onClose: () => void;
  /** All items including slop verdicts (today's window or full set). */
  items: ContentItem[];
  /** Item IDs the pipeline burned via custom rule, with which rule. */
  burnedByRule: BurnedByRule[];
  /** Item IDs the pipeline burned via composite < threshold. */
  burnedByThreshold: string[];
  qualityThreshold: number;
  /** Optional cap on rendered items (defaults 100). */
  maxItems?: number;
}

interface RowEntry {
  item: ContentItem;
  reason: BurnReasonKind;
}

function classify(
  item: ContentItem,
  byRule: Map<string, BurnedByRule>,
  byThreshold: Set<string>,
  threshold: number,
): BurnReasonKind | null {
  const rule = byRule.get(item.id);
  if (rule) return { kind: "custom-rule", rule };
  if (byThreshold.has(item.id)) {
    return { kind: "below-threshold", composite: item.scores.composite, threshold };
  }
  if (item.verdict === "slop") return { kind: "verdict-slop" };
  return null;
}

export const BurnedItemsDrawer: React.FC<BurnedItemsDrawerProps> = ({
  open,
  onClose,
  items,
  burnedByRule,
  burnedByThreshold,
  qualityThreshold,
  maxItems = 100,
}) => {
  const [selected, setSelected] = useState<RowEntry | null>(null);

  const rows = useMemo<RowEntry[]>(() => {
    const byRule = new Map<string, BurnedByRule>(burnedByRule.map(b => [b.itemId, b]));
    const byThreshold = new Set<string>(burnedByThreshold);
    const out: RowEntry[] = [];
    for (const item of items) {
      const reason = classify(item, byRule, byThreshold, qualityThreshold);
      if (!reason) continue;
      out.push({ item, reason });
      if (out.length >= maxItems) break;
    }
    return out;
  }, [items, burnedByRule, burnedByThreshold, qualityThreshold, maxItems]);

  const ruleCount = burnedByRule.length;
  const thresholdCount = burnedByThreshold.length;
  const slopCount = rows.filter(r => r.reason.kind === "verdict-slop").length;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent
          data-testid="burned-items-drawer"
          className="max-w-2xl max-h-[80vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>Filtered out — {rows.length} item{rows.length === 1 ? "" : "s"}</DialogTitle>
          </DialogHeader>

          {/* Summary */}
          <div className="flex flex-wrap gap-2 text-caption">
            <span className="rounded-md bg-orange-500/[0.08] border border-orange-500/20 px-2 py-1 text-orange-300">
              Slop: <span className="font-mono font-bold">{slopCount}</span>
            </span>
            <span className="rounded-md bg-red-500/[0.08] border border-red-500/20 px-2 py-1 text-red-300">
              Below threshold: <span className="font-mono font-bold">{thresholdCount}</span>
            </span>
            <span className="rounded-md bg-amber-500/[0.08] border border-amber-500/20 px-2 py-1 text-amber-300">
              Custom rule: <span className="font-mono font-bold">{ruleCount}</span>
            </span>
          </div>

          {/* Empty state */}
          {rows.length === 0 && (
            <p className="text-body-sm text-muted-foreground py-6 text-center">
              Nothing has been filtered out yet. Burned items will appear here when the scoring engine drops them.
            </p>
          )}

          {/* List */}
          {rows.length > 0 && (
            <ul className="flex flex-col gap-2">
              {rows.map(({ item, reason }) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-caption text-muted-foreground">
                      <span className="font-semibold text-tertiary">{item.author}</span>
                      {item.source && <span> · {item.source}</span>}
                    </div>
                    <div className="text-body-sm truncate">{item.text}</div>
                    <div className="text-caption text-disabled mt-0.5">
                      {reason.kind === "custom-rule" && (
                        <>Rule on <span className="font-mono">{reason.rule.field}</span>: &quot;{reason.rule.pattern}&quot;</>
                      )}
                      {reason.kind === "below-threshold" && (
                        <>Composite <span className="font-mono">{reason.composite.toFixed(1)}</span> &lt; threshold <span className="font-mono">{reason.threshold.toFixed(1)}</span></>
                      )}
                      {reason.kind === "verdict-slop" && <>Classified as slop by scoring engine</>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelected({ item, reason })}
                    className="rounded-md border border-border bg-muted/30 px-2 py-1 text-caption text-tertiary hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    Why?
                  </button>
                </li>
              ))}
            </ul>
          )}

          {items.length > rows.length && rows.length === maxItems && (
            <p className="text-caption text-disabled mt-2 text-center">
              Showing the first {maxItems}. Older filtered items are available via your local cache.
            </p>
          )}
        </DialogContent>
      </Dialog>

      <WhyFilteredModal
        open={selected !== null}
        onClose={() => setSelected(null)}
        item={selected?.item ?? null}
        reason={selected?.reason ?? null}
        qualityThreshold={qualityThreshold}
      />
    </>
  );
};
