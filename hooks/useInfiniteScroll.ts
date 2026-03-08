import { useRef, useCallback, useEffect } from "react";

/**
 * Triggers `onLoadMore` when a sentinel element scrolls near the viewport.
 * Returns a callback ref to attach to a sentinel div at the bottom of the list.
 *
 * The sentinel should be conditionally rendered (`{hasMore && <div ref={ref} />}`)
 * so it unmounts when there is nothing left to load.
 */
export function useInfiniteScroll(onLoadMore: () => void) {
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

  const ref = useCallback((el: HTMLDivElement | null) => {
    if (sentinelRef.current && observerRef.current) {
      observerRef.current.unobserve(sentinelRef.current);
    }
    sentinelRef.current = el;
    if (el && observerRef.current) {
      observerRef.current.observe(el);
    }
  }, []);

  return ref;
}
