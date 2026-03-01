/**
 * @jest-environment jsdom
 */
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

import React, { useRef } from "react";

// ── Helpers ─────────────────────────────────────────────────
function createTouchEvent(type: string, clientX: number, clientY: number): TouchEvent {
  return new TouchEvent(type, {
    bubbles: true,
    cancelable: type === "touchmove",
    touches: type === "touchend" || type === "touchcancel" ? [] : [
      { clientX, clientY, identifier: 0, target: document.body } as unknown as Touch,
    ],
  });
}

import { PullToRefresh } from "@/components/ui/PullToRefresh";
import { renderToStaticMarkup } from "react-dom/server";

describe("PullToRefresh — SSR rendering", () => {
  it("renders children when enabled=false", () => {
    const Wrapper = () => {
      const ref = useRef<HTMLElement>(null);
      return <PullToRefresh scrollRef={ref} enabled={false}><div>content</div></PullToRefresh>;
    };
    const html = renderToStaticMarkup(<Wrapper />);
    expect(html).toContain("content");
  });

  it("does NOT render the pull indicator when disabled", () => {
    const Wrapper = () => {
      const ref = useRef<HTMLElement>(null);
      return <PullToRefresh scrollRef={ref} enabled={false}><div>content</div></PullToRefresh>;
    };
    const html = renderToStaticMarkup(<Wrapper />);
    expect(html).not.toContain("Pull to refresh");
  });

  it("renders the pull indicator when enabled", () => {
    const Wrapper = () => {
      const ref = useRef<HTMLElement>(null);
      return <PullToRefresh scrollRef={ref} enabled={true}><div>content</div></PullToRefresh>;
    };
    const html = renderToStaticMarkup(<Wrapper />);
    expect(html).toContain("Pull to refresh");
    expect(html).toContain("content");
  });

  it("shows SVG chevron icon in initial state (not spinner)", () => {
    const Wrapper = () => {
      const ref = useRef<HTMLElement>(null);
      return <PullToRefresh scrollRef={ref} enabled={true}><span>X</span></PullToRefresh>;
    };
    const html = renderToStaticMarkup(<Wrapper />);
    expect(html).toContain("<svg");
    expect(html).toContain("polyline");
    expect(html).not.toContain("Refreshing...");
  });
});

import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";

function mountPullToRefresh(enabled = true) {
  const container = document.createElement("div");
  document.body.appendChild(container);

  const scrollEl = document.createElement("main");
  scrollEl.style.overflow = "auto";
  scrollEl.style.height = "300px";
  Object.defineProperty(scrollEl, "scrollTop", { value: 0, writable: true, configurable: true });
  container.appendChild(scrollEl);

  const refStore: { current: HTMLElement | null } = { current: scrollEl };

  const Inner: React.FC = () => {
    return (
      <PullToRefresh scrollRef={refStore as React.RefObject<HTMLElement>} enabled={enabled}>
        <div data-testid="child">Content</div>
      </PullToRefresh>
    );
  };

  let root: ReturnType<typeof createRoot>;
  act(() => {
    root = createRoot(scrollEl);
    root.render(<Inner />);
  });

  const getIndicator = () => scrollEl.children[0] as HTMLDivElement | null;
  const getPhaseText = () => {
    const spans = scrollEl.querySelectorAll("span");
    for (const s of spans) {
      if (s.textContent?.includes("refresh") || s.textContent?.includes("Pull") || s.textContent?.includes("Release") || s.textContent?.includes("Refreshing")) {
        return s.textContent;
      }
    }
    return null;
  };

  return {
    scrollEl,
    container,
    getIndicator,
    getPhaseText,
    cleanup: () => {
      act(() => root!.unmount());
      container.remove();
    },
  };
}

function fireTouchSequence(
  el: HTMLElement,
  startX: number,
  startY: number,
  moves: Array<[number, number]>,
  end = true,
) {
  act(() => {
    el.dispatchEvent(createTouchEvent("touchstart", startX, startY));
  });
  for (const [mx, my] of moves) {
    act(() => {
      el.dispatchEvent(createTouchEvent("touchmove", mx, my));
    });
  }
  if (end) {
    act(() => {
      el.dispatchEvent(createTouchEvent("touchend", 0, 0));
    });
  }
}

