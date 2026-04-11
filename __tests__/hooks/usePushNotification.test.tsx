/**
 * @jest-environment jsdom
 */
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}
import "@testing-library/jest-dom";

const ORIG_VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "BHVKbF8X1n7DfFmhi9SHGZP_AdwgmFOgyPp4O7sFKj9OF8VxKBPxDQGyf3vvLk1nQy-cZcCu5LzUQbAr8I3OFAo";

const mockRegisterPushSubscription = jest.fn().mockResolvedValue(undefined);
const mockUnregisterPushSubscription = jest.fn().mockResolvedValue(undefined);
const mockCreateBackendActor = jest.fn().mockResolvedValue({
  registerPushSubscription: mockRegisterPushSubscription,
  unregisterPushSubscription: mockUnregisterPushSubscription,
});

jest.mock("@/lib/ic/actor", () => ({
  __esModule: true,
  createBackendActorAsync: (...args: unknown[]) => mockCreateBackendActor(...args),
}));

jest.mock("@/contexts/AuthContext", () => ({
  __esModule: true,
  useAuth: () => mockAuthState,
}));

let mockAuthState: { isAuthenticated: boolean; identity: object | null } = {
  isAuthenticated: false,
  identity: null,
};

import React from "react";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import { usePushNotification } from "@/hooks/usePushNotification";

interface MockPushSubscription {
  endpoint: string;
  unsubscribe: jest.Mock;
  toJSON: () => { endpoint: string; keys: { p256dh: string; auth: string } };
}

interface MockPushManager {
  getSubscription: jest.Mock;
  subscribe: jest.Mock;
}

interface MockServiceWorkerRegistration {
  pushManager: MockPushManager;
}

let mockSubscription: MockPushSubscription | null;
let mockPermission: NotificationPermission;
let mockGetSubscriptionShouldThrow = false;
let mockSubscribeShouldThrow: Error | null = null;

function makeSubscription(endpoint = "https://push.example.com/abc"): MockPushSubscription {
  return {
    endpoint,
    unsubscribe: jest.fn().mockResolvedValue(true),
    toJSON: () => ({
      endpoint,
      keys: { p256dh: "p256dh-key", auth: "auth-key" },
    }),
  };
}

function installPushAPI() {
  const reg: MockServiceWorkerRegistration = {
    pushManager: {
      getSubscription: jest.fn(() =>
        mockGetSubscriptionShouldThrow
          ? Promise.reject(new Error("get failed"))
          : Promise.resolve(mockSubscription),
      ),
      subscribe: jest.fn(() => {
        if (mockSubscribeShouldThrow) return Promise.reject(mockSubscribeShouldThrow);
        const sub = makeSubscription();
        mockSubscription = sub;
        return Promise.resolve(sub);
      }),
    },
  };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: Promise.resolve(reg) },
  });
  Object.defineProperty(window, "PushManager", {
    configurable: true,
    value: function PushManager() {},
  });

  const FakeNotification = function FakeNotification() {} as unknown as {
    permission: NotificationPermission;
    requestPermission: jest.Mock;
  };
  Object.defineProperty(FakeNotification, "permission", {
    configurable: true,
    get: () => mockPermission,
  });
  FakeNotification.requestPermission = jest.fn(async () => mockPermission);
  Object.defineProperty(window, "Notification", { configurable: true, value: FakeNotification });
}

function uninstallPushAPI() {
  delete (navigator as Navigator & { serviceWorker?: unknown }).serviceWorker;
  delete (window as Window & { PushManager?: unknown }).PushManager;
  delete (window as Window & { Notification?: unknown }).Notification;
}

beforeEach(() => {
  mockSubscription = null;
  mockPermission = "default";
  mockGetSubscriptionShouldThrow = false;
  mockSubscribeShouldThrow = null;
  mockAuthState = { isAuthenticated: false, identity: null };
  mockCreateBackendActor.mockClear();
  mockRegisterPushSubscription.mockClear();
  mockUnregisterPushSubscription.mockClear();
  localStorage.clear();
  installPushAPI();
});

