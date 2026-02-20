"use client";
import { useEffect, useRef, useState, useCallback } from "react";

interface UseKeyboardNavOptions {
  items: string[];
  expandedId: string | null;
  onExpand: (id: string | null) => void;
  onValidate: (id: string) => void;
  onFlag: (id: string) => void;
  onOpenPalette: () => void;
  enabled: boolean;
}

function isInputElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable;
}

export function useKeyboardNav({
  items,
  expandedId,
  onExpand,
  onValidate,
  onFlag,
  onOpenPalette,
  enabled,
}: UseKeyboardNavOptions) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const indexRef = useRef(-1);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const focusItem = useCallback((index: number) => {
    const id = itemsRef.current[index];
    if (!id) return;
    indexRef.current = index;
    setFocusedId(id);
    const el = document.getElementById(`card-${id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (isInputElement(document.activeElement)) return;

      // Cmd+K / Ctrl+K — command palette
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenPalette();
        return;
      }

      const len = itemsRef.current.length;
      if (len === 0) return;

      switch (e.key) {
        case "j": {
          e.preventDefault();
          const next = Math.min(indexRef.current + 1, len - 1);
          focusItem(next);
          break;
        }
        case "k": {
          e.preventDefault();
          const prev = Math.max(indexRef.current - 1, 0);
          focusItem(prev);
          break;
        }
        case "Enter":
        case "l": {
          e.preventDefault();
          const id = itemsRef.current[indexRef.current];
          if (id) onExpand(expandedId === id ? null : id);
          break;
        }
        case "h": {
          e.preventDefault();
          if (expandedId) onExpand(null);
          break;
        }
        case "Escape": {
          if (expandedId) {
            e.preventDefault();
            onExpand(null);
          }
          break;
        }
        case "v": {
          e.preventDefault();
          const id = itemsRef.current[indexRef.current];
          if (id) onValidate(id);
          break;
        }
        case "f": {
          e.preventDefault();
          const id = itemsRef.current[indexRef.current];
          if (id) onFlag(id);
          break;
        }
        case "o": {
          e.preventDefault();
          const id = itemsRef.current[indexRef.current];
          if (id) {
            const el = document.getElementById(`card-${id}`);
            // Check data-source-url (works on collapsed cards) then fall back to link
            const url = el?.getAttribute("data-source-url");
            if (url) {
              window.open(url, "_blank", "noopener,noreferrer");
            } else {
              const link = el?.querySelector("a[target='_blank']") as HTMLAnchorElement | null;
              if (link) window.open(link.href, "_blank", "noopener,noreferrer");
            }
          }
          break;
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [enabled, expandedId, onExpand, onValidate, onFlag, onOpenPalette, focusItem]);

  // Reset focus when items change significantly
  useEffect(() => {
    if (indexRef.current >= items.length) {
      indexRef.current = -1;
      setFocusedId(null);
    }
  }, [items]);

  return { focusedId };
}
