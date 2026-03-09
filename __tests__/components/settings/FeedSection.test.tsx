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
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
  setUserApiKey: (key: string) => { mockStoredKey = key; return true; },
  clearUserApiKey: () => { mockStoredKey = null; return true; },
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

let mockOllamaConfig = { endpoint: "http://localhost:11434", model: "llama3.1:8b", enabled: false };
const mockSetOllamaConfig = jest.fn();

jest.mock("@/lib/ollama/storage", () => ({
  getOllamaConfig: () => mockOllamaConfig,
  setOllamaConfig: (c: typeof mockOllamaConfig) => { mockSetOllamaConfig(c); mockOllamaConfig = c; },
  isOllamaEnabled: () => mockOllamaConfig.enabled,
}));

jest.mock("@/lib/ollama/engine", () => ({
  testOllamaConnection: jest.fn().mockResolvedValue({ ok: true, models: ["llama3.1:8b", "mistral:7b"] }),
}));

beforeEach(() => {
  mockAgentEnabled = false;
  mockStoredKey = null;
  mockWebLLMEnabled = false;
  mockOllamaConfig = { endpoint: "http://localhost:11434", model: "llama3.1:8b", enabled: false };
  mockAddNotification.mockClear();
  mockSetOllamaConfig.mockClear();
});

describe("FeedSection — Filter Mode", () => {
  it("renders FilterModeSelector", () => {
    render(<FeedSection />);
    expect(screen.getByTestId("filter-mode-selector")).toBeInTheDocument();
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
    const { container } = render(<FeedSection />);
    // Status dots: bg-emerald-400 = enabled, bg-[var(--color-text-disabled)] = disabled
    // With agentEnabled=true and hasApiKey=true, 2 of 4 should be green
    const allDots = container.querySelectorAll(".bg-emerald-400");
    // At least the BYOK and D2A dots should be green (+ possibly the AI Scoring section dot)
    expect(allDots.length).toBeGreaterThanOrEqual(2);
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
    render(<FeedSection />);
    const saveBtn = screen.getByText("Save") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it("Clear key requires confirmation", () => {
    mockStoredKey = "sk-ant-api03-testkey";
    render(<FeedSection />);
    fireEvent.click(screen.getByText("Clear"));
    expect(screen.getByText("Remove key?")).toBeInTheDocument();
    expect(screen.getByText("Confirm")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
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

describe("FeedSection — API key save success path", () => {
  it("shows masked key and API Key Set after saving valid key", () => {
    render(<FeedSection />);
    const input = screen.getByPlaceholderText("sk-ant-...");
    fireEvent.change(input, { target: { value: "sk-ant-api03-validkey123456" } });
    fireEvent.click(screen.getByText("Save"));
    expect(screen.getByText("API Key Set")).toBeInTheDocument();
    expect(screen.getByText(/sk-ant-/)).toBeInTheDocument();
  });

  it("clears input after successful save", () => {
    render(<FeedSection />);
    const input = screen.getByPlaceholderText("sk-ant-...") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "sk-ant-api03-validkey123456" } });
    fireEvent.click(screen.getByText("Save"));
    // Input should be cleared (component switches to key display mode)
    expect(screen.queryByPlaceholderText("sk-ant-...")).toBeNull();
  });
});

describe("FeedSection — Clear key cancel", () => {
  it("cancels key removal on Cancel", () => {
    mockStoredKey = "sk-ant-api03-testkey";
    render(<FeedSection />);
    fireEvent.click(screen.getByText("Clear"));
    expect(screen.getByText("Remove key?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel"));
    // Should be back to normal state with Clear button
    expect(screen.getByText("Clear")).toBeInTheDocument();
    expect(screen.queryByText("Remove key?")).toBeNull();
  });
});

describe("FeedSection — WebLLM toggle", () => {
  it("enables WebLLM on toggle click", async () => {
    mockWebLLMEnabled = false;
    render(<FeedSection />);
    fireEvent.click(screen.getByTestId("aegis-settings-webllm-toggle"));
    await waitFor(() => {
      expect(mockAddNotification).toHaveBeenCalledWith("Browser AI enabled", "success");
    });
  });

  it("disables WebLLM on toggle click when enabled", async () => {
    mockWebLLMEnabled = true;
    render(<FeedSection />);
    fireEvent.click(screen.getByTestId("aegis-settings-webllm-toggle"));
    await waitFor(() => {
      expect(mockAddNotification).toHaveBeenCalledWith("Browser AI disabled", "success");
    });
  });
});

describe("FeedSection — Ollama toggle and interactions", () => {
  it("enables Ollama and shows connection test notification", async () => {
    render(<FeedSection />);
    fireEvent.click(screen.getByTestId("aegis-settings-ollama-toggle"));
    await waitFor(() => {
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.stringContaining("Local LLM enabled"),
        "success"
      );
    });
  });

  it("shows Enabled text after toggle", async () => {
    render(<FeedSection />);
    fireEvent.click(screen.getByTestId("aegis-settings-ollama-toggle"));
    await waitFor(() => {
      expect(screen.getAllByText("Enabled").length).toBeGreaterThan(0);
    });
  });

  it("shows endpoint and model inputs when enabled", async () => {
    mockOllamaConfig = { endpoint: "http://localhost:11434", model: "llama3.1:8b", enabled: true };
    render(<FeedSection />);
    expect(screen.getByDisplayValue("http://localhost:11434")).toBeInTheDocument();
    expect(screen.getByText("Test")).toBeInTheDocument();
    expect(screen.getByText("Endpoint")).toBeInTheDocument();
    expect(screen.getByText("Model")).toBeInTheDocument();
  });

  it("changes endpoint value", () => {
    mockOllamaConfig = { endpoint: "http://localhost:11434", model: "llama3.1:8b", enabled: true };
    render(<FeedSection />);
    const endpointInput = screen.getByDisplayValue("http://localhost:11434");
    fireEvent.change(endpointInput, { target: { value: "http://localhost:8080" } });
    expect(mockSetOllamaConfig).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "http://localhost:8080" })
    );
  });

  it("changes model value via text input", () => {
    mockOllamaConfig = { endpoint: "http://localhost:11434", model: "llama3.1:8b", enabled: true };
    render(<FeedSection />);
    const modelInput = screen.getByDisplayValue("llama3.1:8b");
    fireEvent.change(modelInput, { target: { value: "mistral:7b" } });
    expect(mockSetOllamaConfig).toHaveBeenCalledWith(
      expect.objectContaining({ model: "mistral:7b" })
    );
  });

  it("tests connection and shows success notification", async () => {
    mockOllamaConfig = { endpoint: "http://localhost:11434", model: "llama3.1:8b", enabled: true };
    render(<FeedSection />);
    fireEvent.click(screen.getByText("Test"));
    await waitFor(() => {
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.stringContaining("Connected"),
        "success"
      );
    });
  });

  it("disables Ollama on second toggle", async () => {
    mockOllamaConfig = { endpoint: "http://localhost:11434", model: "llama3.1:8b", enabled: true };
    render(<FeedSection />);
    fireEvent.click(screen.getByTestId("aegis-settings-ollama-toggle"));
    await waitFor(() => {
      expect(mockAddNotification).toHaveBeenCalledWith("Local LLM disabled", "success");
    });
  });
});

