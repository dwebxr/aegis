/**
 * @jest-environment jsdom
 *
 * Tests for useInfiniteScroll hook — IntersectionObserver-based infinite scroll.
 */

import { renderHook } from "@testing-library/react";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";

let observeCallbacks: IntersectionObserverCallback[] = [];
let lastObserverOptions: IntersectionObserverInit | undefined;
let observedElements: Element[] = [];
let unobservedElements: Element[] = [];
let disconnectCount = 0;

beforeEach(() => {
  observeCallbacks = [];
  observedElements = [];
  unobservedElements = [];
  disconnectCount = 0;

  global.IntersectionObserver = jest.fn().mockImplementation((cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) => {
    observeCallbacks.push(cb);
    lastObserverOptions = opts;
    return {
      observe: jest.fn((el: Element) => { observedElements.push(el); }),
      unobserve: jest.fn((el: Element) => { unobservedElements.push(el); }),
      disconnect: jest.fn(() => { disconnectCount++; }),
    };
  });
});

function simulateIntersection(isIntersecting: boolean) {
  for (const cb of observeCallbacks) {
    cb(
      [{ isIntersecting } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  }
}

describe("useInfiniteScroll", () => {
  it("returns a callback ref function", () => {
    const onLoadMore = jest.fn();
    const { result } = renderHook(() => useInfiniteScroll(true, onLoadMore));
    expect(typeof result.current).toBe("function");
  });

  it("creates IntersectionObserver with 300px rootMargin", () => {
    const onLoadMore = jest.fn();
    renderHook(() => useInfiniteScroll(true, onLoadMore));
    expect(lastObserverOptions?.rootMargin).toBe("0px 0px 300px 0px");
    expect(lastObserverOptions?.threshold).toBe(0);
  });

  it("calls onLoadMore when sentinel intersects", () => {
    const onLoadMore = jest.fn();
    const { result } = renderHook(() => useInfiniteScroll(true, onLoadMore));

    // Attach sentinel
    const sentinel = document.createElement("div");
    result.current(sentinel);

    simulateIntersection(true);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("does not call onLoadMore when not intersecting", () => {
    const onLoadMore = jest.fn();
    const { result } = renderHook(() => useInfiniteScroll(true, onLoadMore));

    const sentinel = document.createElement("div");
    result.current(sentinel);

    simulateIntersection(false);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("observes sentinel element when attached", () => {
    const onLoadMore = jest.fn();
    const { result } = renderHook(() => useInfiniteScroll(true, onLoadMore));

    const sentinel = document.createElement("div");
    result.current(sentinel);

    expect(observedElements).toContain(sentinel);
  });

  it("unobserves previous sentinel when ref changes", () => {
    const onLoadMore = jest.fn();
    const { result } = renderHook(() => useInfiniteScroll(true, onLoadMore));

    const sentinel1 = document.createElement("div");
    result.current(sentinel1);

    const sentinel2 = document.createElement("div");
    result.current(sentinel2);

    expect(unobservedElements).toContain(sentinel1);
    expect(observedElements).toContain(sentinel2);
  });

  it("disconnects observer on unmount", () => {
    const onLoadMore = jest.fn();
    const { unmount } = renderHook(() => useInfiniteScroll(true, onLoadMore));
    unmount();
    expect(disconnectCount).toBeGreaterThan(0);
  });

  it("uses latest onLoadMore without re-creating observer", () => {
    let callCount = 0;
    const onLoadMore1 = jest.fn(() => { callCount = 1; });
    const onLoadMore2 = jest.fn(() => { callCount = 2; });

    const { result, rerender } = renderHook(
      ({ hasMore, onLoadMore }) => useInfiniteScroll(hasMore, onLoadMore),
      { initialProps: { hasMore: true, onLoadMore: onLoadMore1 } },
    );

    const sentinel = document.createElement("div");
    result.current(sentinel);

    // Update to new callback
    rerender({ hasMore: true, onLoadMore: onLoadMore2 });

    simulateIntersection(true);
    // Should call the latest callback
    expect(callCount).toBe(2);
  });
});
