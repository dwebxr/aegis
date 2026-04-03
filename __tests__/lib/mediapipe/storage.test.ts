/**
 * @jest-environment jsdom
 */
import {
  getMediaPipeConfig,
  setMediaPipeConfig,
  getSelectedMediaPipeModelId,
  isMediaPipeEnabled,
  setMediaPipeEnabled,
} from "@/lib/mediapipe/storage";
import { DEFAULT_MEDIAPIPE_CONFIG } from "@/lib/mediapipe/types";

const STORAGE_KEY = "aegis-mediapipe-config";

beforeEach(() => {
  localStorage.clear();
});

describe("getMediaPipeConfig", () => {
  it("returns defaults when no key exists", () => {
    expect(getMediaPipeConfig()).toEqual(DEFAULT_MEDIAPIPE_CONFIG);
  });

  it("parses stored config correctly", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: true, modelId: "gemma-4-e2b" }));
    expect(getMediaPipeConfig()).toEqual({ enabled: true, modelId: "gemma-4-e2b" });
  });

  it("falls back to defaults for invalid JSON", () => {
    localStorage.setItem(STORAGE_KEY, "not-json");
    expect(getMediaPipeConfig()).toEqual(DEFAULT_MEDIAPIPE_CONFIG);
  });

  it("falls back to default modelId for unknown model", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: true, modelId: "unknown-model" }));
    const config = getMediaPipeConfig();
    expect(config.enabled).toBe(true);
    expect(config.modelId).toBe("gemma-3-1b");
  });

  it("falls back to false for non-boolean enabled", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: "yes", modelId: "gemma-3-1b" }));
    expect(getMediaPipeConfig().enabled).toBe(false);
  });

  it("handles empty object", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({}));
    const config = getMediaPipeConfig();
    expect(config.enabled).toBe(false);
    expect(config.modelId).toBe("gemma-3-1b");
  });

  it("handles missing modelId field", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: true }));
    const config = getMediaPipeConfig();
    expect(config.enabled).toBe(true);
    expect(config.modelId).toBe("gemma-3-1b");
  });

  it("handles missing enabled field", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ modelId: "gemma-4-e2b" }));
    const config = getMediaPipeConfig();
    expect(config.enabled).toBe(false);
    expect(config.modelId).toBe("gemma-4-e2b");
  });

  it("handles numeric enabled field", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: 1, modelId: "gemma-3-1b" }));
    expect(getMediaPipeConfig().enabled).toBe(false);
  });

  it("handles null enabled field", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: null, modelId: "gemma-3-1b" }));
    expect(getMediaPipeConfig().enabled).toBe(false);
  });

  it("handles numeric modelId", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: false, modelId: 42 }));
    expect(getMediaPipeConfig().modelId).toBe("gemma-3-1b");
  });

  it("handles empty string modelId", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: false, modelId: "" }));
    expect(getMediaPipeConfig().modelId).toBe("gemma-3-1b");
  });

  it("returns defaults when localStorage is unavailable", () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { value: undefined, configurable: true });
    try {
      expect(getMediaPipeConfig()).toEqual(DEFAULT_MEDIAPIPE_CONFIG);
    } finally {
      Object.defineProperty(globalThis, "localStorage", { value: original, configurable: true });
    }
  });
});

describe("setMediaPipeConfig", () => {
  it("stores config as JSON", () => {
    setMediaPipeConfig({ enabled: true, modelId: "gemma-4-e2b" });
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toEqual({ enabled: true, modelId: "gemma-4-e2b" });
  });

  it("round-trips correctly", () => {
    const config = { enabled: true, modelId: "gemma-4-e2b" as const };
    setMediaPipeConfig(config);
    expect(getMediaPipeConfig()).toEqual(config);
  });

  it("overwrites existing config", () => {
    setMediaPipeConfig({ enabled: true, modelId: "gemma-3-1b" });
    setMediaPipeConfig({ enabled: false, modelId: "gemma-4-e2b" });
    expect(getMediaPipeConfig()).toEqual({ enabled: false, modelId: "gemma-4-e2b" });
  });

  it("is a no-op when localStorage is unavailable", () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", { value: undefined, configurable: true });
    try {
      // Should not throw
      setMediaPipeConfig({ enabled: true, modelId: "gemma-3-1b" });
    } finally {
      Object.defineProperty(globalThis, "localStorage", { value: original, configurable: true });
    }
    // Original storage unaffected
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe("getSelectedMediaPipeModelId", () => {
  it("returns default model when nothing stored", () => {
    expect(getSelectedMediaPipeModelId()).toBe("gemma-3-1b");
  });

  it("returns stored model", () => {
    setMediaPipeConfig({ enabled: true, modelId: "gemma-4-e2b" });
    expect(getSelectedMediaPipeModelId()).toBe("gemma-4-e2b");
  });

  it("returns default for corrupted storage", () => {
    localStorage.setItem(STORAGE_KEY, "{bad}}}");
    expect(getSelectedMediaPipeModelId()).toBe("gemma-3-1b");
  });
});

describe("isMediaPipeEnabled / setMediaPipeEnabled", () => {
  it("returns false by default", () => {
    expect(isMediaPipeEnabled()).toBe(false);
  });

  it("enables while preserving model selection", () => {
    setMediaPipeConfig({ enabled: false, modelId: "gemma-4-e2b" });
    setMediaPipeEnabled(true);
    const config = getMediaPipeConfig();
    expect(config.enabled).toBe(true);
    expect(config.modelId).toBe("gemma-4-e2b");
  });

  it("disables while preserving model selection", () => {
    setMediaPipeConfig({ enabled: true, modelId: "gemma-4-e2b" });
    setMediaPipeEnabled(false);
    const config = getMediaPipeConfig();
    expect(config.enabled).toBe(false);
    expect(config.modelId).toBe("gemma-4-e2b");
  });

  it("toggle cycle works correctly", () => {
    expect(isMediaPipeEnabled()).toBe(false);
    setMediaPipeEnabled(true);
    expect(isMediaPipeEnabled()).toBe(true);
    setMediaPipeEnabled(false);
    expect(isMediaPipeEnabled()).toBe(false);
  });

  it("repeated enables are idempotent", () => {
    setMediaPipeEnabled(true);
    setMediaPipeEnabled(true);
    expect(isMediaPipeEnabled()).toBe(true);
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(JSON.parse(raw!).enabled).toBe(true);
  });
});
