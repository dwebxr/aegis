/**
 * @jest-environment jsdom
 */

export {}; // ensure this file is treated as a module

const VALID_JSON_RESPONSE = JSON.stringify({
  vSignal: 8,
  cContext: 7,
  lSlop: 2,
  originality: 8,
  insight: 7,
  credibility: 9,
  composite: 7.5,
  verdict: "quality",
  reason: "Well-sourced analysis",
  topics: ["ai", "security"],
});

// Mock LlmInference instance
function makeMockInference(response: string) {
  return {
    generateResponse: jest.fn().mockResolvedValue(response),
    close: jest.fn(),
    isIdle: true,
  };
}

const mockCreateFromOptions = jest.fn();
const mockForGenAiTasks = jest.fn().mockResolvedValue({});

jest.mock("@mediapipe/tasks-genai", () => ({
  FilesetResolver: {
    forGenAiTasks: (...args: unknown[]) => mockForGenAiTasks(...args),
  },
  LlmInference: {
    createFromOptions: (...args: unknown[]) => mockCreateFromOptions(...args),
  },
}));

// Mock storage to control model selection
let mockModelId = "gemma-3-1b";
jest.mock("@/lib/mediapipe/storage", () => ({
  getSelectedMediaPipeModelId: () => mockModelId,
}));

beforeEach(() => {
  jest.resetModules();
  mockCreateFromOptions.mockReset();
  mockForGenAiTasks.mockReset().mockResolvedValue({});
  mockModelId = "gemma-3-1b";
  Object.defineProperty(navigator, "gpu", {
    value: { requestAdapter: jest.fn().mockResolvedValue({}) },
    configurable: true,
  });
});

afterEach(async () => {
  try {
    const { destroyInference } = require("@/lib/mediapipe/engine");
    await destroyInference();
  } catch {
    // ignore
  }
});

// ─── isWebGPUAvailable ───

describe("isWebGPUAvailable", () => {
  it("returns true when navigator.gpu exists", () => {
    const { isWebGPUAvailable } = require("@/lib/mediapipe/engine");
    expect(isWebGPUAvailable()).toBe(true);
  });

  it("returns false when navigator.gpu is absent", () => {
    Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true });
    delete (navigator as unknown as Record<string, unknown>)["gpu"];
    const { isWebGPUAvailable } = require("@/lib/mediapipe/engine");
    expect(isWebGPUAvailable()).toBe(false);
  });

  it("returns false when navigator is undefined (SSR)", () => {
    const origNav = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", { value: undefined, configurable: true });
    try {
      const { isWebGPUAvailable } = require("@/lib/mediapipe/engine");
      expect(isWebGPUAvailable()).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "navigator", { value: origNav, configurable: true });
    }
  });
});

// ─── isWebGPUUsable ───

describe("isWebGPUUsable", () => {
  it("returns true when adapter is available", async () => {
    const { isWebGPUUsable } = require("@/lib/mediapipe/engine");
    expect(await isWebGPUUsable()).toBe(true);
  });

  it("returns false when adapter is null", async () => {
    Object.defineProperty(navigator, "gpu", {
      value: { requestAdapter: jest.fn().mockResolvedValue(null) },
      configurable: true,
    });
    const { isWebGPUUsable } = require("@/lib/mediapipe/engine");
    expect(await isWebGPUUsable()).toBe(false);
  });

  it("returns false when navigator.gpu is missing", async () => {
    Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true });
    delete (navigator as unknown as Record<string, unknown>)["gpu"];
    const { isWebGPUUsable } = require("@/lib/mediapipe/engine");
    expect(await isWebGPUUsable()).toBe(false);
  });

  it("returns false when navigator.gpu exists but is null", async () => {
    // "gpu" in navigator is true, but navigator.gpu is null
    Object.defineProperty(navigator, "gpu", { value: null, configurable: true });
    const { isWebGPUUsable, onStatusChange } = require("@/lib/mediapipe/engine");
    let lastStatus: Record<string, unknown> = {};
    onStatusChange((s: Record<string, unknown>) => { lastStatus = s; });

    expect(await isWebGPUUsable()).toBe(false);
    expect(lastStatus.error).toBe("WebGPU not available");
  });

  it("emits available: true when usable", async () => {
    const { isWebGPUUsable, onStatusChange } = require("@/lib/mediapipe/engine");
    let lastStatus: Record<string, unknown> = {};
    onStatusChange((s: Record<string, unknown>) => { lastStatus = s; });

    await isWebGPUUsable();
    expect(lastStatus.available).toBe(true);
  });

  it("does not emit available when not usable", async () => {
    Object.defineProperty(navigator, "gpu", {
      value: { requestAdapter: jest.fn().mockResolvedValue(null) },
      configurable: true,
    });
    const { isWebGPUUsable, onStatusChange } = require("@/lib/mediapipe/engine");
    let lastStatus: Record<string, unknown> = {};
    onStatusChange((s: Record<string, unknown>) => { lastStatus = s; });

    await isWebGPUUsable();
    expect(lastStatus.available).toBe(false);
  });

});

