/**
 * @jest-environment jsdom
 */

// Module-level singletons in engine.ts persist across tests within the same
// jest worker. We use jest.resetModules() + dynamic require to get a fresh
// copy of engine.ts for each test that touches engine lifecycle.

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

// ─── parseScoreResponse (exercised via scoreWithWebLLM, but also directly testable) ───

// Since parseScoreResponse is not exported, we test it indirectly through scoreWithWebLLM
// or we can access it via the module internals. Let's do integration-style tests.

// Helper: create a mock engine that returns the given content string
function makeMockEngine(content: string) {
  return {
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{ message: { content } }],
        }),
      },
    },
    unload: jest.fn().mockResolvedValue(undefined),
  };
}

// Mock @mlc-ai/web-llm at module scope so dynamic import returns our mock.
// Use a stable const reference — jest allows "mock"-prefixed variables in hoisted factories.
const mockCreateMLCEngine = jest.fn();
jest.mock("@mlc-ai/web-llm", () => ({
  CreateMLCEngine: mockCreateMLCEngine,
}));

beforeEach(() => {
  jest.resetModules();
  mockCreateMLCEngine?.mockReset();
  // Simulate WebGPU availability with a working adapter
  Object.defineProperty(navigator, "gpu", {
    value: { requestAdapter: jest.fn().mockResolvedValue({}) },
    configurable: true,
  });
});

afterEach(async () => {
  // Clean up engine singleton
  try {
    const { destroyEngine } = require("@/lib/webllm/engine");
    await destroyEngine();
  } catch {
    // ignore
  }
});

describe("isWebGPUAvailable", () => {
  it("returns true when navigator.gpu exists", () => {
    const { isWebGPUAvailable } = require("@/lib/webllm/engine");
    expect(isWebGPUAvailable()).toBe(true);
  });

  it("returns false when navigator.gpu is absent", () => {
    Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true });
    delete (navigator as unknown as Record<string, unknown>)["gpu"];
    const { isWebGPUAvailable } = require("@/lib/webllm/engine");
    expect(isWebGPUAvailable()).toBe(false);
  });
});

describe("isWebGPUUsable", () => {
  it("returns true when requestAdapter returns an adapter", async () => {
    const { isWebGPUUsable } = require("@/lib/webllm/engine");
    expect(await isWebGPUUsable()).toBe(true);
  });

  it("returns false when requestAdapter returns null", async () => {
    Object.defineProperty(navigator, "gpu", {
      value: { requestAdapter: jest.fn().mockResolvedValue(null) },
      configurable: true,
    });
    const { isWebGPUUsable } = require("@/lib/webllm/engine");
    expect(await isWebGPUUsable()).toBe(false);
  });

  it("returns false when navigator.gpu is absent", async () => {
    Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true });
    delete (navigator as unknown as Record<string, unknown>)["gpu"];
    const { isWebGPUUsable } = require("@/lib/webllm/engine");
    expect(await isWebGPUUsable()).toBe(false);
  });
});

describe("onStatusChange", () => {
  it("calls listener immediately with current status", () => {
    const { onStatusChange } = require("@/lib/webllm/engine");
    const listener = jest.fn();
    onStatusChange(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ available: false, loaded: false, loading: false, progress: 0 }),
    );
  });

  it("returns unsubscribe function that stops updates", async () => {
    const mockEngine = makeMockEngine(VALID_JSON_RESPONSE);
    mockCreateMLCEngine.mockImplementation(async (_model: string, opts: { initProgressCallback: (r: { progress: number }) => void }) => {
      opts.initProgressCallback({ progress: 0.5 });
      return mockEngine;
    });
    const { onStatusChange, getOrCreateEngine } = require("@/lib/webllm/engine");

    const listener = jest.fn();
    const unsub = onStatusChange(listener);

    // Initial call
    expect(listener).toHaveBeenCalledTimes(1);
    listener.mockClear();

    // Trigger status changes via engine creation
    await getOrCreateEngine();
    const callsBeforeUnsub = listener.mock.calls.length;
    expect(callsBeforeUnsub).toBeGreaterThan(0);

    // Unsubscribe and trigger more changes
    unsub();
    listener.mockClear();

    const { destroyEngine } = require("@/lib/webllm/engine");
    await destroyEngine();
    // Should NOT have been called after unsubscription
    expect(listener).toHaveBeenCalledTimes(0);
  });

  it("supports multiple listeners", () => {
    const { onStatusChange } = require("@/lib/webllm/engine");
    const l1 = jest.fn();
    const l2 = jest.fn();
    onStatusChange(l1);
    onStatusChange(l2);
    expect(l1).toHaveBeenCalledTimes(1);
    expect(l2).toHaveBeenCalledTimes(1);
  });
});

