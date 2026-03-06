import { useState, useCallback, useRef, useEffect } from "react";

const STORAGE_KEY = "aegis-collapsed-sections";

function loadCollapsed(): Set<string> {
  if (typeof globalThis.localStorage === "undefined") return new Set();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return new Set();
  try { return new Set(JSON.parse(raw)); } catch { return new Set(); }
}

function saveCollapsed(set: Set<string>): void {
  if (typeof globalThis.localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
}

/**
 * Manages expand/collapse state with IntersectionObserver auto-reveal.
 *
 * - Sections auto-expand when they scroll into view (once).
 * - If user manually collapses a section, it stays collapsed and is
 *   persisted to localStorage across sessions.
 * - `observeRef` returns a callback ref to attach to each section's wrapper div.
 */
export function useAutoReveal() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const manuallyCollapsed = useRef<Set<string>>(loadCollapsed());
  const revealed = useRef<Set<string>>(new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const elementMap = useRef<Map<string, Element>>(new Map());

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const toExpand: string[] = [];
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = (entry.target as HTMLElement).dataset.autoRevealId;
          if (!id) continue;
          if (revealed.current.has(id)) continue;
          if (manuallyCollapsed.current.has(id)) continue;
          revealed.current.add(id);
          toExpand.push(id);
        }
        if (toExpand.length > 0) {
          setExpanded(prev => {
            const next = new Set(prev);
            for (const id of toExpand) next.add(id);
            return next;
          });
        }
      },
      { rootMargin: "0px 0px 100px 0px", threshold: 0 },
    );

    // Observe any elements already registered
    elementMap.current.forEach((el) => observerRef.current!.observe(el));

    return () => { observerRef.current?.disconnect(); };
  }, []);

  const observeRef = useCallback((id: string) => {
    return (el: HTMLElement | null) => {
      const prev = elementMap.current.get(id);
      if (prev) observerRef.current?.unobserve(prev);
      if (el) {
        el.dataset.autoRevealId = id;
        elementMap.current.set(id, el);
        observerRef.current?.observe(el);
      } else {
        elementMap.current.delete(id);
      }
    };
  }, []);

  const toggle = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        manuallyCollapsed.current.add(id);
      } else {
        next.add(id);
        manuallyCollapsed.current.delete(id);
      }
      saveCollapsed(manuallyCollapsed.current);
      return next;
    });
  }, []);

  const isExpanded = useCallback((id: string) => expanded.has(id), [expanded]);

  return { isExpanded, toggle, observeRef };
}
