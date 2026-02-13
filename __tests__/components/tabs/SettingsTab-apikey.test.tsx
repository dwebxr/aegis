import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsTab } from "@/components/tabs/SettingsTab";

// Mock context hooks
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    principalText: "test-principal-id",
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
    isSubscribed: false,
  }),
}));

jest.mock("@/contexts/NotificationContext", () => ({
  useNotify: () => ({
    addNotification: jest.fn(),
  }),
}));

// Mock apiKey storage
let mockStoredKey: string | null = null;
jest.mock("@/lib/apiKey/storage", () => ({
  getUserApiKey: () => mockStoredKey,
  setUserApiKey: (key: string) => { mockStoredKey = key; },
  clearUserApiKey: () => { mockStoredKey = null; },
  hasUserApiKey: () => mockStoredKey !== null,
  maskApiKey: (key: string) => key.length <= 12 ? key : `${key.slice(0, 7)}...${key.slice(-4)}`,
}));

describe("SettingsTab — AI Scoring section", () => {
  beforeEach(() => {
    mockStoredKey = null;
  });

  it("renders the AI Scoring section", () => {
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("AI Scoring");
  });

  it("shows 'Using server default' when no key is stored", () => {
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("Using server default");
  });

  it("shows input placeholder when no key is stored", () => {
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("sk-ant-...");
    expect(html).toContain("Save");
  });

  it("shows masked key when key is stored", () => {
    mockStoredKey = "sk-ant-api03-abcdefghijklmnop";
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("API Key Set");
    expect(html).toContain("sk-ant-...mnop");
    expect(html).toContain("Clear");
  });

  it("shows localStorage warning text", () => {
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("stored in localStorage");
  });

  it("renders all main sections", () => {
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("Push Notifications");
    expect(html).toContain("D2A Social Agent");
    expect(html).toContain("AI Scoring");
    expect(html).toContain("Account");
    expect(html).toContain("Data Management");
    expect(html).toContain("AEGIS");
  });
});
