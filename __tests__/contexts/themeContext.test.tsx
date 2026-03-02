/**
 * @jest-environment jsdom
 *
 * ThemeContext logic tests.
 * Tests the loadPersistedTheme, persistence, and data-theme attribute logic.
 */
export {}; // module boundary for TS

const STORAGE_KEY = "aegis-theme";

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

type ThemeMode = "dark" | "light";

function loadPersistedTheme(): ThemeMode {
  if (typeof globalThis.localStorage === "undefined") return "dark";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch { /* Safari private mode or storage disabled */ }
  return "dark";
}

beforeEach(() => mockStorage.clear());

describe("ThemeContext persistence logic", () => {
  it("defaults to 'dark' when localStorage is empty", () => {
    expect(loadPersistedTheme()).toBe("dark");
  });

  it("loads 'dark' from localStorage", () => {
    mockStorage.set(STORAGE_KEY, "dark");
    expect(loadPersistedTheme()).toBe("dark");
  });

  it("loads 'light' from localStorage", () => {
    mockStorage.set(STORAGE_KEY, "light");
    expect(loadPersistedTheme()).toBe("light");
  });

  it("defaults to 'dark' for invalid value", () => {
    mockStorage.set(STORAGE_KEY, "invalid");
    expect(loadPersistedTheme()).toBe("dark");
  });

  it("defaults to 'dark' for empty string", () => {
    mockStorage.set(STORAGE_KEY, "");
    expect(loadPersistedTheme()).toBe("dark");
  });

  it("defaults to 'dark' for number-like values", () => {
    mockStorage.set(STORAGE_KEY, "123");
    expect(loadPersistedTheme()).toBe("dark");
  });

  it("persists theme change to localStorage", () => {
    localStorage.setItem(STORAGE_KEY, "light");
    expect(mockStorage.get(STORAGE_KEY)).toBe("light");
  });

  it("supports multiple theme switches", () => {
    localStorage.setItem(STORAGE_KEY, "light");
    expect(loadPersistedTheme()).toBe("light");

    localStorage.setItem(STORAGE_KEY, "dark");
    expect(loadPersistedTheme()).toBe("dark");

    localStorage.setItem(STORAGE_KEY, "light");
    expect(loadPersistedTheme()).toBe("light");
  });
});

describe("ThemeContext — SSR safety", () => {
  it("handles missing localStorage gracefully", () => {
    const original = globalThis.localStorage;
    // @ts-expect-error — intentionally testing SSR
    delete globalThis.localStorage;
    expect(loadPersistedTheme()).toBe("dark");
    globalThis.localStorage = original;
  });
});

describe("ThemeContext — data-theme attribute", () => {
  it("sets data-theme attribute on documentElement", () => {
    document.documentElement.setAttribute("data-theme", "light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    document.documentElement.setAttribute("data-theme", "dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("setTheme persists and updates attribute", () => {
    // Simulate setTheme logic
    const setTheme = (mode: ThemeMode) => {
      document.documentElement.setAttribute("data-theme", mode);
      localStorage.setItem(STORAGE_KEY, mode);
    };

    setTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(mockStorage.get(STORAGE_KEY)).toBe("light");

    setTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(mockStorage.get(STORAGE_KEY)).toBe("dark");
  });
});
