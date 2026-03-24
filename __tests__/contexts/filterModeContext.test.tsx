/**
 * @jest-environment jsdom
 */
/**
 * FilterModeContext — integration tests.
 * Tests the full provider: initial load from localStorage, setFilterMode persistence,
 * invalid values, SSR safety, and toggle round-trips.
 */
import React from "react";
import { render, screen, act } from "@testing-library/react";
import { FilterModeProvider, useFilterMode } from "@/contexts/FilterModeContext";

const STORAGE_KEY = "aegis-filter-mode";

function Consumer() {
  const { filterMode, setFilterMode } = useFilterMode();
  return (
    <div>
      <span data-testid="mode">{filterMode}</span>
      <button data-testid="pro" onClick={() => setFilterMode("pro")} />
      <button data-testid="lite" onClick={() => setFilterMode("lite")} />
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe("FilterModeContext — initial state", () => {
  it("defaults to 'lite' when localStorage is empty", () => {
    render(<FilterModeProvider><Consumer /></FilterModeProvider>);
    expect(screen.getByTestId("mode").textContent).toBe("lite");
  });

  it("loads 'pro' from localStorage on mount", () => {
    localStorage.setItem(STORAGE_KEY, "pro");
    render(<FilterModeProvider><Consumer /></FilterModeProvider>);
    expect(screen.getByTestId("mode").textContent).toBe("pro");
  });

  it("defaults to 'lite' for invalid stored value", () => {
    localStorage.setItem(STORAGE_KEY, "turbo");
    render(<FilterModeProvider><Consumer /></FilterModeProvider>);
    expect(screen.getByTestId("mode").textContent).toBe("lite");
  });
});

describe("FilterModeContext — setFilterMode", () => {
  it("switches to pro and persists", () => {
    render(<FilterModeProvider><Consumer /></FilterModeProvider>);
    act(() => { screen.getByTestId("pro").click(); });
    expect(screen.getByTestId("mode").textContent).toBe("pro");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("pro");
  });

  it("switches back to lite and persists", () => {
    localStorage.setItem(STORAGE_KEY, "pro");
    render(<FilterModeProvider><Consumer /></FilterModeProvider>);
    act(() => { screen.getByTestId("lite").click(); });
    expect(screen.getByTestId("mode").textContent).toBe("lite");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("lite");
  });

  it("handles rapid toggles correctly", () => {
    render(<FilterModeProvider><Consumer /></FilterModeProvider>);
    act(() => {
      screen.getByTestId("pro").click();
      screen.getByTestId("lite").click();
      screen.getByTestId("pro").click();
    });
    expect(screen.getByTestId("mode").textContent).toBe("pro");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("pro");
  });
});

describe("FilterModeContext — edge cases", () => {
  it("useFilterMode returns defaults outside provider", () => {
    function Orphan() {
      const { filterMode } = useFilterMode();
      return <span data-testid="out">{filterMode}</span>;
    }
    render(<Orphan />);
    expect(screen.getByTestId("out").textContent).toBe("lite");
  });
});