describe("FeedSection — Ollama connection failure", () => {
  it("shows error notification when Ollama connection fails", async () => {
    const { testOllamaConnection } = require("@/lib/ollama/engine");
    testOllamaConnection.mockResolvedValueOnce({ ok: false, models: [], error: "Connection refused" });

    render(<FeedSection />);
    fireEvent.click(screen.getByTestId("aegis-settings-ollama-toggle"));

    await waitFor(() => {
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.stringContaining("Cannot reach Ollama"),
        "error"
      );
    });
  });

  it("shows error notification when Test button connection fails", async () => {
    const { testOllamaConnection } = require("@/lib/ollama/engine");
    testOllamaConnection.mockResolvedValueOnce({ ok: false, models: [], error: "ECONNREFUSED" });

    mockOllamaConfig = { endpoint: "http://localhost:11434", model: "llama3.1:8b", enabled: true };
    render(<FeedSection />);
    fireEvent.click(screen.getByText("Test"));

    await waitFor(() => {
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.stringContaining("Connection failed"),
        "error"
      );
    });
  });

  it("shows Connected status after successful toggle", async () => {
    render(<FeedSection />);
    fireEvent.click(screen.getByTestId("aegis-settings-ollama-toggle"));

    await waitFor(() => {
      expect(screen.getByText(/Connected — using/)).toBeInTheDocument();
    });
  });
});

describe("FeedSection — WebGPU unavailable", () => {
  it("shows error when WebGPU is not usable on enable", async () => {
    const engine = require("@/lib/webllm/engine");
    engine.isWebGPUUsable = jest.fn().mockResolvedValueOnce(false);

    mockWebLLMEnabled = false;
    render(<FeedSection />);
    fireEvent.click(screen.getByTestId("aegis-settings-webllm-toggle"));

    await waitFor(() => {
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.stringContaining("WebGPU not available"),
        "error"
      );
    });
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