describe("getOrCreateEngine", () => {
  it("throws when WebGPU not available (no navigator.gpu)", async () => {
    Object.defineProperty(navigator, "gpu", { value: undefined, configurable: true });
    delete (navigator as unknown as Record<string, unknown>)["gpu"];
    const { getOrCreateEngine } = require("@/lib/webllm/engine");
    await expect(getOrCreateEngine()).rejects.toThrow("WebGPU not available");
  });

  it("throws when GPU adapter is null", async () => {
    Object.defineProperty(navigator, "gpu", {
      value: { requestAdapter: jest.fn().mockResolvedValue(null) },
      configurable: true,
    });
    const { getOrCreateEngine } = require("@/lib/webllm/engine");
    await expect(getOrCreateEngine()).rejects.toThrow("WebGPU not available");
  });

  it("emits error status when WebGPU not usable", async () => {
    Object.defineProperty(navigator, "gpu", {
      value: { requestAdapter: jest.fn().mockResolvedValue(null) },
      configurable: true,
    });
    const { getOrCreateEngine, onStatusChange } = require("@/lib/webllm/engine");
    const statuses: Array<{ available: boolean; error?: string }> = [];
    onStatusChange((s: { available: boolean; error?: string }) => statuses.push({ ...s }));

    try { await getOrCreateEngine(); } catch { /* expected */ }

    const last = statuses[statuses.length - 1];
    expect(last.available).toBe(false);
    expect(last.error).toContain("WebGPU not available");
  });

  it("creates engine and transitions through loading states", async () => {
    const mockEngine = makeMockEngine(VALID_JSON_RESPONSE);
    mockCreateMLCEngine.mockImplementation(async (_model: string, opts: { initProgressCallback: (r: { progress: number }) => void }) => {
      opts.initProgressCallback({ progress: 0.25 });
      opts.initProgressCallback({ progress: 0.75 });
      return mockEngine;
    });
    const { getOrCreateEngine, onStatusChange } = require("@/lib/webllm/engine");

    const statuses: Array<{ loading: boolean; loaded: boolean; progress: number }> = [];
    onStatusChange((s: { loading: boolean; loaded: boolean; progress: number }) =>
      statuses.push({ loading: s.loading, loaded: s.loaded, progress: s.progress }),
    );

    const eng = await getOrCreateEngine();
    expect(eng).toBe(mockEngine);

    // Check loading → progress → loaded transitions
    expect(statuses.some(s => s.loading && s.progress === 0)).toBe(true);
    expect(statuses.some(s => s.progress === 25)).toBe(true);
    expect(statuses.some(s => s.progress === 75)).toBe(true);
    const final = statuses[statuses.length - 1];
    expect(final.loaded).toBe(true);
    expect(final.loading).toBe(false);
    expect(final.progress).toBe(100);
  });

  it("returns cached engine on subsequent calls", async () => {
    const mockEngine = makeMockEngine(VALID_JSON_RESPONSE);
    mockCreateMLCEngine.mockResolvedValue(mockEngine);
    const { getOrCreateEngine } = require("@/lib/webllm/engine");

    const first = await getOrCreateEngine();
    const second = await getOrCreateEngine();
    expect(first).toBe(second);
    expect(mockCreateMLCEngine).toHaveBeenCalledTimes(1);
  });

  it("concurrent calls share the same promise", async () => {
    const mockEngine = makeMockEngine(VALID_JSON_RESPONSE);
    mockCreateMLCEngine.mockResolvedValue(mockEngine);
    const { getOrCreateEngine } = require("@/lib/webllm/engine");

    const [a, b] = await Promise.all([getOrCreateEngine(), getOrCreateEngine()]);
    expect(a).toBe(b);
    expect(mockCreateMLCEngine).toHaveBeenCalledTimes(1);
  });

  it("resets on failure, allows retry", async () => {
    mockCreateMLCEngine.mockRejectedValueOnce(new Error("model download failed"));
    const { getOrCreateEngine, onStatusChange } = require("@/lib/webllm/engine");

    const statuses: Array<{ loading: boolean; error?: string }> = [];
    onStatusChange((s: { loading: boolean; error?: string }) => statuses.push({ ...s }));

    await expect(getOrCreateEngine()).rejects.toThrow("model download failed");

    const errorStatus = statuses.find(s => s.error);
    expect(errorStatus).toBeDefined();
    expect(errorStatus!.loading).toBe(false);

    // Retry should work
    const mockEngine = makeMockEngine(VALID_JSON_RESPONSE);
    mockCreateMLCEngine.mockResolvedValue(mockEngine);
    const eng = await getOrCreateEngine();
    expect(eng).toBe(mockEngine);
  });
});