afterEach(() => {
  cleanup();
  uninstallPushAPI();
});

afterAll(() => {
  if (ORIG_VAPID === undefined) delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  else process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = ORIG_VAPID;
});

describe("usePushNotification — environment detection", () => {
  it("reports isSupported=true when service worker, PushManager, Notification, and VAPID are present", async () => {
    const { result } = renderHook(() => usePushNotification());
    await waitFor(() => expect(result.current.isSupported).toBe(true));
  });

  it("reports isSupported=false when serviceWorker is missing", async () => {
    delete (navigator as Navigator & { serviceWorker?: unknown }).serviceWorker;
    const { result } = renderHook(() => usePushNotification());
    expect(result.current.isSupported).toBe(false);
  });

  it("reports isSupported=false when PushManager is missing", async () => {
    delete (window as Window & { PushManager?: unknown }).PushManager;
    const { result } = renderHook(() => usePushNotification());
    expect(result.current.isSupported).toBe(false);
  });

  it("reports permission state from Notification.permission", async () => {
    mockPermission = "granted";
    const { result } = renderHook(() => usePushNotification());
    await waitFor(() => expect(result.current.permission).toBe("granted"));
  });
});

describe("usePushNotification — existing subscription detection", () => {
  it("loads pre-existing subscription on mount", async () => {
    mockSubscription = makeSubscription("https://existing.example.com/x");
    const { result } = renderHook(() => usePushNotification());
    await waitFor(() => expect(result.current.subscription).not.toBeNull());
    expect(result.current.isSubscribed).toBe(true);
    expect(result.current.subscription?.endpoint).toBe("https://existing.example.com/x");
  });

  it("isSubscribed=false when there is no existing subscription", async () => {
    const { result } = renderHook(() => usePushNotification());
    await waitFor(() => expect(result.current.isSupported).toBe(true));
    expect(result.current.isSubscribed).toBe(false);
  });

  it("survives getSubscription failure with isSubscribed=false", async () => {
    mockGetSubscriptionShouldThrow = true;
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() => usePushNotification());
    await waitFor(() => expect(result.current.isSupported).toBe(true));
    expect(result.current.isSubscribed).toBe(false);
    warn.mockRestore();
  });
});

describe("usePushNotification — actor creation on auth", () => {
  it("creates backend actor when authenticated", async () => {
    mockAuthState = { isAuthenticated: true, identity: { fakeIdentity: true } };
    renderHook(() => usePushNotification());
    await waitFor(() => expect(mockCreateBackendActor).toHaveBeenCalledTimes(1));
    expect(mockCreateBackendActor).toHaveBeenCalledWith({ fakeIdentity: true });
  });

  it("does NOT create actor when unauthenticated", async () => {
    renderHook(() => usePushNotification());
    await new Promise(r => setTimeout(r, 10));
    expect(mockCreateBackendActor).not.toHaveBeenCalled();
  });
});

