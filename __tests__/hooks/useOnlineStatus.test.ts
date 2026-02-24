/**
 * @jest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

describe("useOnlineStatus", () => {
  const originalOnLine = Object.getOwnPropertyDescriptor(navigator, "onLine");

  afterEach(() => {
    if (originalOnLine) {
      Object.defineProperty(navigator, "onLine", originalOnLine);
    }
  });

  it("returns true when navigator.onLine is true", () => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);
  });

  it("returns false when navigator.onLine is false", () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);
  });

  it("updates to false on offline event", () => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current).toBe(false);
  });

  it("updates to true on online event", () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const { result } = renderHook(() => useOnlineStatus());

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current).toBe(true);
  });

  it("calls onReconnect callback when going online after being offline", () => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    const onReconnect = jest.fn();
    renderHook(() => useOnlineStatus(onReconnect));

    // Go offline first
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    // Then come back online
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onReconnect if was never offline", () => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    const onReconnect = jest.fn();
    renderHook(() => useOnlineStatus(onReconnect));

    // Online event without prior offline
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(onReconnect).not.toHaveBeenCalled();
  });

  it("cleans up event listeners on unmount", () => {
    const addSpy = jest.spyOn(window, "addEventListener");
    const removeSpy = jest.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useOnlineStatus());

    expect(addSpy).toHaveBeenCalledWith("online", expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith("offline", expect.any(Function));

    unmount();

    expect(removeSpy).toHaveBeenCalledWith("online", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("offline", expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
