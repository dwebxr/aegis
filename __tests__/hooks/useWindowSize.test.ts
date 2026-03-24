/**
 * @jest-environment jsdom
 */
/**
 * useWindowSize — unit tests.
 * Tests resize events, mobile/tablet breakpoint detection, and initial value.
 */
import { renderHook, act } from "@testing-library/react";
import { useWindowSize } from "@/hooks/useWindowSize";
import { breakpoints } from "@/styles/theme";

function fireResize(width: number) {
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: width });
  window.dispatchEvent(new Event("resize"));
}

describe("useWindowSize", () => {
  const originalWidth = window.innerWidth;

  afterEach(() => {
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: originalWidth });
  });

  it("returns current window width on mount", () => {
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 1200 });
    const { result } = renderHook(() => useWindowSize());
    expect(result.current.width).toBe(1200);
  });

  it("detects mobile when width < breakpoints.mobile", () => {
    fireResize(breakpoints.mobile - 1);
    const { result } = renderHook(() => useWindowSize());
    // Initial render uses window.innerWidth which we set
    expect(result.current.mobile).toBe(true);
    expect(result.current.tablet).toBe(false);
  });

  it("detects tablet when width >= mobile and < tablet", () => {
    fireResize(breakpoints.mobile);
    const { result } = renderHook(() => useWindowSize());
    expect(result.current.mobile).toBe(false);
    expect(result.current.tablet).toBe(true);
  });

  it("detects desktop when width >= tablet breakpoint", () => {
    fireResize(breakpoints.tablet);
    const { result } = renderHook(() => useWindowSize());
    expect(result.current.mobile).toBe(false);
    expect(result.current.tablet).toBe(false);
  });

  it("updates on resize events", () => {
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 1200 });
    const { result } = renderHook(() => useWindowSize());
    expect(result.current.mobile).toBe(false);

    act(() => { fireResize(400); });
    expect(result.current.width).toBe(400);
    expect(result.current.mobile).toBe(true);
  });

  it("handles multiple rapid resizes", () => {
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 1200 });
    const { result } = renderHook(() => useWindowSize());

    act(() => {
      fireResize(400);
      fireResize(800);
      fireResize(500);
    });
    expect(result.current.width).toBe(500);
    expect(result.current.mobile).toBe(true);
  });

  it("cleans up resize listener on unmount", () => {
    const addSpy = jest.spyOn(window, "addEventListener");
    const removeSpy = jest.spyOn(window, "removeEventListener");

    const { unmount } = renderHook(() => useWindowSize());
    expect(addSpy).toHaveBeenCalledWith("resize", expect.any(Function));

    unmount();
    expect(removeSpy).toHaveBeenCalledWith("resize", expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("boundary: exactly at mobile breakpoint is NOT mobile", () => {
    fireResize(breakpoints.mobile);
    const { result } = renderHook(() => useWindowSize());
    expect(result.current.mobile).toBe(false);
    expect(result.current.tablet).toBe(true);
  });

  it("boundary: one pixel below mobile breakpoint IS mobile", () => {
    fireResize(breakpoints.mobile - 1);
    const { result } = renderHook(() => useWindowSize());
    expect(result.current.mobile).toBe(true);
  });

  it("boundary: exactly at tablet breakpoint is desktop", () => {
    fireResize(breakpoints.tablet);
    const { result } = renderHook(() => useWindowSize());
    expect(result.current.mobile).toBe(false);
    expect(result.current.tablet).toBe(false);
  });

  it("boundary: one pixel below tablet breakpoint is tablet", () => {
    fireResize(breakpoints.tablet - 1);
    const { result } = renderHook(() => useWindowSize());
    expect(result.current.tablet).toBe(true);
  });
});