describe("PullToRefresh — touch gesture state machine", () => {
  let mount: ReturnType<typeof mountPullToRefresh>;

  afterEach(() => {
    mount?.cleanup();
    jest.restoreAllMocks();
  });

  it("does not activate on horizontal swipe (direction lock)", () => {
    mount = mountPullToRefresh();
    fireTouchSequence(mount.scrollEl, 100, 200, [
      [115, 202], // dx=15 > LOCK_DIST(10) → horizontal lock
      [130, 204],
    ]);
    expect(mount.getPhaseText()).toBe("Pull to refresh");
  });

  it("does not activate when scrollTop > 0", () => {
    mount = mountPullToRefresh();
    Object.defineProperty(mount.scrollEl, "scrollTop", { value: 100, writable: true });
    fireTouchSequence(mount.scrollEl, 100, 200, [
      [100, 215],
      [100, 250],
    ]);
    expect(mount.getPhaseText()).toBe("Pull to refresh");
  });

  it("does not activate on pull-up (dy <= 0)", () => {
    mount = mountPullToRefresh();
    fireTouchSequence(mount.scrollEl, 100, 200, [
      [100, 185],
      [100, 170],
    ]);
    expect(mount.getPhaseText()).toBe("Pull to refresh");
  });

  it("transitions to 'pulling' on small downward pull", () => {
    mount = mountPullToRefresh();
    fireTouchSequence(mount.scrollEl, 100, 100, [
      [100, 115], // vertical lock
      [100, 140], // pullY = 40*0.45 = 18 < THRESHOLD(72)
    ], false);
    expect(mount.getPhaseText()).toBe("Pull to refresh");
  });

  it("transitions to 'ready' when pulled past threshold", () => {
    mount = mountPullToRefresh();
    fireTouchSequence(mount.scrollEl, 100, 100, [
      [100, 115], // vertical lock
      [100, 270], // pullY = 170*0.45 = 76.5 > THRESHOLD(72)
    ], false);
    expect(mount.getPhaseText()).toBe("Release to refresh");
  });

  it("caps pullY at MAX_PULL (128px)", () => {
    mount = mountPullToRefresh();
    fireTouchSequence(mount.scrollEl, 100, 100, [
      [100, 115],
      [100, 600], // pullY = 500*0.45 = 225, capped at 128
    ], false);
    expect(mount.getPhaseText()).toBe("Release to refresh");
    const indicator = mount.getIndicator();
    expect(indicator).not.toBeNull();
    expect(indicator!.style.height).toBe("128px");
  });

  it("returns to idle when released below threshold", () => {
    mount = mountPullToRefresh();
    fireTouchSequence(mount.scrollEl, 100, 100, [
      [100, 115],
      [100, 140],
    ]);
    expect(mount.getPhaseText()).toBe("Pull to refresh");
  });

  it("triggers refresh and calls window.location.reload after RELOAD_DELAY", () => {
    jest.useFakeTimers();
    mount = mountPullToRefresh();
    const reloadMock = jest.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload: reloadMock },
      writable: true,
      configurable: true,
    });

    fireTouchSequence(mount.scrollEl, 100, 100, [
      [100, 115],
      [100, 270],
    ]);

    expect(mount.getPhaseText()).toBe("Refreshing...");
    expect(reloadMock).not.toHaveBeenCalled();

    act(() => { jest.advanceTimersByTime(400); });
    expect(reloadMock).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });

  it("ignores touch events during refreshing phase", () => {
    jest.useFakeTimers();
    mount = mountPullToRefresh();
    const reloadMock = jest.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload: reloadMock },
      writable: true,
      configurable: true,
    });

    fireTouchSequence(mount.scrollEl, 100, 100, [
      [100, 115],
      [100, 270],
    ]);
    expect(mount.getPhaseText()).toBe("Refreshing...");

    // Pull again while refreshing — should be ignored
    fireTouchSequence(mount.scrollEl, 100, 100, [
      [100, 115],
      [100, 270],
    ]);
    expect(mount.getPhaseText()).toBe("Refreshing...");
    act(() => { jest.advanceTimersByTime(400); });
    expect(reloadMock).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it("handles touchcancel as touchend (returns to idle)", () => {
    mount = mountPullToRefresh();
    act(() => {
      mount.scrollEl.dispatchEvent(createTouchEvent("touchstart", 100, 100));
    });
    act(() => {
      mount.scrollEl.dispatchEvent(createTouchEvent("touchmove", 100, 115));
    });
    act(() => {
      mount.scrollEl.dispatchEvent(createTouchEvent("touchmove", 100, 140));
    });
    act(() => {
      mount.scrollEl.dispatchEvent(createTouchEvent("touchcancel", 0, 0));
    });
    expect(mount.getPhaseText()).toBe("Pull to refresh");
  });

  it("cleans up event listeners on unmount", () => {
    mount = mountPullToRefresh();
    const removeSpy = jest.spyOn(mount.scrollEl, "removeEventListener");
    mount.cleanup();
    const removedTypes = removeSpy.mock.calls.map(c => c[0]);
    expect(removedTypes).toContain("touchstart");
    expect(removedTypes).toContain("touchmove");
    expect(removedTypes).toContain("touchend");
    expect(removedTypes).toContain("touchcancel");
    mount = null as unknown as ReturnType<typeof mountPullToRefresh>;
  });

  it("does not render indicator or attach listeners when enabled=false", () => {
    mount = mountPullToRefresh(false);
    expect(mount.getPhaseText()).toBeNull();
    const spans = mount.scrollEl.querySelectorAll("span");
    const refreshSpan = Array.from(spans).find(s => s.textContent?.includes("refresh"));
    expect(refreshSpan).toBeUndefined();
  });
});