describe("usePushNotification — subscribe", () => {
  it("subscribe() returns null when not authenticated", async () => {
    const { result } = renderHook(() => usePushNotification());
    await waitFor(() => expect(result.current.isSupported).toBe(true));
    let returned: PushSubscription | null = null;
    await act(async () => {
      returned = await result.current.subscribe();
    });
    expect(returned).toBeNull();
  });

  it("subscribe() returns null when permission denied", async () => {
    mockAuthState = { isAuthenticated: true, identity: { id: 1 } };
    mockPermission = "denied";
    const { result } = renderHook(() => usePushNotification());
    await waitFor(() => expect(result.current.isSupported).toBe(true));
    let returned: PushSubscription | null = null;
    await act(async () => {
      returned = await result.current.subscribe();
    });
    expect(returned).toBeNull();
    expect(result.current.permission).toBe("denied");
  });

  it("subscribe() succeeds: registers on canister, sets localStorage flag, persists subscription state", async () => {
    mockAuthState = { isAuthenticated: true, identity: { id: 1 } };
    mockPermission = "granted";
    const { result } = renderHook(() => usePushNotification());
    await waitFor(() => expect(result.current.isSupported).toBe(true));

    let returned: PushSubscription | null = null;
    await act(async () => {
      returned = await result.current.subscribe();
    });

    expect(returned).not.toBeNull();
    expect(mockRegisterPushSubscription).toHaveBeenCalledWith(
      "https://push.example.com/abc",
      "p256dh-key",
      "auth-key",
    );
    expect(localStorage.getItem("aegis-push-enabled")).toBe("1");
    expect(result.current.isSubscribed).toBe(true);
  });

  it("subscribe() returns null and logs error when pushManager.subscribe throws", async () => {
    mockAuthState = { isAuthenticated: true, identity: { id: 1 } };
    mockPermission = "granted";
    mockSubscribeShouldThrow = new Error("denied");
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => usePushNotification());
    await waitFor(() => expect(result.current.isSupported).toBe(true));

    let returned: PushSubscription | null = null;
    await act(async () => {
      returned = await result.current.subscribe();
    });
    expect(returned).toBeNull();
    expect(localStorage.getItem("aegis-push-enabled")).toBeNull();
    errSpy.mockRestore();
  });

  it("isLoading flips to true during subscribe and back to false after", async () => {
    mockAuthState = { isAuthenticated: true, identity: { id: 1 } };
    mockPermission = "granted";
    const { result } = renderHook(() => usePushNotification());
    await waitFor(() => expect(result.current.isSupported).toBe(true));
    expect(result.current.isLoading).toBe(false);
    await act(async () => {
      await result.current.subscribe();
    });
    expect(result.current.isLoading).toBe(false);
  });
});

describe("usePushNotification — unsubscribe", () => {
  it("unsubscribe() is a no-op when there is no active subscription", async () => {
    mockAuthState = { isAuthenticated: true, identity: { id: 1 } };
    const { result } = renderHook(() => usePushNotification());
    await waitFor(() => expect(result.current.isSupported).toBe(true));
    await act(async () => {
      await result.current.unsubscribe();
    });
    expect(mockUnregisterPushSubscription).not.toHaveBeenCalled();
  });

  it("unsubscribe() calls subscription.unsubscribe(), unregisters on canister, clears localStorage flag", async () => {
    mockAuthState = { isAuthenticated: true, identity: { id: 1 } };
    mockPermission = "granted";
    const { result } = renderHook(() => usePushNotification());
    await waitFor(() => expect(result.current.isSupported).toBe(true));

    await act(async () => {
      await result.current.subscribe();
    });
    expect(result.current.isSubscribed).toBe(true);

    const captured = result.current.subscription as unknown as MockPushSubscription;
    await act(async () => {
      await result.current.unsubscribe();
    });
    expect(captured.unsubscribe).toHaveBeenCalled();
    expect(mockUnregisterPushSubscription).toHaveBeenCalledWith("https://push.example.com/abc");
    expect(localStorage.getItem("aegis-push-enabled")).toBeNull();
    expect(result.current.subscription).toBeNull();
    expect(result.current.isSubscribed).toBe(false);
  });

  it("unsubscribe() survives canister unregister failure with isLoading reset", async () => {
    mockAuthState = { isAuthenticated: true, identity: { id: 1 } };
    mockPermission = "granted";
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => usePushNotification());
    await waitFor(() => expect(result.current.isSupported).toBe(true));

    await act(async () => {
      await result.current.subscribe();
    });

    mockUnregisterPushSubscription.mockRejectedValueOnce(new Error("network down"));
    await act(async () => {
      await result.current.unsubscribe();
    });
    expect(result.current.isLoading).toBe(false);
    errSpy.mockRestore();
  });
});
