/**
 * @jest-environment jsdom
 */
// Polyfill TextEncoder for react-dom/server in jsdom environment
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsTab } from "@/components/tabs/SettingsTab";

/* ---------- Mocks (all sub-sections have dependencies) ---------- */
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    principalText: "test-principal",
    login: jest.fn(),
  }),
}));

jest.mock("@/contexts/AgentContext", () => ({
  useAgent: () => ({
    isEnabled: false,
    agentState: { peers: [], activeHandshakes: [], pendingOffers: [] },
    toggleAgent: jest.fn(),
  }),
}));

jest.mock("@/hooks/usePushNotification", () => ({
  usePushNotification: () => ({
    isSubscribed: false, isSupported: true, permission: "default",
    subscribe: jest.fn(), unsubscribe: jest.fn(), isLoading: false,
  }),
}));

jest.mock("@/contexts/NotificationContext", () => ({
  useNotify: () => ({ addNotification: jest.fn() }),
}));

jest.mock("@/contexts/FilterModeContext", () => ({
  useFilterMode: () => ({ filterMode: "lite", setFilterMode: jest.fn() }),
}));

jest.mock("@/lib/webllm/storage", () => ({
  isWebLLMEnabled: () => false, setWebLLMEnabled: jest.fn(),
}));

jest.mock("@/lib/webllm/engine", () => ({
  isWebGPUAvailable: () => true, onStatusChange: () => () => {}, destroyEngine: async () => {},
}));

jest.mock("@/lib/apiKey/storage", () => ({
  getUserApiKey: () => null, setUserApiKey: jest.fn(), clearUserApiKey: jest.fn(),
  maskApiKey: (key: string) => key,
}));

jest.mock("@/lib/ollama/storage", () => ({
  getOllamaConfig: () => ({ endpoint: "http://localhost:11434", model: "llama3.1:8b", enabled: false }),
  setOllamaConfig: jest.fn(), isOllamaEnabled: () => false,
}));

describe("SettingsTab — sub-tab click navigation", () => {
  it("defaults to General tab content on initial render", () => {
    render(<SettingsTab />);
    expect(screen.getByText("Appearance")).toBeTruthy();
    expect(screen.getByText("Theme")).toBeTruthy();
  });

  it("switches to Agent tab on click", () => {
    render(<SettingsTab />);
    fireEvent.click(screen.getByTestId("settings-tab-agent"));
    expect(screen.getByText("Agent Preferences")).toBeTruthy();
    expect(screen.getByText("D2A Social Agent")).toBeTruthy();
    // General content should be gone
    expect(screen.queryByText("Appearance")).toBeNull();
  });

  it("switches to Feeds tab on click", () => {
    render(<SettingsTab />);
    fireEvent.click(screen.getByTestId("settings-tab-feeds"));
    expect(screen.getByText("AI Scoring")).toBeTruthy();
    expect(screen.queryByText("Appearance")).toBeNull();
  });

  it("switches to Data tab on click", () => {
    render(<SettingsTab />);
    fireEvent.click(screen.getByTestId("settings-tab-data"));
    expect(screen.getByText("Data Management")).toBeTruthy();
    expect(screen.queryByText("Appearance")).toBeNull();
  });

  it("switches to Account tab on click", () => {
    render(<SettingsTab />);
    fireEvent.click(screen.getByTestId("settings-tab-account"));
    expect(screen.getByText("AEGIS")).toBeTruthy();
    expect(screen.queryByText("Appearance")).toBeNull();
  });

  it("can navigate back and forth between tabs", () => {
    render(<SettingsTab />);
    // General → Agent → General
    fireEvent.click(screen.getByTestId("settings-tab-agent"));
    expect(screen.getByText("Agent Preferences")).toBeTruthy();

    fireEvent.click(screen.getByTestId("settings-tab-general"));
    expect(screen.getByText("Appearance")).toBeTruthy();
    expect(screen.queryByText("Agent Preferences")).toBeNull();
  });
});

describe("SettingsTab — initialSubTab prop", () => {
  it("renders General when initialSubTab is 'general'", () => {
    const html = renderToStaticMarkup(<SettingsTab initialSubTab="general" />);
    expect(html).toContain("Appearance");
    expect(html).toContain("Push Notifications");
  });

  it("renders Agent when initialSubTab is 'agent'", () => {
    const html = renderToStaticMarkup(<SettingsTab initialSubTab="agent" />);
    expect(html).toContain("Agent Preferences");
    expect(html).not.toContain("Appearance");
  });

  it("renders Feeds when initialSubTab is 'feeds'", () => {
    const html = renderToStaticMarkup(<SettingsTab initialSubTab="feeds" />);
    expect(html).toContain("AI Scoring");
    expect(html).not.toContain("Appearance");
  });

  it("defaults to General for invalid initialSubTab", () => {
    const html = renderToStaticMarkup(<SettingsTab initialSubTab="nonexistent" />);
    expect(html).toContain("Appearance");
    expect(html).toContain("Push Notifications");
  });

  it("defaults to General when initialSubTab is undefined", () => {
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("Appearance");
  });

  it("defaults to General for empty string initialSubTab", () => {
    const html = renderToStaticMarkup(<SettingsTab initialSubTab="" />);
    expect(html).toContain("Appearance");
  });
});

describe("SettingsTab — all sub-tab buttons render with data-testid", () => {
  it("renders all 5 sub-tab buttons", () => {
    render(<SettingsTab />);
    expect(screen.getByTestId("settings-tab-general")).toBeTruthy();
    expect(screen.getByTestId("settings-tab-agent")).toBeTruthy();
    expect(screen.getByTestId("settings-tab-feeds")).toBeTruthy();
    expect(screen.getByTestId("settings-tab-data")).toBeTruthy();
    expect(screen.getByTestId("settings-tab-account")).toBeTruthy();
  });
});

describe("SettingsTab — header", () => {
  it("renders heading with data-testid", () => {
    render(<SettingsTab />);
    expect(screen.getByTestId("aegis-settings-heading")).toBeTruthy();
    expect(screen.getByTestId("aegis-settings-heading").textContent).toBe("Settings");
  });
});
