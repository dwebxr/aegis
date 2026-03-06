/**
 * @jest-environment jsdom
 */

// Mock IntersectionObserver for JSDOM
const mockObserve = jest.fn();
const mockUnobserve = jest.fn();
const mockDisconnect = jest.fn();
global.IntersectionObserver = jest.fn().mockImplementation(() => ({
  observe: mockObserve,
  unobserve: mockUnobserve,
  disconnect: mockDisconnect,
}));

import { renderHook, act } from "@testing-library/react";
import { useAutoReveal } from "@/hooks/useAutoReveal";

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
});

describe("useAutoReveal", () => {
  it("sections start collapsed", () => {
    const { result } = renderHook(() => useAutoReveal());
    expect(result.current.isExpanded("discoveries")).toBe(false);
    expect(result.current.isExpanded("review-queue")).toBe(false);
  });

  it("toggle expands a section", () => {
    const { result } = renderHook(() => useAutoReveal());
    act(() => result.current.toggle("discoveries"));
    expect(result.current.isExpanded("discoveries")).toBe(true);
  });

  it("toggle collapses an expanded section", () => {
    const { result } = renderHook(() => useAutoReveal());
    act(() => result.current.toggle("discoveries"));
    expect(result.current.isExpanded("discoveries")).toBe(true);
    act(() => result.current.toggle("discoveries"));
    expect(result.current.isExpanded("discoveries")).toBe(false);
  });

  it("manual collapse persists to localStorage", () => {
    const { result } = renderHook(() => useAutoReveal());
    // Expand then collapse = manual collapse
    act(() => result.current.toggle("discoveries"));
    act(() => result.current.toggle("discoveries"));

    const stored = JSON.parse(localStorage.getItem("aegis-collapsed-sections")!);
    expect(stored).toContain("discoveries");
  });

  it("re-expanding removes from collapsed in localStorage", () => {
    const { result } = renderHook(() => useAutoReveal());
    act(() => result.current.toggle("discoveries"));
    act(() => result.current.toggle("discoveries")); // collapse
    act(() => result.current.toggle("discoveries")); // re-expand

    const stored = JSON.parse(localStorage.getItem("aegis-collapsed-sections")!);
    expect(stored).not.toContain("discoveries");
  });

  it("observeRef returns a callback ref function", () => {
    const { result } = renderHook(() => useAutoReveal());
    const ref = result.current.observeRef("test-section");
    expect(typeof ref).toBe("function");
  });

  it("independent sections do not affect each other", () => {
    const { result } = renderHook(() => useAutoReveal());
    act(() => result.current.toggle("a"));
    expect(result.current.isExpanded("a")).toBe(true);
    expect(result.current.isExpanded("b")).toBe(false);
  });
});
