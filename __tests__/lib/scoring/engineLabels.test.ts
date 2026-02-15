import { ENGINE_LABELS, encodeEngineInReason, decodeEngineFromReason } from "@/lib/scoring/types";
import type { ScoringEngine } from "@/lib/scoring/types";

describe("ENGINE_LABELS", () => {
  it("has a label for every ScoringEngine value", () => {
    const engines: ScoringEngine[] = ["ollama", "webllm", "claude-byok", "claude-ic", "claude-server", "heuristic"];
    for (const e of engines) {
      expect(ENGINE_LABELS[e]).toBeDefined();
      expect(typeof ENGINE_LABELS[e]).toBe("string");
    }
  });
});

describe("encodeEngineInReason", () => {
  it("prepends [engine] prefix to reason", () => {
    expect(encodeEngineInReason("ollama", "Good analysis")).toBe("[ollama] Good analysis");
  });

  it("works for all engine types", () => {
    expect(encodeEngineInReason("claude-byok", "reason")).toBe("[claude-byok] reason");
    expect(encodeEngineInReason("heuristic", "reason")).toBe("[heuristic] reason");
  });
});

describe("decodeEngineFromReason", () => {
  it("extracts engine and clean reason from encoded string", () => {
    const result = decodeEngineFromReason("[ollama] Good analysis");
    expect(result.engine).toBe("ollama");
    expect(result.cleanReason).toBe("Good analysis");
  });

  it("extracts all known engine types", () => {
    const engines: ScoringEngine[] = ["ollama", "webllm", "claude-byok", "claude-ic", "claude-server", "heuristic"];
    for (const e of engines) {
      const encoded = encodeEngineInReason(e, "test reason");
      const decoded = decodeEngineFromReason(encoded);
      expect(decoded.engine).toBe(e);
      expect(decoded.cleanReason).toBe("test reason");
    }
  });

  it("detects legacy heuristic from 'Heuristic' prefix", () => {
    const result = decodeEngineFromReason("Heuristic (AI unavailable): basic scoring");
    expect(result.engine).toBe("heuristic");
    expect(result.cleanReason).toBe("Heuristic (AI unavailable): basic scoring");
  });

  it("returns undefined engine for unrecognized reason", () => {
    const result = decodeEngineFromReason("This is a normal AI analysis");
    expect(result.engine).toBeUndefined();
    expect(result.cleanReason).toBe("This is a normal AI analysis");
  });

  it("does not match invalid engine ids", () => {
    const result = decodeEngineFromReason("[unknown-engine] reason");
    expect(result.engine).toBeUndefined();
    expect(result.cleanReason).toBe("[unknown-engine] reason");
  });

  it("roundtrips encode → decode correctly", () => {
    const original = "High signal content with novel information about machine learning.";
    const encoded = encodeEngineInReason("claude-ic", original);
    const { engine, cleanReason } = decodeEngineFromReason(encoded);
    expect(engine).toBe("claude-ic");
    expect(cleanReason).toBe(original);
  });
});
