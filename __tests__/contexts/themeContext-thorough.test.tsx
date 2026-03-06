/**
 * @jest-environment jsdom
 */
/**
 * Thorough tests for ThemeContext — covers provider lifecycle,
 * DOM attribute setting, localStorage persistence, and edge cases.
 */
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { ThemeProvider, useTheme } from "@/contexts/ThemeContext";
import type { ThemeMode } from "@/contexts/ThemeContext";

// --- localStorage mock ---
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: jest.fn((key: string) => store[key] ?? null),
  setItem: jest.fn((key: string, value: string) => { store[key] = value; }),
  removeItem: jest.fn((key: string) => { delete store[key]; }),
  clear: jest.fn(() => { Object.keys(store).forEach(k => delete store[k]); }),
};
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true, configurable: true });

// --- DOM mock ---
const setAttributeSpy = jest.fn();
Object.defineProperty(document, "documentElement", {
  value: { setAttribute: setAttributeSpy },
  writable: true,
  configurable: true,
});

function wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  setAttributeSpy.mockClear();
});

describe("ThemeProvider", () => {
  describe("initial theme loading", () => {
    it("defaults to 'dark' when localStorage is empty", () => {
      const { result } = renderHook(() => useTheme(), { wrapper });
      expect(result.current.theme).toBe("dark");
    });

    it("loads 'light' from localStorage when persisted", () => {
      store["aegis-theme"] = "light";
      const { result } = renderHook(() => useTheme(), { wrapper });
      expect(result.current.theme).toBe("light");
    });

    it("loads 'dark' from localStorage when persisted", () => {
      store["aegis-theme"] = "dark";
      const { result } = renderHook(() => useTheme(), { wrapper });
      expect(result.current.theme).toBe("dark");
    });

    it("defaults to 'dark' for invalid localStorage value", () => {
      store["aegis-theme"] = "invalid-theme";
      const { result } = renderHook(() => useTheme(), { wrapper });
      expect(result.current.theme).toBe("dark");
    });

    it("sets data-theme attribute on document.documentElement during init", () => {
      renderHook(() => useTheme(), { wrapper });
      expect(setAttributeSpy).toHaveBeenCalledWith("data-theme", "dark");
    });

    it("sets data-theme to 'light' during init when persisted as light", () => {
      store["aegis-theme"] = "light";
      renderHook(() => useTheme(), { wrapper });
      expect(setAttributeSpy).toHaveBeenCalledWith("data-theme", "light");
    });
  });

  describe("setTheme", () => {
    it("switches theme from dark to light", () => {
      const { result } = renderHook(() => useTheme(), { wrapper });
      act(() => result.current.setTheme("light"));
      expect(result.current.theme).toBe("light");
    });

    it("switches theme from light to dark", () => {
      store["aegis-theme"] = "light";
      const { result } = renderHook(() => useTheme(), { wrapper });
      expect(result.current.theme).toBe("light");
      act(() => result.current.setTheme("dark"));
      expect(result.current.theme).toBe("dark");
    });

    it("sets data-theme attribute on DOM when switching", () => {
      const { result } = renderHook(() => useTheme(), { wrapper });
      setAttributeSpy.mockClear();
      act(() => result.current.setTheme("light"));
      expect(setAttributeSpy).toHaveBeenCalledWith("data-theme", "light");
    });

    it("persists to localStorage when switching", () => {
      const { result } = renderHook(() => useTheme(), { wrapper });
      act(() => result.current.setTheme("light"));
      expect(store["aegis-theme"]).toBe("light");
    });

    it("setting same theme is idempotent", () => {
      const { result } = renderHook(() => useTheme(), { wrapper });
      act(() => result.current.setTheme("dark"));
      expect(result.current.theme).toBe("dark");
    });
  });

  describe("edge cases", () => {
    it("handles localStorage.getItem throwing (Safari private mode)", () => {
      localStorageMock.getItem.mockImplementationOnce(() => { throw new Error("SecurityError"); });
      const { result } = renderHook(() => useTheme(), { wrapper });
      expect(result.current.theme).toBe("dark");
    });

    it("multiple rapid theme changes settle on last value", () => {
      const { result } = renderHook(() => useTheme(), { wrapper });
      act(() => {
        result.current.setTheme("light");
        result.current.setTheme("dark");
        result.current.setTheme("light");
      });
      expect(result.current.theme).toBe("light");
      expect(store["aegis-theme"]).toBe("light");
    });
  });

  describe("useTheme outside provider", () => {
    it("returns defaults when used outside ThemeProvider", () => {
      const { result } = renderHook(() => useTheme());
      expect(result.current.theme).toBe("dark");
      // setTheme is a no-op
      expect(() => result.current.setTheme("light")).not.toThrow();
    });
  });
});