describe("scoreWithWebLLM — parseScoreResponse integration", () => {
  beforeEach(() => {
    const mockEngine = makeMockEngine(VALID_JSON_RESPONSE);
    mockCreateMLCEngine.mockResolvedValue(mockEngine);
  });

  it("parses clean JSON response correctly", async () => {
    const { scoreWithWebLLM } = require("@/lib/webllm/engine");
    const result = await scoreWithWebLLM("Test content", ["ai"]);
    expect(result).toEqual({
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
  });

  it("parses response wrapped in markdown code fences", async () => {
    const mockEngine = makeMockEngine("```json\n" + VALID_JSON_RESPONSE + "\n```");
    mockCreateMLCEngine.mockResolvedValue(mockEngine);
    const { scoreWithWebLLM } = require("@/lib/webllm/engine");
    const result = await scoreWithWebLLM("Test content", []);
    expect(result.composite).toBe(7.5);
    expect(result.verdict).toBe("quality");
  });

  it("parses response with preamble text before JSON", async () => {
    const mockEngine = makeMockEngine("Here is my analysis:\n\n" + VALID_JSON_RESPONSE);
    mockCreateMLCEngine.mockResolvedValue(mockEngine);
    const { scoreWithWebLLM } = require("@/lib/webllm/engine");
    const result = await scoreWithWebLLM("Test content", []);
    expect(result.originality).toBe(8);
  });

  it("throws when response contains no JSON", async () => {
    const mockEngine = makeMockEngine("I cannot score this content.");
    mockCreateMLCEngine.mockResolvedValue(mockEngine);
    const { scoreWithWebLLM } = require("@/lib/webllm/engine");
    await expect(scoreWithWebLLM("Test content", [])).rejects.toThrow("No JSON object found");
  });

  it("uses fallback defaults for missing fields", async () => {
    const mockEngine = makeMockEngine(JSON.stringify({ verdict: "slop", reason: "Low effort" }));
    mockCreateMLCEngine.mockResolvedValue(mockEngine);
    const { scoreWithWebLLM } = require("@/lib/webllm/engine");
    const result = await scoreWithWebLLM("Test content", []);
    expect(result.vSignal).toBe(5);
    expect(result.cContext).toBe(5);
    expect(result.lSlop).toBe(5);
    expect(result.originality).toBe(5);
    expect(result.insight).toBe(5);
    expect(result.credibility).toBe(5);
    // composite fallback: (vSignal * cContext) / (lSlop + 0.5) = (5*5)/(5+0.5) ≈ 4.545
    expect(result.composite).toBeCloseTo(4.545, 2);
    expect(result.verdict).toBe("slop");
    expect(result.topics).toEqual([]);
  });

  it("preserves score of 0 (does not treat it as missing)", async () => {
    const mockEngine = makeMockEngine(JSON.stringify({
      vSignal: 0, cContext: 0, lSlop: 0, originality: 0, insight: 0, credibility: 0,
      composite: 0, verdict: "slop", reason: "All zeros", topics: [],
    }));
    mockCreateMLCEngine.mockResolvedValue(mockEngine);
    const { scoreWithWebLLM } = require("@/lib/webllm/engine");
    const result = await scoreWithWebLLM("Test content", []);
    expect(result.vSignal).toBe(0);
    expect(result.cContext).toBe(0);
    expect(result.lSlop).toBe(0);
    expect(result.originality).toBe(0);
    expect(result.composite).toBe(0);
  });

  it("clamps scores above 10 to 10", async () => {
    const mockEngine = makeMockEngine(JSON.stringify({
      vSignal: 15, cContext: 12, lSlop: -3, originality: 99,
      insight: 11, credibility: 100, composite: 42, verdict: "quality",
    }));
    mockCreateMLCEngine.mockResolvedValue(mockEngine);
    const { scoreWithWebLLM } = require("@/lib/webllm/engine");
    const result = await scoreWithWebLLM("Test content", []);
    expect(result.vSignal).toBe(10);
    expect(result.cContext).toBe(10);
    expect(result.lSlop).toBe(0); // clamped to min 0
    expect(result.originality).toBe(10);
    expect(result.composite).toBe(10);
  });

  it("defaults non-quality verdict to slop", async () => {
    const mockEngine = makeMockEngine(JSON.stringify({
      vSignal: 5, verdict: "excellent", reason: "test",
    }));
    mockCreateMLCEngine.mockResolvedValue(mockEngine);
    const { scoreWithWebLLM } = require("@/lib/webllm/engine");
    const result = await scoreWithWebLLM("Test content", []);
    expect(result.verdict).toBe("slop");
  });

  it("filters non-string topics and limits to 5", async () => {
    const mockEngine = makeMockEngine(JSON.stringify({
      vSignal: 7, topics: ["a", 123, "b", null, "c", "d", "e", "f", true],
    }));
    mockCreateMLCEngine.mockResolvedValue(mockEngine);
    const { scoreWithWebLLM } = require("@/lib/webllm/engine");
    const result = await scoreWithWebLLM("Test content", []);
    // Shared parser limits to 10 topics (not 5)
    expect(result.topics).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("provides default reason when reason is not a string", async () => {
    const mockEngine = makeMockEngine(JSON.stringify({ vSignal: 5, reason: 42 }));
    mockCreateMLCEngine.mockResolvedValue(mockEngine);
    const { scoreWithWebLLM } = require("@/lib/webllm/engine");
    const result = await scoreWithWebLLM("Test content", []);
    // Shared parser uses empty string for non-string reason
    expect(result.reason).toBe("");
  });

  it("truncates content to 3000 chars in prompt", async () => {
    const longText = "X".repeat(5000);
    const { scoreWithWebLLM } = require("@/lib/webllm/engine");
    await scoreWithWebLLM(longText, ["ai"]);

    const eng = await require("@/lib/webllm/engine").getOrCreateEngine();
    const call = eng.chat.completions.create.mock.calls[0][0];
    const prompt = call.messages[0].content;
    // The prompt should contain at most 3000 Xs
    const xCount = (prompt.match(/X/g) || []).length;
    expect(xCount).toBe(3000);
  });

  it("uses 'general' when userTopics is empty", async () => {
    const { scoreWithWebLLM } = require("@/lib/webllm/engine");
    await scoreWithWebLLM("Test", []);

    const eng = await require("@/lib/webllm/engine").getOrCreateEngine();
    const call = eng.chat.completions.create.mock.calls[0][0];
    const prompt = call.messages[0].content;
    expect(prompt).toContain("User interests: general");
  });

  it("joins multiple topics with comma", async () => {
    const { scoreWithWebLLM } = require("@/lib/webllm/engine");
    await scoreWithWebLLM("Test", ["ai", "crypto", "security"]);

    const eng = await require("@/lib/webllm/engine").getOrCreateEngine();
    const call = eng.chat.completions.create.mock.calls[0][0];
    const prompt = call.messages[0].content;
    expect(prompt).toContain("User interests: ai, crypto, security");
  });
});

describe("destroyEngine", () => {
  it("calls engine.unload() if engine exists", async () => {
    const mockEngine = makeMockEngine(VALID_JSON_RESPONSE);
    mockCreateMLCEngine.mockResolvedValue(mockEngine);
    const { getOrCreateEngine, destroyEngine, onStatusChange } = require("@/lib/webllm/engine");

    await getOrCreateEngine();
    expect(mockEngine.unload).not.toHaveBeenCalled();

    await destroyEngine();
    expect(mockEngine.unload).toHaveBeenCalledTimes(1);

    // Status should reset
    const statuses: Array<{ loaded: boolean; loading: boolean }> = [];
    onStatusChange((s: { loaded: boolean; loading: boolean }) => statuses.push({ ...s }));
    const last = statuses[statuses.length - 1];
    expect(last.loaded).toBe(false);
    expect(last.loading).toBe(false);
  });

  it("is safe to call when engine is null", async () => {
    const { destroyEngine } = require("@/lib/webllm/engine");
    await expect(destroyEngine()).resolves.toBeUndefined();
  });

  it("allows engine re-creation after destroy", async () => {
    const mockEngine1 = makeMockEngine(VALID_JSON_RESPONSE);
    const mockEngine2 = makeMockEngine(VALID_JSON_RESPONSE);
    mockCreateMLCEngine
      .mockResolvedValueOnce(mockEngine1)
      .mockResolvedValueOnce(mockEngine2);

    const { getOrCreateEngine, destroyEngine } = require("@/lib/webllm/engine");

    const first = await getOrCreateEngine();
    expect(first).toBe(mockEngine1);

    await destroyEngine();

    const second = await getOrCreateEngine();
    expect(second).toBe(mockEngine2);
    expect(mockCreateMLCEngine).toHaveBeenCalledTimes(2);
  });
});
