/**
 * @jest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";

// Helper to create a mock BeforeInstallPromptEvent
function createMockPromptEvent(outcome: "accepted" | "dismissed" = "accepted") {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  (event as unknown as Record<string, unknown>).prompt = jest.fn().mockResolvedValue(undefined);
  (event as unknown as Record<string, unknown>).userChoice = Promise.resolve({ outcome });
  return event;
}

describe("useInstallPrompt", () => {
  let matchMediaMock: jest.Mock;

  beforeEach(() => {
    matchMediaMock = jest.fn().mockReturnValue({ matches: false });
    Object.defineProperty(window, "matchMedia", { value: matchMediaMock, writable: true });
  });

  it("starts with canInstall=false, installed=false", () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.canInstall).toBe(false);
    expect(result.current.installed).toBe(false);
  });

  it("detects standalone mode as installed", () => {
    matchMediaMock.mockReturnValue({ matches: true });
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.installed).toBe(true);
    expect(result.current.canInstall).toBe(false);
  });

  it("sets canInstall=true when beforeinstallprompt fires", () => {
    const { result } = renderHook(() => useInstallPrompt());
    act(() => {
      window.dispatchEvent(createMockPromptEvent());
    });
    expect(result.current.canInstall).toBe(true);
  });

  it("promptInstall resolves true on accepted", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    act(() => {
      window.dispatchEvent(createMockPromptEvent("accepted"));
    });
    let accepted: boolean | undefined;
    await act(async () => {
      accepted = await result.current.promptInstall();
    });
    expect(accepted).toBe(true);
    expect(result.current.installed).toBe(true);
    expect(result.current.canInstall).toBe(false);
  });

  it("promptInstall resolves false on dismissed", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    act(() => {
      window.dispatchEvent(createMockPromptEvent("dismissed"));
    });
    let accepted: boolean | undefined;
    await act(async () => {
      accepted = await result.current.promptInstall();
    });
    expect(accepted).toBe(false);
    expect(result.current.installed).toBe(false);
  });

  it("promptInstall returns false when no deferred prompt", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    let accepted: boolean | undefined;
    await act(async () => {
      accepted = await result.current.promptInstall();
    });
    expect(accepted).toBe(false);
  });

  it("sets installed=true on appinstalled event", () => {
    const { result } = renderHook(() => useInstallPrompt());
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });
    expect(result.current.installed).toBe(true);
    expect(result.current.canInstall).toBe(false);
  });
});