// ─── getOrCreateInference ───

describe("getOrCreateInference", () => {
  it("creates inference with Gemma 3 1B by default", async () => {
    const mockInf = makeMockInference(VALID_JSON_RESPONSE);
    mockCreateFromOptions.mockResolvedValue(mockInf);

    const { getOrCreateInference } = require("@/lib/mediapipe/engine");
    const inf = await getOrCreateInference();
    expect(inf).toBe(mockInf);
    expect(mockCreateFromOptions).toHaveBeenCalledTimes(1);

    const opts = mockCreateFromOptions.mock.calls[0][1];
    expect(opts.baseOptions.modelAssetPath).toContain("gemma3-1b-it-int4-web.task");
    expect(opts.maxTokens).toBe(1000);
    expect(opts.temperature).toBe(0.3);
  });

  it("creates inference with Gemma 4 E2B when selected", async () => {
    mockModelId = "gemma-4-e2b";
    const mockInf = makeMockInference(VALID_JSON_RESPONSE);
    mockCreateFromOptions.mockResolvedValue(mockInf);

    const { getOrCreateInference } = require("@/lib/mediapipe/engine");
    await getOrCreateInference();

    const opts = mockCreateFromOptions.mock.calls[0][1];
    expect(opts.baseOptions.modelAssetPath).toContain("gemma-4-E2B-it-web.task");
  });

  it("reuses existing inference on second call", async () => {
    const mockInf = makeMockInference(VALID_JSON_RESPONSE);
    mockCreateFromOptions.mockResolvedValue(mockInf);

    const { getOrCreateInference } = require("@/lib/mediapipe/engine");
    const first = await getOrCreateInference();
    const second = await getOrCreateInference();
    expect(first).toBe(second);
    expect(mockCreateFromOptions).toHaveBeenCalledTimes(1);
  });

  it("concurrent callers share same promise (deduplication)", async () => {
    let resolveCreate!: (v: unknown) => void;
    const createPromise = new Promise(r => { resolveCreate = r; });
    mockCreateFromOptions.mockReturnValue(createPromise);

    const { getOrCreateInference } = require("@/lib/mediapipe/engine");

    // Both calls start before the first resolves
    const p1 = getOrCreateInference();
    const p2 = getOrCreateInference();

    const mockInf = makeMockInference(VALID_JSON_RESPONSE);
    resolveCreate(mockInf);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
    expect(mockCreateFromOptions).toHaveBeenCalledTimes(1);
  });

  it("throws when WebGPU is not available", async () => {
    Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true });
    delete (navigator as unknown as Record<string, unknown>)["gpu"];

    const { getOrCreateInference } = require("@/lib/mediapipe/engine");
    await expect(getOrCreateInference()).rejects.toThrow("WebGPU not available");
  });

  it("emits correct status on WebGPU unavailable", async () => {
    Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true });
    delete (navigator as unknown as Record<string, unknown>)["gpu"];

    const { getOrCreateInference, onStatusChange } = require("@/lib/mediapipe/engine");
    let lastStatus: Record<string, unknown> = {};
    onStatusChange((s: Record<string, unknown>) => { lastStatus = s; });

    await getOrCreateInference().catch(() => {});
    expect(lastStatus.available).toBe(false);
    expect(lastStatus.error).toContain("WebGPU not available");
  });

  it("handles Array buffer allocation failed with actionable error", async () => {
    mockModelId = "gemma-4-e2b";
    mockCreateFromOptions.mockRejectedValue(new Error("Array buffer allocation failed"));

    const { getOrCreateInference, onStatusChange } = require("@/lib/mediapipe/engine");

    let lastStatus: Record<string, unknown> = {};
    onStatusChange((s: Record<string, unknown>) => { lastStatus = s; });

    await expect(getOrCreateInference()).rejects.toThrow("Array buffer allocation failed");
    expect(lastStatus.error).toContain("Memory error");
    expect(lastStatus.error).toContain("Gemma 3 1B");
    expect(lastStatus.loading).toBe(false);
    expect(lastStatus.modelId).toBe("gemma-4-e2b");
  });

  it("handles out of memory with actionable error", async () => {
    mockModelId = "gemma-4-e2b";
    mockCreateFromOptions.mockRejectedValue(new Error("WebGPU out of memory"));

    const { getOrCreateInference, onStatusChange } = require("@/lib/mediapipe/engine");

    let lastStatus: Record<string, unknown> = {};
    onStatusChange((s: Record<string, unknown>) => { lastStatus = s; });

    await expect(getOrCreateInference()).rejects.toThrow("out of memory");
    expect(lastStatus.error).toContain("Memory error");
  });

  it("handles Event object errors (Safari WebGPU) with useful message", async () => {
    // Safari throws Event objects instead of Error for WebGPU failures
    const eventError = { type: "error", message: undefined };
    mockCreateFromOptions.mockRejectedValue(eventError);

    const { getOrCreateInference, onStatusChange } = require("@/lib/mediapipe/engine");
    let lastStatus: Record<string, unknown> = {};
    onStatusChange((s: Record<string, unknown>) => { lastStatus = s; });

    await expect(getOrCreateInference()).rejects.toBe(eventError);
    expect(lastStatus.error).toContain("WebGPU/wasm error");
    expect(lastStatus.error).not.toBe("[object Object]");
  });

  it("shows Safari-specific message for Event errors on Safari UA", async () => {
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      configurable: true,
    });
    const eventError = { type: "error" };
    mockCreateFromOptions.mockRejectedValue(eventError);

    const { getOrCreateInference, onStatusChange } = require("@/lib/mediapipe/engine");
    let lastStatus: Record<string, unknown> = {};
    onStatusChange((s: Record<string, unknown>) => { lastStatus = s; });

    await expect(getOrCreateInference()).rejects.toBe(eventError);
    expect(lastStatus.error).toContain("Safari");
    expect(lastStatus.error).toContain("iOS 26");
  });

  it("emits generic error for non-OOM failures", async () => {
    mockCreateFromOptions.mockRejectedValue(new Error("Model download failed: 404"));

    const { getOrCreateInference, onStatusChange } = require("@/lib/mediapipe/engine");

    let lastStatus: Record<string, unknown> = {};
    onStatusChange((s: Record<string, unknown>) => { lastStatus = s; });

    await expect(getOrCreateInference()).rejects.toThrow("Model download failed: 404");
    expect(lastStatus.error).toBe("Model download failed: 404");
    expect(lastStatus.error).not.toContain("Memory error");
    expect(lastStatus.loading).toBe(false);
    expect(lastStatus.modelId).toBe("gemma-3-1b");
  });

  it("handles string thrown as error", async () => {
    mockCreateFromOptions.mockRejectedValue("raw string error");

    const { getOrCreateInference, onStatusChange } = require("@/lib/mediapipe/engine");
    let lastStatus: Record<string, unknown> = {};
    onStatusChange((s: Record<string, unknown>) => { lastStatus = s; });

    await expect(getOrCreateInference()).rejects.toBe("raw string error");
    expect(lastStatus.error).toBe("raw string error");
  });

  it("allows retry after failure (inferencePromise is cleared)", async () => {
    mockCreateFromOptions.mockRejectedValueOnce(new Error("transient failure"));
    const mockInf = makeMockInference(VALID_JSON_RESPONSE);
    mockCreateFromOptions.mockResolvedValueOnce(mockInf);

    const { getOrCreateInference } = require("@/lib/mediapipe/engine");

    await expect(getOrCreateInference()).rejects.toThrow("transient failure");
    const inf = await getOrCreateInference();
    expect(inf).toBe(mockInf);
    expect(mockCreateFromOptions).toHaveBeenCalledTimes(2);
  });

  it("emits loading status transitions on success", async () => {
    const mockInf = makeMockInference(VALID_JSON_RESPONSE);
    mockCreateFromOptions.mockResolvedValue(mockInf);

    const { getOrCreateInference, onStatusChange } = require("@/lib/mediapipe/engine");

    const statuses: Record<string, unknown>[] = [];
    onStatusChange((s: Record<string, unknown>) => { statuses.push({ ...s }); });

    await getOrCreateInference();

    // Should have: initial → available → loading → loaded
    const loadingStatus = statuses.find(s => s.loading === true);
    expect(loadingStatus).toBeDefined();
    expect(loadingStatus!.modelId).toBe("gemma-3-1b");

    const loadedStatus = statuses[statuses.length - 1];
    expect(loadedStatus.loaded).toBe(true);
    expect(loadedStatus.loading).toBe(false);
    expect(loadedStatus.modelId).toBe("gemma-3-1b");
  });

  it("passes WasmFileset from FilesetResolver to createFromOptions", async () => {
    const wasmFileset = { wasmBinaryPath: "/fake/wasm" };
    mockForGenAiTasks.mockResolvedValue(wasmFileset);
    const mockInf = makeMockInference(VALID_JSON_RESPONSE);
    mockCreateFromOptions.mockResolvedValue(mockInf);

    const { getOrCreateInference } = require("@/lib/mediapipe/engine");
    await getOrCreateInference();

    expect(mockForGenAiTasks).toHaveBeenCalledWith(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@0.10.27/wasm",
    );
    expect(mockCreateFromOptions.mock.calls[0][0]).toBe(wasmFileset);
  });
});

