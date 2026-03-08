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
    const { result } = renderHook(() => useInfiniteScroll(jest.fn()));
    expect(typeof result.current).toBe("function");
  });

  it("creates IntersectionObserver with 300px rootMargin", () => {
    renderHook(() => useInfiniteScroll(jest.fn()));
    expect(lastObserverOptions?.rootMargin).toBe("0px 0px 300px 0px");
    expect(lastObserverOptions?.threshold).toBe(0);
  });

  it("calls onLoadMore when sentinel intersects", () => {
    const onLoadMore = jest.fn();
    const { result } = renderHook(() => useInfiniteScroll(onLoadMore));

    const sentinel = document.createElement("div");
    result.current(sentinel);

    simulateIntersection(true);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("does not call onLoadMore when not intersecting", () => {
    const onLoadMore = jest.fn();
    const { result } = renderHook(() => useInfiniteScroll(onLoadMore));

    const sentinel = document.createElement("div");
    result.current(sentinel);

    simulateIntersection(false);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("observes sentinel element when attached", () => {
    const { result } = renderHook(() => useInfiniteScroll(jest.fn()));

    const sentinel = document.createElement("div");
    result.current(sentinel);

    expect(observedElements).toContain(sentinel);
  });

  it("unobserves previous sentinel when ref changes", () => {
    const { result } = renderHook(() => useInfiniteScroll(jest.fn()));

    const sentinel1 = document.createElement("div");
    result.current(sentinel1);

    const sentinel2 = document.createElement("div");
    result.current(sentinel2);

    expect(unobservedElements).toContain(sentinel1);
    expect(observedElements).toContain(sentinel2);
  });

  it("disconnects observer on unmount", () => {
    const { unmount } = renderHook(() => useInfiniteScroll(jest.fn()));
    unmount();
    expect(disconnectCount).toBeGreaterThan(0);
  });

  it("uses latest onLoadMore without re-creating observer", () => {
    let callCount = 0;
    const onLoadMore1 = jest.fn(() => { callCount = 1; });
    const onLoadMore2 = jest.fn(() => { callCount = 2; });

    const { result, rerender } = renderHook(
      ({ onLoadMore }: { onLoadMore: () => void }) => useInfiniteScroll(onLoadMore),
      { initialProps: { onLoadMore: onLoadMore1 } },
    );

    const sentinel = document.createElement("div");
    result.current(sentinel);

    rerender({ onLoadMore: onLoadMore2 });

    simulateIntersection(true);
    expect(callCount).toBe(2);
  });

  it("handles null ref (sentinel removal)", () => {
    const onLoadMore = jest.fn();
    const { result } = renderHook(() => useInfiniteScroll(onLoadMore));

    const sentinel = document.createElement("div");
    result.current(sentinel);
    expect(observedElements).toContain(sentinel);

    // Remove sentinel (React unmounts the element)
    result.current(null);
    expect(unobservedElements).toContain(sentinel);

    // Intersection after removal should still call onLoadMore
    // (observer was already created — this tests the guard path)
    simulateIntersection(true);
    expect(onLoadMore).toHaveBeenCalled();
  });

  it("handles multiple rapid intersections", () => {
    const onLoadMore = jest.fn();
    const { result } = renderHook(() => useInfiniteScroll(onLoadMore));

    const sentinel = document.createElement("div");
    result.current(sentinel);

    simulateIntersection(true);
    simulateIntersection(true);
    simulateIntersection(true);
    expect(onLoadMore).toHaveBeenCalledTimes(3);
  });

  it("handles empty entries array gracefully", () => {
    const onLoadMore = jest.fn();
    renderHook(() => useInfiniteScroll(onLoadMore));

    // Simulate empty entries (edge case from IntersectionObserver)
    for (const cb of observeCallbacks) {
      cb([], {} as IntersectionObserver);
    }
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it("only creates one IntersectionObserver instance", () => {
    const onLoadMore = jest.fn();
    renderHook(() => useInfiniteScroll(onLoadMore));
    expect(IntersectionObserver).toHaveBeenCalledTimes(1);
  });

  it("ref is stable across rerenders (same function identity)", () => {
    const { result, rerender } = renderHook(
      ({ onLoadMore }: { onLoadMore: () => void }) => useInfiniteScroll(onLoadMore),
      { initialProps: { onLoadMore: jest.fn() } },
    );
    const ref1 = result.current;
    rerender({ onLoadMore: jest.fn() });
    const ref2 = result.current;
    expect(ref1).toBe(ref2);
  });
});
