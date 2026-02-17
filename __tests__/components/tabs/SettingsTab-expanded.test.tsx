import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsTab } from "@/components/tabs/SettingsTab";

/* ---------- Shared mock variables ---------- */
let mockIsAuthenticated = true;
let mockPrincipalText = "abc-123-principal-id";
const mockLogin = jest.fn();
let mockAgentEnabled = false;
let mockIsSubscribed = false;
const mockAddNotification = jest.fn();
let mockStoredKey: string | null = null;
let mockWebLLMEnabled = false;

/* ---------- Mocks ---------- */
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: mockIsAuthenticated,
    principalText: mockPrincipalText,
    login: mockLogin,
  }),
}));

jest.mock("@/contexts/AgentContext", () => ({
  useAgent: () => ({
    isEnabled: mockAgentEnabled,
    agentState: { peers: [], activeHandshakes: [], pendingOffers: [] },
    toggleAgent: jest.fn(),
  }),
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

jest.mock("@/contexts/NotificationContext", () => ({
  useNotify: () => ({
    addNotification: mockAddNotification,
  }),
}));

jest.mock("@/lib/webllm/storage", () => ({
  isWebLLMEnabled: () => mockWebLLMEnabled,
  setWebLLMEnabled: (v: boolean) => { mockWebLLMEnabled = v; },
}));

jest.mock("@/lib/webllm/engine", () => ({
  isWebGPUAvailable: () => true,
  onStatusChange: () => () => {},
  destroyEngine: async () => {},
}));

jest.mock("@/lib/apiKey/storage", () => ({
  getUserApiKey: () => mockStoredKey,
  setUserApiKey: (key: string) => { mockStoredKey = key; },
  clearUserApiKey: () => { mockStoredKey = null; },
  maskApiKey: (key: string) => key.length <= 12 ? key : `${key.slice(0, 7)}...${key.slice(-4)}`,
}));

describe("SettingsTab — unauthenticated state", () => {
  beforeEach(() => {
    mockIsAuthenticated = false;
    mockPrincipalText = "";
    mockAgentEnabled = false;
    mockIsSubscribed = false;
    mockStoredKey = null;
    mockWebLLMEnabled = false;
  });

  it("shows 'Not connected' and login button when unauthenticated", () => {
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("Not connected");
    expect(html).toContain("Login with Internet Identity");
  });

  it("does not show principal text when unauthenticated", () => {
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).not.toContain("Principal:");
  });

  it("shows disabled Reset Preferences button", () => {
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("Reset Preferences");
    // The button should be disabled (opacity 0.4)
    expect(html).toContain("not-allowed");
  });
});

describe("SettingsTab — authenticated state", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "xyz-789-test-principal";
    mockAgentEnabled = false;
    mockIsSubscribed = false;
    mockStoredKey = null;
    mockWebLLMEnabled = false;
  });

  it("shows Connected badge and principal text", () => {
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("Connected");
    expect(html).toContain("xyz-789-test-principal");
    expect(html).toContain("Principal:");
  });

  it("shows Copy button next to principal", () => {
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("Copy");
  });

  it("shows enabled Reset Preferences button (pointer cursor)", () => {
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("Reset Preferences");
    // When authenticated, Reset Preferences button should not show "not-allowed" cursor
    // Split HTML to isolate the Reset Preferences section
    const resetIdx = html.indexOf("Reset Preferences");
    // Find the button element near "Reset Preferences" text
    const buttonBefore = html.lastIndexOf("<button", resetIdx);
    const buttonEnd = html.indexOf("</button>", resetIdx);
    const resetButton = html.slice(buttonBefore, buttonEnd);
    expect(resetButton).toContain("pointer");
    expect(resetButton).not.toContain("not-allowed");
  });
});

describe("SettingsTab — agent enabled state", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockAgentEnabled = true;
    mockIsSubscribed = false;
    mockStoredKey = null;
    mockWebLLMEnabled = false;
  });

  it("shows protocol parameters when agent is enabled", () => {
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("Min Score");
    expect(html).toContain("Resonance");
    expect(html).toContain("Fee Range");
    expect(html).toContain("Approval");
    // Shows ICP amounts
    expect(html).toContain("ICP");
  });
});

describe("SettingsTab — agent disabled state", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockAgentEnabled = false;
    mockIsSubscribed = false;
    mockStoredKey = null;
    mockWebLLMEnabled = false;
  });

  it("does not show protocol parameters when agent is disabled", () => {
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("D2A Social Agent");
    expect(html).not.toContain("Min Score");
    expect(html).not.toContain("Fee Range");
  });
});

describe("SettingsTab — push subscribed state", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockAgentEnabled = false;
    mockIsSubscribed = true;
    mockStoredKey = null;
    mockWebLLMEnabled = false;
  });

  it("shows frequency selector when subscribed to push", () => {
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("Frequency");
    expect(html).toContain("Off");
    expect(html).toContain("1x/day");
    expect(html).toContain("3x/day");
    expect(html).toContain("Realtime");
  });

  it("shows frequency description text", () => {
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("Controls how often briefing alerts are sent");
  });
});

describe("SettingsTab — push not subscribed", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockAgentEnabled = false;
    mockIsSubscribed = false;
    mockStoredKey = null;
    mockWebLLMEnabled = false;
  });

  it("does not show frequency selector when not subscribed", () => {
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).not.toContain("Frequency");
    expect(html).not.toContain("1x/day");
  });
});