// ─── scoreWithMediaPipe ───

describe("scoreWithMediaPipe", () => {
  it("returns parsed score result with all fields", async () => {
    const mockInf = makeMockInference(VALID_JSON_RESPONSE);
    mockCreateFromOptions.mockResolvedValue(mockInf);

    const { scoreWithMediaPipe } = require("@/lib/mediapipe/engine");
    const result = await scoreWithMediaPipe("Some content text", ["ai"]);

    expect(result.vSignal).toBe(8);
    expect(result.cContext).toBe(7);
    expect(result.lSlop).toBe(2);
    expect(result.originality).toBe(8);
    expect(result.insight).toBe(7);
    expect(result.credibility).toBe(9);
    expect(result.composite).toBe(7.5);
    expect(result.verdict).toBe("quality");
    expect(result.reason).toBe("Well-sourced analysis");
    expect(result.topics).toEqual(["ai", "security"]);
  });

  it("passes user topics to the scoring prompt", async () => {
    const mockInf = makeMockInference(VALID_JSON_RESPONSE);
    mockCreateFromOptions.mockResolvedValue(mockInf);

    const { scoreWithMediaPipe } = require("@/lib/mediapipe/engine");
    await scoreWithMediaPipe("text", ["crypto", "defi"]);

    const promptArg = mockInf.generateResponse.mock.calls[0][0];
    expect(promptArg).toContain("crypto");
    expect(promptArg).toContain("defi");
  });

  it("passes empty topics gracefully", async () => {
    const mockInf = makeMockInference(VALID_JSON_RESPONSE);
    mockCreateFromOptions.mockResolvedValue(mockInf);

    const { scoreWithMediaPipe } = require("@/lib/mediapipe/engine");
    await scoreWithMediaPipe("text", []);

    const promptArg = mockInf.generateResponse.mock.calls[0][0];
    expect(promptArg).toContain("general"); // fallback in buildScoringPrompt
  });

  it("handles JSON wrapped in markdown code fence", async () => {
    const fencedResponse = "```json\n" + VALID_JSON_RESPONSE + "\n```";
    const mockInf = makeMockInference(fencedResponse);
    mockCreateFromOptions.mockResolvedValue(mockInf);

    const { scoreWithMediaPipe } = require("@/lib/mediapipe/engine");
    const result = await scoreWithMediaPipe("text", []);

    expect(result.vSignal).toBe(8);
    expect(result.verdict).toBe("quality");
  });

  it("handles JSON with leading text", async () => {
    const messyResponse = "Here is my analysis:\n" + VALID_JSON_RESPONSE;
    const mockInf = makeMockInference(messyResponse);
    mockCreateFromOptions.mockResolvedValue(mockInf);

    const { scoreWithMediaPipe } = require("@/lib/mediapipe/engine");
    const result = await scoreWithMediaPipe("text", []);
    expect(result.verdict).toBe("quality");
  });

  it("throws when response has no JSON at all", async () => {
    const mockInf = makeMockInference("I cannot score this content.");
    mockCreateFromOptions.mockResolvedValue(mockInf);

    const { scoreWithMediaPipe } = require("@/lib/mediapipe/engine");
    await expect(scoreWithMediaPipe("text", [])).rejects.toThrow("No JSON");
  });

  it("throws when response is empty string", async () => {
    const mockInf = makeMockInference("");
    mockCreateFromOptions.mockResolvedValue(mockInf);

    const { scoreWithMediaPipe } = require("@/lib/mediapipe/engine");
    await expect(scoreWithMediaPipe("text", [])).rejects.toThrow("No JSON");
  });

  it("handles slop verdict correctly", async () => {
    const slopResponse = JSON.stringify({
      vSignal: 2, cContext: 3, lSlop: 8,
      originality: 2, insight: 1, credibility: 3,
      composite: 1.5, verdict: "slop",
      reason: "Clickbait rehash", topics: ["gossip"],
    });
    const mockInf = makeMockInference(slopResponse);
    mockCreateFromOptions.mockResolvedValue(mockInf);

    const { scoreWithMediaPipe } = require("@/lib/mediapipe/engine");
    const result = await scoreWithMediaPipe("clickbait content", []);
    expect(result.verdict).toBe("slop");
    expect(result.lSlop).toBe(8);
    expect(result.composite).toBe(1.5);
  });

  it("clamps out-of-range scores to 0-10", async () => {
    const outOfRange = JSON.stringify({
      vSignal: 15, cContext: -3, lSlop: 2,
      originality: 8, insight: 7, credibility: 9,
      composite: 12, verdict: "quality",
      reason: "test", topics: [],
    });
    const mockInf = makeMockInference(outOfRange);
    mockCreateFromOptions.mockResolvedValue(mockInf);

    const { scoreWithMediaPipe } = require("@/lib/mediapipe/engine");
    const result = await scoreWithMediaPipe("text", []);
    expect(result.vSignal).toBe(10); // clamped from 15
    expect(result.cContext).toBe(0);  // clamped from -3
    expect(result.composite).toBe(10); // clamped from 12
  });
});

