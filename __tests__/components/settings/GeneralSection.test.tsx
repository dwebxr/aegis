/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
// Polyfill TextEncoder for react-dom/server in jsdom environment
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { GeneralSection } from "@/components/settings/GeneralSection";

let mockTheme = "dark";
const mockSetTheme = jest.fn();
let mockIsSubscribed = false;
let mockNotificationPrefs: Record<string, unknown> = {};
const mockSetNotificationPrefs = jest.fn();

jest.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: mockTheme, setTheme: mockSetTheme }),
}));

jest.mock("@/hooks/usePushNotification", () => ({
  usePushNotification: () => ({
    isSubscribed: mockIsSubscribed,
    isSupported: true,
    permission: "default",
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    isLoading: false,
  }),
}));

jest.mock("@/contexts/PreferenceContext", () => ({
  usePreferences: () => ({
    profile: {
      topicAffinities: {},
      authorTrust: {},
      recentTopics: [],
      totalValidated: 0,
      totalFlagged: 0,
      calibration: { qualityThreshold: 5.5 },
      notificationPrefs: mockNotificationPrefs,
    },
    setNotificationPrefs: mockSetNotificationPrefs,
  }),
}));

jest.mock("@/components/ui/NotificationToggle", () => ({
  NotificationToggle: () => <div data-testid="notification-toggle">Toggle</div>,
}));

beforeEach(() => {
  mockTheme = "dark";
  mockIsSubscribed = false;
  mockNotificationPrefs = {};
  mockSetTheme.mockClear();
  mockSetNotificationPrefs.mockClear();
  localStorage.clear();
});

describe("GeneralSection — Appearance", () => {
  it("renders theme toggle", () => {
    const html = renderToStaticMarkup(<GeneralSection />);
    expect(html).toContain("Appearance");
    expect(html).toContain("Theme");
  });

  it("shows Dark mode label when theme is dark", () => {
    mockTheme = "dark";
    const html = renderToStaticMarkup(<GeneralSection />);
    expect(html).toContain("Dark mode");
  });

  it("shows Light mode label when theme is light", () => {
    mockTheme = "light";
    const html = renderToStaticMarkup(<GeneralSection />);
    expect(html).toContain("Light mode");
  });

  it("calls setTheme on toggle click", () => {
    mockTheme = "dark";
    render(<GeneralSection />);
    const toggle = screen.getByLabelText("Switch to light mode");
    fireEvent.click(toggle);
    expect(mockSetTheme).toHaveBeenCalledWith("light");
  });

  it("toggles from light to dark", () => {
    mockTheme = "light";
    render(<GeneralSection />);
    const toggle = screen.getByLabelText("Switch to dark mode");
    fireEvent.click(toggle);
    expect(mockSetTheme).toHaveBeenCalledWith("dark");
  });
});

describe("GeneralSection — Push Notifications", () => {
  it("renders NotificationToggle component", () => {
    render(<GeneralSection />);
    expect(screen.getByTestId("notification-toggle")).toBeInTheDocument();
  });

  it("does not show frequency options when not subscribed", () => {
    mockIsSubscribed = false;
    const html = renderToStaticMarkup(<GeneralSection />);
    expect(html).not.toContain("Frequency");
    expect(html).not.toContain("1x/day");
  });

  it("shows frequency options when subscribed", () => {
    mockIsSubscribed = true;
    const html = renderToStaticMarkup(<GeneralSection />);
    expect(html).toContain("Frequency");
    expect(html).toContain("Off");
    expect(html).toContain("1x/day");
    expect(html).toContain("3x/day");
    expect(html).toContain("Realtime");
  });

  it("saves frequency to localStorage on click", () => {
    mockIsSubscribed = true;
    render(<GeneralSection />);
    fireEvent.click(screen.getByText("3x/day"));
    expect(localStorage.getItem("aegis-push-frequency")).toBe("3x_day");
  });

  it("restores frequency from localStorage on mount", () => {
    mockIsSubscribed = true;
    localStorage.setItem("aegis-push-frequency", "realtime");
    render(<GeneralSection />);
    // The "Realtime" button should appear with active styling
    const btn = screen.getByText("Realtime");
    expect(btn).toBeInTheDocument();
  });
});

describe("GeneralSection — Notification Rules (subscribed)", () => {
  beforeEach(() => {
    mockIsSubscribed = true;
    mockNotificationPrefs = { topicAlerts: ["bitcoin", "ai"], minScoreAlert: 7, d2aAlerts: false };
  });

  it("shows alert topic chips", () => {
    const html = renderToStaticMarkup(<GeneralSection />);
    expect(html).toContain("bitcoin");
    expect(html).toContain("ai");
    expect(html).toContain("Alert Topics");
  });

  it("shows min score slider with current value", () => {
    const html = renderToStaticMarkup(<GeneralSection />);
    expect(html).toContain("Min Score Alert");
    expect(html).toContain("7/10");
  });

  it("shows D2A Content Alerts toggle", () => {
    const html = renderToStaticMarkup(<GeneralSection />);
    expect(html).toContain("D2A Content Alerts");
  });

  it("removes topic when X button clicked", () => {
    render(<GeneralSection />);
    // Find the remove buttons (×) — there should be 2
    const removeButtons = screen.getAllByText("×");
    fireEvent.click(removeButtons[0]); // Remove "bitcoin"
    expect(mockSetNotificationPrefs).toHaveBeenCalledWith(
      expect.objectContaining({ topicAlerts: ["ai"] })
    );
  });

  it("adds topic on Enter key press", () => {
    render(<GeneralSection />);
    const input = screen.getByPlaceholderText("Add topic...");
    fireEvent.change(input, { target: { value: "Ethereum" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mockSetNotificationPrefs).toHaveBeenCalledWith(
      expect.objectContaining({ topicAlerts: ["bitcoin", "ai", "ethereum"] })
    );
  });

  it("ignores duplicate topic", () => {
    render(<GeneralSection />);
    const input = screen.getByPlaceholderText("Add topic...");
    fireEvent.change(input, { target: { value: "Bitcoin" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // Should not call setNotificationPrefs because "bitcoin" already exists
    expect(mockSetNotificationPrefs).not.toHaveBeenCalled();
  });

  it("ignores empty topic input", () => {
    render(<GeneralSection />);
    const input = screen.getByPlaceholderText("Add topic...");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mockSetNotificationPrefs).not.toHaveBeenCalled();
  });

  it("updates min score on slider change", () => {
    render(<GeneralSection />);
    const slider = screen.getByDisplayValue("7");
    fireEvent.change(slider, { target: { value: "9" } });
    expect(mockSetNotificationPrefs).toHaveBeenCalledWith(
      expect.objectContaining({ minScoreAlert: 9 })
    );
  });

  it("toggles D2A alerts", () => {
    render(<GeneralSection />);
    // The D2A toggle button is inside the flex row parent of "D2A Content Alerts"
    const label = screen.getByText("D2A Content Alerts");
    const flexRow = label.closest("div")!.parentElement!.parentElement!;
    const toggle = flexRow.querySelector("button")!;
    fireEvent.click(toggle);
    expect(mockSetNotificationPrefs).toHaveBeenCalledWith(
      expect.objectContaining({ d2aAlerts: true })
    );
  });
});

describe("GeneralSection — mobile", () => {
  it("renders without error in mobile mode", () => {
    const html = renderToStaticMarkup(<GeneralSection mobile />);
    expect(html).toContain("Appearance");
    expect(html).toContain("Push Notifications");
  });
});
