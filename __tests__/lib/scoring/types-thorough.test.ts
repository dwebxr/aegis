import {
  encodeEngineInReason,
  decodeEngineFromReason,
  ENGINE_LABELS,
  type ScoringEngine,
} from "@/lib/scoring/types";

describe("ENGINE_LABELS", () => {
  it("has labels for all 6 engines", () => {
    const engines: ScoringEngine[] = ["ollama", "webllm", "claude-byok", "claude-ic", "claude-server", "heuristic"];
    for (const e of engines) {
      expect(ENGINE_LABELS[e]).toBeDefined();
      expect(typeof ENGINE_LABELS[e]).toBe("string");
      expect(ENGINE_LABELS[e].length).toBeGreaterThan(0);
    }
  });
});

describe("encodeEngineInReason", () => {
  it("prepends [engine] to reason", () => {
    expect(encodeEngineInReason("ollama", "Good analysis")).toBe("[ollama] Good analysis");
  });

  it("works with empty reason", () => {
    expect(encodeEngineInReason("heuristic", "")).toBe("[heuristic] ");
  });

  it("works with all engine types", () => {
    const engines: ScoringEngine[] = ["ollama", "webllm", "claude-byok", "claude-ic", "claude-server", "heuristic"];
    for (const e of engines) {
      const encoded = encodeEngineInReason(e, "test");
      expect(encoded).toBe(`[${e}] test`);
    }
  });

  it("preserves special characters in reason", () => {
    expect(encodeEngineInReason("ollama", "Score: 8/10! [good]")).toBe("[ollama] Score: 8/10! [good]");
  });
});

describe("decodeEngineFromReason", () => {
  it("extracts engine from encoded reason", () => {
    const result = decodeEngineFromReason("[ollama] Good analysis");
    expect(result.engine).toBe("ollama");
    expect(result.cleanReason).toBe("Good analysis");
  });

  it("roundtrips all engine types", () => {
    const engines: ScoringEngine[] = ["ollama", "webllm", "claude-byok", "claude-ic", "claude-server", "heuristic"];
    for (const e of engines) {
      const encoded = encodeEngineInReason(e, "Test reason");
      const decoded = decodeEngineFromReason(encoded);
      expect(decoded.engine).toBe(e);
      expect(decoded.cleanReason).toBe("Test reason");
    }
  });

  it("handles legacy 'Heuristic' prefix", () => {
    const result = decodeEngineFromReason("Heuristic (AI unavailable): no strong signals.");
    expect(result.engine).toBe("heuristic");
    expect(result.cleanReason).toBe("Heuristic (AI unavailable): no strong signals.");
  });

  it("returns undefined engine for unknown prefix", () => {
    const result = decodeEngineFromReason("[unknown-engine] some text");
    expect(result.engine).toBeUndefined();
    expect(result.cleanReason).toBe("[unknown-engine] some text");
  });

  it("returns undefined engine for no prefix", () => {
    const result = decodeEngineFromReason("Just a plain reason");
    expect(result.engine).toBeUndefined();
    expect(result.cleanReason).toBe("Just a plain reason");
  });

  it("handles empty string", () => {
    const result = decodeEngineFromReason("");
    expect(result.engine).toBeUndefined();
    expect(result.cleanReason).toBe("");
  });

  it("does not match partial bracket patterns", () => {
    const result = decodeEngineFromReason("[ollama");
    expect(result.engine).toBeUndefined();
  });

  it("does not match bracket at middle of string", () => {
    const result = decodeEngineFromReason("prefix [ollama] suffix");
    expect(result.engine).toBeUndefined();
    expect(result.cleanReason).toBe("prefix [ollama] suffix");
  });

  it("handles reason with brackets inside", () => {
    const encoded = encodeEngineInReason("claude-ic", "Good [with brackets] analysis");
    const decoded = decodeEngineFromReason(encoded);
    expect(decoded.engine).toBe("claude-ic");
    expect(decoded.cleanReason).toBe("Good [with brackets] analysis");
  });
});
