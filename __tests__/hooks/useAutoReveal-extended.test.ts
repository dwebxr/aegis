/**
 * @jest-environment jsdom
 */

interface ObserverCtor {
  callback: (entries: { isIntersecting: boolean; target: HTMLElement }[]) => void;
  observed: Set<HTMLElement>;
  unobserved: HTMLElement[];
  disconnected: boolean;
}

const observers: ObserverCtor[] = [];

class MockIntersectionObserver {
  callback: ObserverCtor["callback"];
  observed = new Set<HTMLElement>();
  unobserved: HTMLElement[] = [];
  disconnected = false;

  constructor(cb: ObserverCtor["callback"]) {
    this.callback = cb;
    observers.push(this as unknown as ObserverCtor);
  }
  observe(el: HTMLElement) { this.observed.add(el); }
  unobserve(el: HTMLElement) { this.unobserved.push(el); this.observed.delete(el); }
  disconnect() { this.disconnected = true; }
  takeRecords() { return []; }
  root = null;
  rootMargin = "";
  thresholds = [] as readonly number[];
}

(global as unknown as { IntersectionObserver: typeof MockIntersectionObserver }).IntersectionObserver = MockIntersectionObserver;

import { renderHook, act } from "@testing-library/react";
import { useAutoReveal } from "@/hooks/useAutoReveal";

beforeEach(() => {
  observers.length = 0;
  localStorage.clear();
});

describe("useAutoReveal — extended observer behavior", () => {
  it("intersection callback expands non-collapsed sections", () => {
    const { result } = renderHook(() => useAutoReveal());
    expect(observers.length).toBeGreaterThan(0);
    const obs = observers[observers.length - 1];

    const el = document.createElement("div");
    el.dataset.autoRevealId = "section-x";

    act(() => {
      obs.callback([{ isIntersecting: true, target: el }]);
    });
    expect(result.current.isExpanded("section-x")).toBe(true);
  });

  it("does not expand sections when isIntersecting=false", () => {
    const { result } = renderHook(() => useAutoReveal());
    const obs = observers[observers.length - 1];
    const el = document.createElement("div");
    el.dataset.autoRevealId = "off-screen";
    act(() => {
      obs.callback([{ isIntersecting: false, target: el }]);
    });
    expect(result.current.isExpanded("off-screen")).toBe(false);
  });

  it("ignores entries without an auto-reveal id", () => {
    const { result } = renderHook(() => useAutoReveal());
    const obs = observers[observers.length - 1];
    const el = document.createElement("div");
    act(() => {
      obs.callback([{ isIntersecting: true, target: el }]);
    });
    expect(result.current.isExpanded("anything")).toBe(false);
  });

  it("does not auto-expand a manually-collapsed section", () => {
    localStorage.setItem("aegis-collapsed-sections", JSON.stringify(["sticky"]));
    const { result } = renderHook(() => useAutoReveal());
    const obs = observers[observers.length - 1];
    const el = document.createElement("div");
    el.dataset.autoRevealId = "sticky";
    act(() => {
      obs.callback([{ isIntersecting: true, target: el }]);
    });
    expect(result.current.isExpanded("sticky")).toBe(false);
  });

  it("only auto-reveals once: re-intersecting after collapse stays collapsed", () => {
    const { result } = renderHook(() => useAutoReveal());
    const obs = observers[observers.length - 1];
    const el = document.createElement("div");
    el.dataset.autoRevealId = "once";

    act(() => {
      obs.callback([{ isIntersecting: true, target: el }]);
    });
    expect(result.current.isExpanded("once")).toBe(true);

    act(() => result.current.toggle("once"));
    expect(result.current.isExpanded("once")).toBe(false);

    act(() => {
      obs.callback([{ isIntersecting: true, target: el }]);
    });
    expect(result.current.isExpanded("once")).toBe(false);
  });

  it("observeRef registers a new element on the observer", () => {
    const { result } = renderHook(() => useAutoReveal());
    const obs = observers[observers.length - 1];
    const el = document.createElement("div");
    act(() => {
      result.current.observeRef("alpha")(el);
    });
    expect(obs.observed.has(el)).toBe(true);
    expect(el.dataset.autoRevealId).toBe("alpha");
  });

  it("observeRef(null) calls unobserve on the previous element", () => {
    const { result } = renderHook(() => useAutoReveal());
    const obs = observers[observers.length - 1];
    const el = document.createElement("div");
    const ref = result.current.observeRef("beta");
    act(() => {
      ref(el);
    });
    expect(obs.observed.has(el)).toBe(true);
    expect(obs.unobserved).not.toContain(el);

    act(() => {
      ref(null);
    });
    expect(obs.unobserved).toContain(el);
    expect(obs.observed.has(el)).toBe(false);
  });

  it("observeRef replaces existing observation when called twice with the same id", () => {
    const { result } = renderHook(() => useAutoReveal());
    const obs = observers[observers.length - 1];
    const first = document.createElement("div");
    const second = document.createElement("div");
    const ref = result.current.observeRef("dup");
    act(() => {
      ref(first);
    });
    act(() => {
      ref(second);
    });
    expect(obs.unobserved).toContain(first);
    expect(obs.observed.has(second)).toBe(true);
  });

  it("disconnects observer on unmount", () => {
    const { unmount } = renderHook(() => useAutoReveal());
    const obs = observers[observers.length - 1];
    expect(obs.disconnected).toBe(false);
    unmount();
    expect(obs.disconnected).toBe(true);
  });

  it("recovers from corrupted localStorage", () => {
    localStorage.setItem("aegis-collapsed-sections", "{not-json");
    expect(() => renderHook(() => useAutoReveal())).not.toThrow();
  });
});
