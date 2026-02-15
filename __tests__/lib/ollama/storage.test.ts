/**
 * @jest-environment jsdom
 */
import { getOllamaConfig, setOllamaConfig, isOllamaEnabled } from "@/lib/ollama/storage";
import { DEFAULT_OLLAMA_CONFIG } from "@/lib/ollama/types";

describe("ollama/storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("getOllamaConfig", () => {
    it("returns defaults when nothing is stored", () => {
      const config = getOllamaConfig();
      expect(config).toEqual(DEFAULT_OLLAMA_CONFIG);
    });

    it("returns defaults for corrupted data", () => {
      localStorage.setItem("aegis-ollama-config", "not-json");
      expect(getOllamaConfig()).toEqual(DEFAULT_OLLAMA_CONFIG);
    });

    it("fills missing fields with defaults", () => {
      localStorage.setItem("aegis-ollama-config", JSON.stringify({ enabled: true }));
      const config = getOllamaConfig();
      expect(config.enabled).toBe(true);
      expect(config.endpoint).toBe(DEFAULT_OLLAMA_CONFIG.endpoint);
      expect(config.model).toBe(DEFAULT_OLLAMA_CONFIG.model);
    });
  });

  describe("setOllamaConfig", () => {
    it("saves and loads config roundtrip", () => {
      const custom = { enabled: true, endpoint: "http://myserver:11434", model: "gemma2" };
      setOllamaConfig(custom);
      const loaded = getOllamaConfig();
      expect(loaded).toEqual(custom);
    });
  });

  describe("isOllamaEnabled", () => {
    it("returns false by default", () => {
      expect(isOllamaEnabled()).toBe(false);
    });

    it("returns true when enabled", () => {
      setOllamaConfig({ ...DEFAULT_OLLAMA_CONFIG, enabled: true });
      expect(isOllamaEnabled()).toBe(true);
    });

    it("returns false when disabled", () => {
      setOllamaConfig({ ...DEFAULT_OLLAMA_CONFIG, enabled: false });
      expect(isOllamaEnabled()).toBe(false);
    });
  });
});
