import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NotificationToggle } from "@/components/ui/NotificationToggle";

let mockIsAuthenticated = true;
let mockIsSupported = true;
let mockPermission: NotificationPermission = "default";
let mockIsSubscribed = false;
let mockIsLoading = false;

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: mockIsAuthenticated,
  }),
}));

jest.mock("@/hooks/usePushNotification", () => ({
  usePushNotification: () => ({
    isSupported: mockIsSupported,
    permission: mockPermission,
    isSubscribed: mockIsSubscribed,
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    isLoading: mockIsLoading,
  }),
}));

describe("NotificationToggle — renders null conditions", () => {
  it("returns null when not authenticated", () => {
    mockIsAuthenticated = false;
    mockIsSupported = true;
    mockPermission = "default";
    mockIsSubscribed = false;
    mockIsLoading = false;
    const html = renderToStaticMarkup(<NotificationToggle />);
    expect(html).toBe("");
  });

  it("returns null when push is not supported", () => {
    mockIsAuthenticated = true;
    mockIsSupported = false;
    const html = renderToStaticMarkup(<NotificationToggle />);
    expect(html).toBe("");
  });

  it("returns null when both unauthenticated and unsupported", () => {
    mockIsAuthenticated = false;
    mockIsSupported = false;
    const html = renderToStaticMarkup(<NotificationToggle />);
    expect(html).toBe("");
  });
});

describe("NotificationToggle — full mode (non-compact)", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockIsSupported = true;
    mockPermission = "default";
    mockIsSubscribed = false;
    mockIsLoading = false;
  });

  it("shows 'Push Notifications' label", () => {
    const html = renderToStaticMarkup(<NotificationToggle />);
    expect(html).toContain("Push Notifications");
  });

  it("shows 'On' button when not subscribed", () => {
    mockIsSubscribed = false;
    const html = renderToStaticMarkup(<NotificationToggle />);
    expect(html).toContain("On");
    expect(html).toContain("Get briefing alerts");
  });

  it("shows 'Off' button when subscribed", () => {
    mockIsSubscribed = true;
    const html = renderToStaticMarkup(<NotificationToggle />);
    expect(html).toContain("Off");
    expect(html).toContain("Briefing alerts active");
  });

  it("shows 'Blocked in browser' when permission is denied", () => {
    mockPermission = "denied";
    mockIsSubscribed = false;
    const html = renderToStaticMarkup(<NotificationToggle />);
    expect(html).toContain("Blocked in browser");
    expect(html).toContain("not-allowed");
  });

  it("shows '...' when loading", () => {
    mockIsLoading = true;
    const html = renderToStaticMarkup(<NotificationToggle />);
    expect(html).toContain("...");
  });

  it("disables button when permission is denied", () => {
    mockPermission = "denied";
    const html = renderToStaticMarkup(<NotificationToggle />);
    expect(html).toContain("not-allowed");
  });

  it("disables button when loading", () => {
    mockIsLoading = true;
    const html = renderToStaticMarkup(<NotificationToggle />);
    expect(html).toContain("not-allowed");
  });
});

describe("NotificationToggle — compact mode", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockIsSupported = true;
    mockPermission = "default";
    mockIsSubscribed = false;
    mockIsLoading = false;
  });

  it("renders compact bell button when not subscribed", () => {
    const html = renderToStaticMarkup(<NotificationToggle compact />);
    // Should have bell SVG
    expect(html).toContain("<svg");
    expect(html).toContain("Enable push notifications");
    // Should not have text labels
    expect(html).not.toContain("Push Notifications");
  });

  it("renders compact bell with active indicator when subscribed", () => {
    mockIsSubscribed = true;
    const html = renderToStaticMarkup(<NotificationToggle compact />);
    expect(html).toContain("Push notifications on");
    // Active state has a filled circle indicator
    expect(html).toContain("<circle");
  });

  it("shows blocked title when denied in compact mode", () => {
    mockPermission = "denied";
    const html = renderToStaticMarkup(<NotificationToggle compact />);
    expect(html).toContain("Notifications blocked");
    expect(html).toContain("not-allowed");
  });

  it("returns null in compact mode when not authenticated", () => {
    mockIsAuthenticated = false;
    const html = renderToStaticMarkup(<NotificationToggle compact />);
    expect(html).toBe("");
  });
});
