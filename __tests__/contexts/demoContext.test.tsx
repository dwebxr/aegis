/**
 * @jest-environment jsdom
 */
/**
 * DemoContext — unit tests.
 * Tests isDemoMode computation, banner dismiss with sessionStorage,
 * banner reset on login, and SSR/sessionStorage-unavailable edge cases.
 */
import React from "react";
import { render, screen, act } from "@testing-library/react";

/* ── Mock AuthContext ── */
let mockAuth = { isAuthenticated: false, isLoading: false };
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

/* import AFTER mocks registered */
import { DemoProvider, useDemo } from "@/contexts/DemoContext";

const DEMO_BANNER_KEY = "aegis_demo_banner_dismissed";

function Consumer() {
  const { isDemoMode, bannerDismissed, dismissBanner } = useDemo();
  return (
    <div>
      <span data-testid="demo">{String(isDemoMode)}</span>
      <span data-testid="dismissed">{String(bannerDismissed)}</span>
      <button data-testid="dismiss" onClick={dismissBanner} />
    </div>
  );
}

beforeEach(() => {
  mockAuth = { isAuthenticated: false, isLoading: false };
  sessionStorage.clear();
});

describe("DemoContext — isDemoMode computation", () => {
  it("isDemoMode is true when not authenticated and not loading", () => {
    render(<DemoProvider><Consumer /></DemoProvider>);
    expect(screen.getByTestId("demo").textContent).toBe("true");
  });

  it("isDemoMode is false when authenticated", () => {
    mockAuth = { isAuthenticated: true, isLoading: false };
    render(<DemoProvider><Consumer /></DemoProvider>);
    expect(screen.getByTestId("demo").textContent).toBe("false");
  });

  it("isDemoMode is false while loading", () => {
    mockAuth = { isAuthenticated: false, isLoading: true };
    render(<DemoProvider><Consumer /></DemoProvider>);
    expect(screen.getByTestId("demo").textContent).toBe("false");
  });

  it("isDemoMode is false when both authenticated and loading", () => {
    mockAuth = { isAuthenticated: true, isLoading: true };
    render(<DemoProvider><Consumer /></DemoProvider>);
    expect(screen.getByTestId("demo").textContent).toBe("false");
  });
});

describe("DemoContext — banner dismiss", () => {
  it("banner starts not dismissed", () => {
    render(<DemoProvider><Consumer /></DemoProvider>);
    expect(screen.getByTestId("dismissed").textContent).toBe("false");
  });

  it("dismissBanner sets bannerDismissed to true and persists to sessionStorage", () => {
    render(<DemoProvider><Consumer /></DemoProvider>);
    act(() => { screen.getByTestId("dismiss").click(); });
    expect(screen.getByTestId("dismissed").textContent).toBe("true");
    expect(sessionStorage.getItem(DEMO_BANNER_KEY)).toBe("true");
  });

  it("reads persisted dismiss state from sessionStorage on mount", () => {
    sessionStorage.setItem(DEMO_BANNER_KEY, "true");
    render(<DemoProvider><Consumer /></DemoProvider>);
    expect(screen.getByTestId("dismissed").textContent).toBe("true");
  });

  it("ignores non-'true' sessionStorage values", () => {
    sessionStorage.setItem(DEMO_BANNER_KEY, "yes");
    render(<DemoProvider><Consumer /></DemoProvider>);
    expect(screen.getByTestId("dismissed").textContent).toBe("false");
  });
});

describe("DemoContext — banner reset on login", () => {
  it("resets bannerDismissed when user authenticates", () => {
    const { rerender } = render(<DemoProvider><Consumer /></DemoProvider>);
    act(() => { screen.getByTestId("dismiss").click(); });
    expect(screen.getByTestId("dismissed").textContent).toBe("true");

    // Simulate login
    mockAuth = { isAuthenticated: true, isLoading: false };
    rerender(<DemoProvider><Consumer /></DemoProvider>);
    expect(screen.getByTestId("dismissed").textContent).toBe("false");
  });
});

describe("DemoContext — edge cases", () => {
  it("useDemo returns defaults outside provider", () => {
    function Orphan() {
      const { isDemoMode, bannerDismissed } = useDemo();
      return <span data-testid="out">{String(isDemoMode)},{String(bannerDismissed)}</span>;
    }
    render(<Orphan />);
    expect(screen.getByTestId("out").textContent).toBe("false,false");
  });

  it("dismissBanner does not throw when sessionStorage is unavailable", () => {
    const original = globalThis.sessionStorage;
    Object.defineProperty(globalThis, "sessionStorage", {
      value: {
        getItem: () => { throw new Error("blocked"); },
        setItem: () => { throw new Error("blocked"); },
        removeItem: () => {},
        clear: () => {},
        length: 0,
        key: () => null,
      },
      writable: true,
      configurable: true,
    });
    render(<DemoProvider><Consumer /></DemoProvider>);
    expect(() => {
      act(() => { screen.getByTestId("dismiss").click(); });
    }).not.toThrow();
    // Restore
    Object.defineProperty(globalThis, "sessionStorage", { value: original, writable: true, configurable: true });
  });
});