// ─── destroyInference ───

describe("destroyInference", () => {
  it("closes inference and resets state", async () => {
    const mockInf = makeMockInference(VALID_JSON_RESPONSE);
    mockCreateFromOptions.mockResolvedValue(mockInf);

    const { getOrCreateInference, destroyInference, isMediaPipeLoaded } =
      require("@/lib/mediapipe/engine");

    await getOrCreateInference();
    expect(isMediaPipeLoaded()).toBe(true);

    await destroyInference();
    expect(isMediaPipeLoaded()).toBe(false);
    expect(mockInf.close).toHaveBeenCalledTimes(1);
  });

  it("is safe to call when no inference exists", async () => {
    const { destroyInference, isMediaPipeLoaded } = require("@/lib/mediapipe/engine");
    await destroyInference(); // should not throw
    expect(isMediaPipeLoaded()).toBe(false);
  });

  it("is safe to call multiple times", async () => {
    const mockInf = makeMockInference(VALID_JSON_RESPONSE);
    mockCreateFromOptions.mockResolvedValue(mockInf);

    const { getOrCreateInference, destroyInference } = require("@/lib/mediapipe/engine");
    await getOrCreateInference();

    await destroyInference();
    await destroyInference();
    // close only called once (second destroy finds null inference)
    expect(mockInf.close).toHaveBeenCalledTimes(1);
  });

  it("emits reset status", async () => {
    const mockInf = makeMockInference(VALID_JSON_RESPONSE);
    mockCreateFromOptions.mockResolvedValue(mockInf);

    const { getOrCreateInference, destroyInference, onStatusChange } =
      require("@/lib/mediapipe/engine");

    await getOrCreateInference();

    let lastStatus: Record<string, unknown> = {};
    onStatusChange((s: Record<string, unknown>) => { lastStatus = s; });

    await destroyInference();
    expect(lastStatus.loaded).toBe(false);
    expect(lastStatus.loading).toBe(false);
    expect(lastStatus.modelId).toBeUndefined();
    expect(lastStatus.error).toBeUndefined();
  });

  it("allows new engine creation after destroy", async () => {
    const mockInf1 = makeMockInference(VALID_JSON_RESPONSE);
    const mockInf2 = makeMockInference(VALID_JSON_RESPONSE);
    mockCreateFromOptions.mockResolvedValueOnce(mockInf1).mockResolvedValueOnce(mockInf2);

    const { getOrCreateInference, destroyInference } = require("@/lib/mediapipe/engine");

    const first = await getOrCreateInference();
    await destroyInference();
    const second = await getOrCreateInference();

    expect(first).toBe(mockInf1);
    expect(second).toBe(mockInf2);
    expect(first).not.toBe(second);
  });
});

