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

jest.mock("@/contexts/FilterModeContext", () => ({
  useFilterMode: () => ({ filterMode: "lite", setFilterMode: jest.fn() }),
}));

// Mock apiKey storage
let mockStoredKey: string | null = null;
jest.mock("@/lib/apiKey/storage", () => ({
  getUserApiKey: () => mockStoredKey,
  setUserApiKey: jest.fn().mockReturnValue(true),
  clearUserApiKey: jest.fn().mockReturnValue(true),
  maskApiKey: (key: string) => key.length <= 12 ? key : `${key.slice(0, 7)}...${key.slice(-4)}`,
}));

jest.mock("@/lib/webllm/storage", () => ({
  isWebLLMEnabled: () => false,
  setWebLLMEnabled: jest.fn(),
}));

jest.mock("@/lib/webllm/engine", () => ({
  isWebGPUAvailable: () => true,
  onStatusChange: () => () => {},
  destroyEngine: async () => {},
}));

jest.mock("@/lib/ollama/storage", () => ({
  getOllamaConfig: () => ({ endpoint: "http://localhost:11434", model: "llama3.1:8b", enabled: false }),
  setOllamaConfig: jest.fn(),
  isOllamaEnabled: () => false,
}));

describe("SettingsTab — AI Scoring section (Feeds sub-tab)", () => {
  beforeEach(() => {
    mockStoredKey = null;
  });

  it("renders the AI Scoring section", () => {
    const html = renderToStaticMarkup(<SettingsTab initialSubTab="feeds" />);
    expect(html).toContain("AI Scoring");
  });

  it("shows 'Using server default' when no key is stored", () => {
    const html = renderToStaticMarkup(<SettingsTab initialSubTab="feeds" />);
    expect(html).toContain("Using server default");
  });

  it("shows input placeholder when no key is stored", () => {
    const html = renderToStaticMarkup(<SettingsTab initialSubTab="feeds" />);
    expect(html).toContain("sk-ant-...");
    expect(html).toContain("Save");
  });

  it("shows masked key when key is stored", () => {
    mockStoredKey = "sk-ant-api03-abcdefghijklmnop";
    const html = renderToStaticMarkup(<SettingsTab initialSubTab="feeds" />);
    expect(html).toContain("API Key Set");
    expect(html).toContain("sk-ant-...mnop");
    expect(html).toContain("Clear");
  });

  it("shows localStorage warning text", () => {
    const html = renderToStaticMarkup(<SettingsTab initialSubTab="feeds" />);
    expect(html).toContain("stored in localStorage");
  });

  it("renders sub-tab navigation with all tabs", () => {
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("General");
    expect(html).toContain("Agent");
    expect(html).toContain("Feeds");
    expect(html).toContain("Data");
    expect(html).toContain("Account");
    // Default tab shows Push Notifications
    expect(html).toContain("Push Notifications");
  });
});
