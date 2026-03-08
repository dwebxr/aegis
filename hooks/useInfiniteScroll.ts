import { useRef, useCallback, useEffect } from "react";

/**
 * Triggers `onLoadMore` when a sentinel element scrolls near the viewport.
 * Returns a callback ref to attach to a sentinel div at the bottom of the list.
 */
export function useInfiniteScroll(hasMore: boolean, onLoadMore: () => void) {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          onLoadMoreRef.current();
        }
      },
      { rootMargin: "0px 0px 300px 0px", threshold: 0 },
    );

    if (sentinelRef.current) {
      observerRef.current.observe(sentinelRef.current);
    }

    return () => { observerRef.current?.disconnect(); };
  }, []);

  // Re-observe when hasMore changes (disconnect when nothing left)
  useEffect(() => {
    if (!observerRef.current || !sentinelRef.current) return;
    if (hasMore) {
      observerRef.current.observe(sentinelRef.current);
    } else {
      observerRef.current.unobserve(sentinelRef.current);
    }
  }, [hasMore]);

  const ref = useCallback((el: HTMLDivElement | null) => {
    if (sentinelRef.current && observerRef.current) {
      observerRef.current.unobserve(sentinelRef.current);
    }
    sentinelRef.current = el;
    if (el && observerRef.current && hasMore) {
      observerRef.current.observe(el);
    }
  }, [hasMore]);

  return ref;
}