// ─── model switching ───

describe("model switching", () => {
  it("destroys and recreates when model changes", async () => {
    const mockInf1 = makeMockInference(VALID_JSON_RESPONSE);
    const mockInf2 = makeMockInference(VALID_JSON_RESPONSE);
    mockCreateFromOptions.mockResolvedValueOnce(mockInf1).mockResolvedValueOnce(mockInf2);

    const { getOrCreateInference } = require("@/lib/mediapipe/engine");

    mockModelId = "gemma-3-1b";
    const first = await getOrCreateInference();
    expect(first).toBe(mockInf1);

    mockModelId = "gemma-4-e2b";
    const second = await getOrCreateInference();
    expect(second).toBe(mockInf2);
    expect(mockInf1.close).toHaveBeenCalledTimes(1);
    expect(mockCreateFromOptions).toHaveBeenCalledTimes(2);
  });

  it("does not destroy when model stays the same", async () => {
    const mockInf = makeMockInference(VALID_JSON_RESPONSE);
    mockCreateFromOptions.mockResolvedValue(mockInf);

    const { getOrCreateInference } = require("@/lib/mediapipe/engine");

    mockModelId = "gemma-3-1b";
    await getOrCreateInference();
    await getOrCreateInference();

    expect(mockInf.close).not.toHaveBeenCalled();
    expect(mockCreateFromOptions).toHaveBeenCalledTimes(1);
  });

  it("uses correct model URL after switch", async () => {
    const mockInf1 = makeMockInference(VALID_JSON_RESPONSE);
    const mockInf2 = makeMockInference(VALID_JSON_RESPONSE);
    mockCreateFromOptions.mockResolvedValueOnce(mockInf1).mockResolvedValueOnce(mockInf2);

    const { getOrCreateInference } = require("@/lib/mediapipe/engine");

    mockModelId = "gemma-3-1b";
    await getOrCreateInference();
    const firstUrl = mockCreateFromOptions.mock.calls[0][1].baseOptions.modelAssetPath;
    expect(firstUrl).toContain("Gemma3-1B-IT");

    mockModelId = "gemma-4-e2b";
    await getOrCreateInference();
    const secondUrl = mockCreateFromOptions.mock.calls[1][1].baseOptions.modelAssetPath;
    expect(secondUrl).toContain("gemma-4-E2B");
  });
});

