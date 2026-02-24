import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FilterModeSelector } from "@/components/filtering/FilterModeSelector";

// Mock the context hooks
const mockSetFilterMode = jest.fn();
let mockFilterMode = "lite";
let mockIsAuthenticated = false;

jest.mock("@/contexts/FilterModeContext", () => ({
  useFilterMode: () => ({
    filterMode: mockFilterMode,
    setFilterMode: mockSetFilterMode,
  }),
}));

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: mockIsAuthenticated,
  }),
}));

let mockOllamaEnabled = false;
let mockWebLLMEnabled = false;
let mockUserApiKey: string | null = null;
let mockAgentEnabled = false;

jest.mock("@/contexts/AgentContext", () => ({
  useAgent: () => ({
    isEnabled: mockAgentEnabled,
  }),
}));

jest.mock("@/lib/ollama/storage", () => ({
  isOllamaEnabled: () => mockOllamaEnabled,
}));
jest.mock("@/lib/webllm/storage", () => ({
  isWebLLMEnabled: () => mockWebLLMEnabled,
}));
jest.mock("@/lib/apiKey/storage", () => ({
  getUserApiKey: () => mockUserApiKey,
}));

describe("FilterModeSelector", () => {
  beforeEach(() => {
    mockFilterMode = "lite";
    mockIsAuthenticated = false;
    mockOllamaEnabled = false;
    mockWebLLMEnabled = false;
    mockUserApiKey = null;
    mockAgentEnabled = false;
    mockSetFilterMode.mockClear();
  });

  describe("rendering", () => {
    it("renders Lite and Pro buttons", () => {
      const html = renderToStaticMarkup(<FilterModeSelector />);
      expect(html).toContain("Lite");
      expect(html).toContain("Pro");
    });

    it("shows subtitles in desktop mode", () => {
      const html = renderToStaticMarkup(<FilterModeSelector mobile={false} />);
      expect(html).toContain("WoT + Heuristic");
    });

    it("hides subtitles in mobile mode", () => {
      const html = renderToStaticMarkup(<FilterModeSelector mobile />);
      expect(html).not.toContain("WoT + Heuristic");
      expect(html).not.toContain("WoT + AI");
    });

    it("shows 'Login required' for Pro when not authenticated", () => {
      mockIsAuthenticated = false;
      const html = renderToStaticMarkup(<FilterModeSelector mobile={false} />);
      expect(html).toContain("Login required");
    });

    it("shows 'AI setup required' when authenticated but no AI scoring", () => {
      mockIsAuthenticated = true;
      const html = renderToStaticMarkup(<FilterModeSelector mobile={false} />);
      expect(html).toContain("AI setup required");
      expect(html).not.toContain("Login required");
    });

    it("shows 'WoT + AI' subtitle for Pro when authenticated with AI scoring", () => {
      mockIsAuthenticated = true;
      mockUserApiKey = "sk-ant-test-key";
      const html = renderToStaticMarkup(<FilterModeSelector mobile={false} />);
      expect(html).toContain("WoT + AI");
      expect(html).not.toContain("Login required");
      expect(html).not.toContain("AI setup required");
    });

    it("renders Pro button as disabled when not authenticated", () => {
      mockIsAuthenticated = false;
      const html = renderToStaticMarkup(<FilterModeSelector />);
      // disabled attribute on the Pro button
      expect(html).toContain("disabled");
    });

    it("renders Pro button as enabled when authenticated with AI scoring", () => {
      mockIsAuthenticated = true;
      mockOllamaEnabled = true;
      const html = renderToStaticMarkup(<FilterModeSelector />);
      const disabledCount = (html.match(/disabled=""/g) || []).length;
      expect(disabledCount).toBe(0);
    });

    it("renders Pro button as disabled when authenticated but no AI scoring", () => {
      mockIsAuthenticated = true;
      const html = renderToStaticMarkup(<FilterModeSelector />);
      expect(html).toContain("disabled");
    });
  });

  describe("active state", () => {
    it("reflects lite mode as active", () => {
      mockFilterMode = "lite";
      const html = renderToStaticMarkup(<FilterModeSelector />);
      // The Lite button should have different styling (opaque border)
      expect(html).toContain("Lite");
    });

    it("reflects pro mode as active", () => {
      mockFilterMode = "pro";
      mockIsAuthenticated = true;
      mockWebLLMEnabled = true;
      const html = renderToStaticMarkup(<FilterModeSelector />);
      expect(html).toContain("Pro");
    });
  });

  describe("MODES config", () => {
    it("has exactly 2 modes", () => {
      const html = renderToStaticMarkup(<FilterModeSelector />);
      expect(html).toContain("Lite");
      expect(html).toContain("Pro");
    });
  });

  describe("AI scoring gate", () => {
    it("unlocks Pro when Ollama is enabled", () => {
      mockIsAuthenticated = true;
      mockOllamaEnabled = true;
      const html = renderToStaticMarkup(<FilterModeSelector />);
      const disabledCount = (html.match(/disabled=""/g) || []).length;
      expect(disabledCount).toBe(0);
    });

    it("unlocks Pro when WebLLM is enabled", () => {
      mockIsAuthenticated = true;
      mockWebLLMEnabled = true;
      const html = renderToStaticMarkup(<FilterModeSelector />);
      const disabledCount = (html.match(/disabled=""/g) || []).length;
      expect(disabledCount).toBe(0);
    });

    it("unlocks Pro when BYOK API key is saved", () => {
      mockIsAuthenticated = true;
      mockUserApiKey = "sk-ant-test-key";
      const html = renderToStaticMarkup(<FilterModeSelector />);
      const disabledCount = (html.match(/disabled=""/g) || []).length;
      expect(disabledCount).toBe(0);
    });

    it("locks Pro when authenticated but no AI source configured", () => {
      mockIsAuthenticated = true;
      const html = renderToStaticMarkup(<FilterModeSelector mobile={false} />);
      expect(html).toContain("disabled");
      expect(html).toContain("AI setup required");
    });

    it("unlocks Pro when D2A Agent is enabled", () => {
      mockIsAuthenticated = true;
      mockAgentEnabled = true;
      const html = renderToStaticMarkup(<FilterModeSelector />);
      const disabledCount = (html.match(/disabled=""/g) || []).length;
      expect(disabledCount).toBe(0);
    });

    it("locks Pro when authenticated but no AI source and no D2A Agent", () => {
      mockIsAuthenticated = true;
      mockAgentEnabled = false;
      const html = renderToStaticMarkup(<FilterModeSelector mobile={false} />);
      expect(html).toContain("disabled");
      expect(html).toContain("AI setup required");
    });
  });
});
