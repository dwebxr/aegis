/**
 * @jest-environment jsdom
 */
/**
 * Node 21 added a global `navigator`, so `typeof navigator !== "undefined"` is
 * true on the server too — and that navigator has no `onLine`. Reading it there
 * produced `undefined`, so every server render reported OFFLINE: the HTML
 * shipped a red "Offline" banner, the client disagreed, and React threw away
 * the server tree with a hydration error on every page load.
 *
 * These pin the property check that fixes it. The first case reproduces the
 * server's navigator exactly: present, but without onLine.
 */
import { renderHook, act } from "@testing-library/react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

const originalDescriptor = Object.getOwnPropertyDescriptor(window.navigator, "onLine");

function setOnLine(value: boolean | undefined): void {
  if (value === undefined) {
    // A navigator that has no onLine at all — what Node exposes.
    Reflect.deleteProperty(window.navigator, "onLine");
    return;
  }
  Object.defineProperty(window.navigator, "onLine", { value, configurable: true });
}

afterEach(() => {
  if (originalDescriptor) Object.defineProperty(window.navigator, "onLine", originalDescriptor);
});

describe("useOnlineStatus", () => {
  it("assumes online when navigator has no onLine (the server's navigator)", () => {
    setOnLine(undefined);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);
  });

  it("reports the browser's value when onLine is present", () => {
    setOnLine(false);
    expect(renderHook(() => useOnlineStatus()).result.current).toBe(false);

    setOnLine(true);
    expect(renderHook(() => useOnlineStatus()).result.current).toBe(true);
  });

  it("follows offline and online events", () => {
    setOnLine(true);
    const { result } = renderHook(() => useOnlineStatus());

    act(() => { window.dispatchEvent(new Event("offline")); });
    expect(result.current).toBe(false);

    act(() => { window.dispatchEvent(new Event("online")); });
    expect(result.current).toBe(true);
  });

  it("fires the reconnect callback only after having been offline", () => {
    setOnLine(true);
    const onReconnect = jest.fn();
    renderHook(() => useOnlineStatus(onReconnect));

    // Online -> online: nothing to drain.
    act(() => { window.dispatchEvent(new Event("online")); });
    expect(onReconnect).not.toHaveBeenCalled();

    act(() => { window.dispatchEvent(new Event("offline")); });
    act(() => { window.dispatchEvent(new Event("online")); });
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("drains for a PWA that was opened while already offline", () => {
    setOnLine(false);
    const onReconnect = jest.fn();
    renderHook(() => useOnlineStatus(onReconnect));

    act(() => { window.dispatchEvent(new Event("online")); });
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });
});