// ─── isMediaPipeLoaded ───

describe("isMediaPipeLoaded", () => {
  it("returns false initially", () => {
    const { isMediaPipeLoaded } = require("@/lib/mediapipe/engine");
    expect(isMediaPipeLoaded()).toBe(false);
  });

  it("returns true after engine creation", async () => {
    const mockInf = makeMockInference(VALID_JSON_RESPONSE);
    mockCreateFromOptions.mockResolvedValue(mockInf);

    const { getOrCreateInference, isMediaPipeLoaded } = require("@/lib/mediapipe/engine");
    await getOrCreateInference();
    expect(isMediaPipeLoaded()).toBe(true);
  });

  it("returns false after creation failure", async () => {
    mockCreateFromOptions.mockRejectedValue(new Error("fail"));

    const { getOrCreateInference, isMediaPipeLoaded } = require("@/lib/mediapipe/engine");
    await getOrCreateInference().catch(() => {});
    expect(isMediaPipeLoaded()).toBe(false);
  });
});

// ─── onStatusChange ───

describe("onStatusChange", () => {
  it("fires listener with current status on subscribe", () => {
    const { onStatusChange } = require("@/lib/mediapipe/engine");
    let received: Record<string, unknown> | null = null;
    onStatusChange((s: Record<string, unknown>) => { received = s; });

    expect(received).not.toBeNull();
    expect(received!.available).toBe(false);
    expect(received!.loaded).toBe(false);
  });

  it("returns unsubscribe function that stops updates", async () => {
    const mockInf = makeMockInference(VALID_JSON_RESPONSE);
    mockCreateFromOptions.mockResolvedValue(mockInf);

    const { getOrCreateInference, onStatusChange } = require("@/lib/mediapipe/engine");

    let callCount = 0;
    const unsub = onStatusChange(() => { callCount++; });
    const countAfterSub = callCount; // includes initial fire

    unsub();

    await getOrCreateInference(); // should NOT trigger our listener
    expect(callCount).toBe(countAfterSub);
  });
});