describe("SettingsTab — mobile prop", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockAgentEnabled = false;
    mockIsSubscribed = false;
    mockStoredKey = null;
    mockWebLLMEnabled = false;
  });

  it("renders without errors in mobile mode", () => {
    const html = renderToStaticMarkup(<SettingsTab mobile />);
    expect(html).toContain("Settings");
    expect(html).toContain("AI Scoring");
    expect(html).toContain("Account");
  });

  it("renders without errors in desktop mode", () => {
    const html = renderToStaticMarkup(<SettingsTab mobile={false} />);
    expect(html).toContain("Settings");
  });
});

describe("SettingsTab — Data Management section", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockAgentEnabled = false;
    mockIsSubscribed = false;
    mockStoredKey = null;
    mockWebLLMEnabled = false;
  });

  it("shows Clear Content Cache button", () => {
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("Clear Content Cache");
  });

  it("shows data management description", () => {
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("Cache stores dedup hashes");
    expect(html).toContain("source state");
  });
});

describe("SettingsTab — About section", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockAgentEnabled = false;
    mockIsSubscribed = false;
    mockStoredKey = null;
    mockWebLLMEnabled = false;
  });

  it("shows AEGIS branding and version", () => {
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("AEGIS");
    expect(html).toContain("v3.0");
    expect(html).toContain("D2A Social Agent Platform");
  });

  it("shows GitHub link", () => {
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("GitHub");
    expect(html).toContain("https://github.com/dwebxr/aegis");
  });
});

describe("SettingsTab — API key states", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockAgentEnabled = false;
    mockIsSubscribed = false;
  });

  it("shows green status dot when API key is set", () => {
    mockStoredKey = "sk-ant-api03-testkey12345678";
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("API Key Set");
    // Should show Clear button, not Save
    expect(html).toContain("Clear");
    expect(html).not.toContain("Save");
  });

  it("shows gray status and input when no API key", () => {
    mockStoredKey = null;
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("Using server default");
    expect(html).toContain("Save");
    // Should show password input, not the Clear button (note: "Clear Content Cache" also contains "Clear")
    expect(html).toContain("sk-ant-...");
    expect(html).toContain("type=\"password\"");
  });

  it("shows BYOK description text", () => {
    mockStoredKey = null;
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("Anthropic API key");
    expect(html).toContain("Pro mode");
  });
});

describe("SettingsTab — header", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockAgentEnabled = false;
    mockIsSubscribed = false;
    mockStoredKey = null;
    mockWebLLMEnabled = false;
  });

  it("shows Settings title and subtitle", () => {
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("Settings");
    expect(html).toContain("Notifications, agent controls");
  });
});

describe("SettingsTab — Browser AI (WebLLM) section", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockAgentEnabled = false;
    mockIsSubscribed = false;
    mockStoredKey = null;
    mockWebLLMEnabled = false;
  });

  it("always renders Browser AI card with toggle", () => {
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("Browser AI");
    // Toggle button is always present
    expect(html).toContain("Disabled");
  });

  it("shows Disabled label when WebLLM is off", () => {
    mockWebLLMEnabled = false;
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("Disabled");
    expect(html).not.toContain("Enabled");
  });

  it("shows Enabled label when WebLLM is on", () => {
    mockWebLLMEnabled = true;
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("Enabled");
  });

  it("shows description text about WebGPU and Llama", () => {
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("WebGPU");
    expect(html).toContain("Llama 3.1 8B");
    expect(html).toContain("No data leaves your device");
  });

  it("shows ~4GB download notice", () => {
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("4GB");
  });

  it("renders in mobile mode without errors", () => {
    mockWebLLMEnabled = true;
    const html = renderToStaticMarkup(<SettingsTab mobile />);
    expect(html).toContain("Browser AI");
    expect(html).toContain("Enabled");
  });
});

describe("SettingsTab — section ordering", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockAgentEnabled = false;
    mockIsSubscribed = false;
    mockStoredKey = null;
    mockWebLLMEnabled = false;
  });

  it("renders all major sections", () => {
    const html = renderToStaticMarkup(<SettingsTab />);
    expect(html).toContain("Push Notifications");
    expect(html).toContain("D2A Social Agent");
    expect(html).toContain("Filter Mode");
    expect(html).toContain("AI Scoring");
    expect(html).toContain("Browser AI");
    expect(html).toContain("Account");
    expect(html).toContain("Data Management");
    expect(html).toContain("AEGIS");
  });

  it("Filter Mode, AI Scoring, Browser AI, Account appear in order", () => {
    const html = renderToStaticMarkup(<SettingsTab />);
    const filterModeIdx = html.indexOf("Filter Mode");
    const aiScoringIdx = html.indexOf("AI Scoring");
    // Use section title occurrence (">Browser AI<") to skip engine status label
    const browserAiIdx = html.indexOf(">Browser AI<");
    const accountIdx = html.indexOf("Account");
    expect(filterModeIdx).toBeLessThan(aiScoringIdx);
    expect(aiScoringIdx).toBeLessThan(browserAiIdx);
    expect(browserAiIdx).toBeLessThan(accountIdx);
  });
});
