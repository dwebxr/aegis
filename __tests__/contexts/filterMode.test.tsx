/**
 * FilterModeContext logic tests.
 * Tests the loadPersistedMode and persistence logic directly.
 */

const STORAGE_KEY = "aegis-filter-mode";

// Mock localStorage
const mockStorage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => mockStorage.get(key) ?? null,
    setItem: (key: string, val: string) => mockStorage.set(key, val),
    removeItem: (key: string) => mockStorage.delete(key),
    clear: () => mockStorage.clear(),
  },
  writable: true,
});

function loadPersistedMode(): "lite" | "pro" {
  if (typeof globalThis.localStorage === "undefined") return "lite";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "pro" || stored === "lite") return stored;
  return "lite";
}

beforeEach(() => mockStorage.clear());

describe("FilterMode persistence logic", () => {
  it("defaults to 'lite' when localStorage is empty", () => {
    expect(loadPersistedMode()).toBe("lite");
  });

  it("loads 'pro' from localStorage", () => {
    mockStorage.set(STORAGE_KEY, "pro");
    expect(loadPersistedMode()).toBe("pro");
  });

  it("loads 'lite' from localStorage", () => {
    mockStorage.set(STORAGE_KEY, "lite");
    expect(loadPersistedMode()).toBe("lite");
  });

  it("defaults to 'lite' for invalid value", () => {
    mockStorage.set(STORAGE_KEY, "invalid");
    expect(loadPersistedMode()).toBe("lite");
  });

  it("defaults to 'lite' for empty string", () => {
    mockStorage.set(STORAGE_KEY, "");
    expect(loadPersistedMode()).toBe("lite");
  });

  it("defaults to 'lite' for number-like values", () => {
    mockStorage.set(STORAGE_KEY, "123");
    expect(loadPersistedMode()).toBe("lite");
  });

  it("persists mode change to localStorage", () => {
    const mode = "pro";
    localStorage.setItem(STORAGE_KEY, mode);
    expect(mockStorage.get(STORAGE_KEY)).toBe("pro");
  });

  it("supports multiple mode switches", () => {
    localStorage.setItem(STORAGE_KEY, "pro");
    expect(loadPersistedMode()).toBe("pro");

    localStorage.setItem(STORAGE_KEY, "lite");
    expect(loadPersistedMode()).toBe("lite");

    localStorage.setItem(STORAGE_KEY, "pro");
    expect(loadPersistedMode()).toBe("pro");
  });
});

describe("FilterMode — SSR safety", () => {
  it("handles missing localStorage gracefully", () => {
    const original = globalThis.localStorage;
    // @ts-expect-error — intentionally testing SSR
    delete globalThis.localStorage;
    // Should not throw
    const mode = (() => {
      if (typeof globalThis.localStorage === "undefined") return "lite";
      return localStorage.getItem(STORAGE_KEY) ?? "lite";
    })();
    expect(mode).toBe("lite");
    globalThis.localStorage = original;
  });
});
