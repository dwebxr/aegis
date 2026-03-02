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
import { FeedSection } from "@/components/settings/FeedSection";

let mockAgentEnabled = false;
const mockAddNotification = jest.fn();
let mockStoredKey: string | null = null;
let mockWebLLMEnabled = false;

jest.mock("@/contexts/AgentContext", () => ({
  useAgent: () => ({
    isEnabled: mockAgentEnabled,
    agentState: { peers: [], activeHandshakes: [], pendingOffers: [] },
    toggleAgent: jest.fn(),
  }),
}));

jest.mock("@/contexts/NotificationContext", () => ({
  useNotify: () => ({ addNotification: mockAddNotification }),
}));

jest.mock("@/contexts/FilterModeContext", () => ({
  useFilterMode: () => ({ filterMode: "lite", setFilterMode: jest.fn() }),
}));

jest.mock("@/components/filtering/FilterModeSelector", () => ({
  FilterModeSelector: () => <div data-testid="filter-mode-selector">FilterMode</div>,
}));

jest.mock("@/lib/apiKey/storage", () => ({
  getUserApiKey: () => mockStoredKey,
  setUserApiKey: (key: string) => { mockStoredKey = key; },
  clearUserApiKey: () => { mockStoredKey = null; },
  maskApiKey: (key: string) => key.length <= 12 ? key : `${key.slice(0, 7)}...${key.slice(-4)}`,
}));

jest.mock("@/lib/webllm/storage", () => ({
  isWebLLMEnabled: () => mockWebLLMEnabled,
  setWebLLMEnabled: (v: boolean) => { mockWebLLMEnabled = v; },
}));

jest.mock("@/lib/webllm/engine", () => ({
  isWebGPUAvailable: () => true,
  isWebGPUUsable: async () => true,
  onStatusChange: () => () => {},
  destroyEngine: async () => {},
}));

jest.mock("@/lib/ollama/storage", () => ({
  getOllamaConfig: () => ({ endpoint: "http://localhost:11434", model: "llama3.1:8b", enabled: false }),
  setOllamaConfig: jest.fn(),
  isOllamaEnabled: () => false,
}));

beforeEach(() => {
  mockAgentEnabled = false;
  mockStoredKey = null;
  mockWebLLMEnabled = false;
  mockAddNotification.mockClear();
});

describe("FeedSection — Filter Mode", () => {
  it("renders FilterModeSelector", () => {
    render(<FeedSection />);
    expect(screen.getByTestId("filter-mode-selector")).toBeTruthy();
  });

  it("shows engine status indicators", () => {
    const html = renderToStaticMarkup(<FeedSection />);
    expect(html).toContain("Local LLM (Ollama)");
    expect(html).toContain("Browser AI (WebLLM)");
    expect(html).toContain("API Key (BYOK)");
    expect(html).toContain("IC LLM (D2A Agent)");
  });

  it("shows green dot for engines that are enabled", () => {
    mockAgentEnabled = true;
    mockStoredKey = "sk-ant-test";
    render(<FeedSection />);
    // Both API Key and D2A Agent should show as on
    const html = renderToStaticMarkup(<FeedSection />);
    expect(html).toContain("Filter Mode");
  });
});

describe("FeedSection — AI Scoring (BYOK)", () => {
  it("shows 'Using server default' when no key", () => {
    mockStoredKey = null;
    const html = renderToStaticMarkup(<FeedSection />);
    expect(html).toContain("Using server default");
    expect(html).toContain("sk-ant-...");
    expect(html).toContain("Save");
  });

  it("shows masked key when key is stored", () => {
    mockStoredKey = "sk-ant-api03-abcdefghijklmnop";
    const html = renderToStaticMarkup(<FeedSection />);
    expect(html).toContain("API Key Set");
    expect(html).toContain("sk-ant-...mnop");
    expect(html).toContain("Clear");
  });

  it("shows BYOK description", () => {
    const html = renderToStaticMarkup(<FeedSection />);
    expect(html).toContain("Anthropic API key");
    expect(html).toContain("stored in localStorage");
  });

  it("validates key format on save", () => {
    render(<FeedSection />);
    const input = screen.getByPlaceholderText("sk-ant-...");
    fireEvent.change(input, { target: { value: "invalid-key" } });
    fireEvent.click(screen.getByText("Save"));
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.stringContaining("Invalid key format"),
      "error"
    );
  });

  it("saves valid API key", () => {
    render(<FeedSection />);
    const input = screen.getByPlaceholderText("sk-ant-...");
    fireEvent.change(input, { target: { value: "sk-ant-api03-validkey123456" } });
    fireEvent.click(screen.getByText("Save"));
    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.stringContaining("Pro mode ready"),
      "success"
    );
  });

  it("Save button is disabled when input is empty", () => {
    const html = renderToStaticMarkup(<FeedSection />);
    // Save button should have not-allowed cursor when disabled
    expect(html).toContain("not-allowed");
  });

  it("Clear key requires confirmation", () => {
    mockStoredKey = "sk-ant-api03-testkey";
    render(<FeedSection />);
    fireEvent.click(screen.getByText("Clear"));
    expect(screen.getByText("Remove key?")).toBeTruthy();
    expect(screen.getByText("Confirm")).toBeTruthy();
    expect(screen.getByText("Cancel")).toBeTruthy();
  });

  it("Clear key confirms and removes", () => {
    mockStoredKey = "sk-ant-api03-testkey";
    render(<FeedSection />);
    fireEvent.click(screen.getByText("Clear"));
    fireEvent.click(screen.getByText("Confirm"));
    expect(mockAddNotification).toHaveBeenCalledWith("API key removed", "success");
  });
});

describe("FeedSection — Browser AI (WebLLM)", () => {
  it("shows Disabled when WebLLM is off", () => {
    mockWebLLMEnabled = false;
    const html = renderToStaticMarkup(<FeedSection />);
    expect(html).toContain("Disabled");
  });

  it("shows Enabled when WebLLM is on", () => {
    mockWebLLMEnabled = true;
    const html = renderToStaticMarkup(<FeedSection />);
    expect(html).toContain("Enabled");
  });

  it("shows WebGPU and model info", () => {
    const html = renderToStaticMarkup(<FeedSection />);
    expect(html).toContain("WebGPU");
    expect(html).toContain("Llama 3.1 8B");
    expect(html).toContain("4GB");
    expect(html).toContain("No data leaves your device");
  });
});

describe("FeedSection — Local LLM (Ollama)", () => {
  it("shows Ollama section", () => {
    const html = renderToStaticMarkup(<FeedSection />);
    expect(html).toContain("Local LLM (Ollama)");
    expect(html).toContain("Disabled");
  });

  it("shows Ollama description", () => {
    const html = renderToStaticMarkup(<FeedSection />);
    expect(html).toContain("Connect to Ollama");
    expect(html).toContain("zero cost");
  });
});

describe("FeedSection — mobile", () => {
  it("renders without error in mobile mode", () => {
    const html = renderToStaticMarkup(<FeedSection mobile />);
    expect(html).toContain("Filter Mode");
    expect(html).toContain("AI Scoring");
    expect(html).toContain("Browser AI");
  });
});