describe("PullToRefresh — direction lock boundary", () => {
  let mount: ReturnType<typeof mountPullToRefresh>;

  afterEach(() => {
    mount?.cleanup();
  });

  it("does not lock until movement exceeds LOCK_DIST (10px)", () => {
    mount = mountPullToRefresh();
    fireTouchSequence(mount.scrollEl, 100, 100, [
      [100, 108], // dy=8 < LOCK_DIST(10)
    ], false);
    expect(mount.getPhaseText()).toBe("Pull to refresh");
  });

  it("locks vertical at exactly LOCK_DIST + 1", () => {
    mount = mountPullToRefresh();
    fireTouchSequence(mount.scrollEl, 100, 100, [
      [100, 111], // dy=11 > LOCK_DIST → vertical lock
      [100, 200],
    ], false);
    expect(mount.getPhaseText()).toBe("Pull to refresh");
  });

  it("diagonal movement locks to dominant axis", () => {
    mount = mountPullToRefresh();
    fireTouchSequence(mount.scrollEl, 100, 100, [
      [115, 108], // dx=15 > dy=8 → horizontal lock
      [130, 200],
    ], false);
    expect(mount.getPhaseText()).toBe("Pull to refresh");
  });
});

describe("PullToRefresh — damping calculation", () => {
  let mount: ReturnType<typeof mountPullToRefresh>;

  afterEach(() => {
    mount?.cleanup();
  });

  it("damping: 160px dy → 72px pullY (exactly at threshold)", () => {
    mount = mountPullToRefresh();
    fireTouchSequence(mount.scrollEl, 100, 100, [
      [100, 115],
      [100, 260], // dy=160 → pullY = 160*0.45 = 72 = THRESHOLD
    ], false);
    expect(mount.getPhaseText()).toBe("Release to refresh");
  });

  it("damping: 159px dy → 71.55px pullY (just below threshold)", () => {
    mount = mountPullToRefresh();
    fireTouchSequence(mount.scrollEl, 100, 100, [
      [100, 115],
      [100, 259], // dy=159 → pullY = 159*0.45 = 71.55 < 72
    ], false);
    expect(mount.getPhaseText()).toBe("Pull to refresh");
  });
});
