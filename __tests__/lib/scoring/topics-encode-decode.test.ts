import {
  encodeTopicsInReason,
  decodeTopicsFromReason,
  encodeEngineInReason,
  decodeEngineFromReason,
} from "@/lib/scoring/types";

describe("encodeTopicsInReason", () => {
  it("appends [topics:...] suffix to reason", () => {
    expect(encodeTopicsInReason("Good analysis", ["ai", "ml"]))
      .toBe("Good analysis [topics:ai,ml]");
  });

  it("returns reason unchanged for empty topics", () => {
    expect(encodeTopicsInReason("No topics", [])).toBe("No topics");
  });

  it("returns reason unchanged for undefined topics", () => {
    expect(encodeTopicsInReason("No topics", undefined)).toBe("No topics");
  });

  it("handles single topic", () => {
    expect(encodeTopicsInReason("Reason", ["blockchain"]))
      .toBe("Reason [topics:blockchain]");
  });

  it("handles many topics", () => {
    const topics = Array.from({ length: 10 }, (_, i) => `topic-${i}`);
    const encoded = encodeTopicsInReason("Reason", topics);
    expect(encoded).toContain("[topics:");
    expect(encoded).toContain("topic-0");
    expect(encoded).toContain("topic-9");
  });

  it("handles topics with special characters", () => {
    const encoded = encodeTopicsInReason("Reason", ["c++", "c#", "node.js"]);
    expect(encoded).toBe("Reason [topics:c++,c#,node.js]");
  });

  it("handles empty reason string", () => {
    expect(encodeTopicsInReason("", ["ai"])).toBe(" [topics:ai]");
  });
});

describe("decodeTopicsFromReason", () => {
  it("extracts topics from encoded suffix", () => {
    const result = decodeTopicsFromReason("Good analysis [topics:ai,ml]");
    expect(result.topics).toEqual(["ai", "ml"]);
    expect(result.cleanReason).toBe("Good analysis");
  });

  it("returns empty topics for reason without suffix", () => {
    const result = decodeTopicsFromReason("Plain reason text");
    expect(result.topics).toEqual([]);
    expect(result.cleanReason).toBe("Plain reason text");
  });

  it("returns empty topics for empty string", () => {
    const result = decodeTopicsFromReason("");
    expect(result.topics).toEqual([]);
    expect(result.cleanReason).toBe("");
  });

  it("handles single topic", () => {
    const result = decodeTopicsFromReason("Reason [topics:blockchain]");
    expect(result.topics).toEqual(["blockchain"]);
    expect(result.cleanReason).toBe("Reason");
  });

  it("trims whitespace from topics", () => {
    const result = decodeTopicsFromReason("Reason [topics: ai , ml , llm ]");
    expect(result.topics).toEqual(["ai", "ml", "llm"]);
  });

  it("filters empty topics from splitting", () => {
    const result = decodeTopicsFromReason("Reason [topics:ai,,ml,]");
    expect(result.topics).toEqual(["ai", "ml"]);
  });

  it("handles topics with special characters", () => {
    const result = decodeTopicsFromReason("Reason [topics:c++,c#,node.js]");
    expect(result.topics).toEqual(["c++", "c#", "node.js"]);
  });

  it("does not match [topics:...] in the middle of reason", () => {
    const result = decodeTopicsFromReason("Some [topics:fake] and more text");
    expect(result.topics).toEqual([]);
    expect(result.cleanReason).toBe("Some [topics:fake] and more text");
  });
});

describe("engine + topics roundtrip (IC canister simulation)", () => {
  it("encodes engine then topics and decodes in reverse order", () => {
    const engine = "claude-ic" as const;
    const reason = "Quality AI research paper";
    const topics = ["ai", "research", "ml"];

    // Encode: engine first, then topics
    const withEngine = encodeEngineInReason(engine, reason);
    const encoded = encodeTopicsInReason(withEngine, topics);

    expect(encoded).toBe("[claude-ic] Quality AI research paper [topics:ai,research,ml]");

    // Decode: engine first, then topics from the cleaned reason
    const { engine: decodedEngine, cleanReason: reasonWithTopics } = decodeEngineFromReason(encoded);
    const { topics: decodedTopics, cleanReason } = decodeTopicsFromReason(reasonWithTopics);

    expect(decodedEngine).toBe("claude-ic");
    expect(decodedTopics).toEqual(["ai", "research", "ml"]);
    expect(cleanReason).toBe("Quality AI research paper");
  });

  it("roundtrips with no topics", () => {
    const engine = "heuristic" as const;
    const reason = "Heuristic analysis";

    const withEngine = encodeEngineInReason(engine, reason);
    const encoded = encodeTopicsInReason(withEngine, []);

    const { engine: decodedEngine, cleanReason: reasonWithTopics } = decodeEngineFromReason(encoded);
    const { topics: decodedTopics, cleanReason } = decodeTopicsFromReason(reasonWithTopics);

    expect(decodedEngine).toBe("heuristic");
    expect(decodedTopics).toEqual([]);
    expect(cleanReason).toBe("Heuristic analysis");
  });

  it("roundtrips with no engine prefix", () => {
    const reason = "Legacy reason without engine prefix";
    const topics = ["crypto"];

    const encoded = encodeTopicsInReason(reason, topics);
    const { engine, cleanReason: reasonWithTopics } = decodeEngineFromReason(encoded);
    const { topics: decodedTopics, cleanReason } = decodeTopicsFromReason(reasonWithTopics);

    expect(engine).toBeUndefined();
    expect(decodedTopics).toEqual(["crypto"]);
    expect(cleanReason).toBe("Legacy reason without engine prefix");
  });

  it("handles reason that contains bracket-like patterns", () => {
    const engine = "ollama" as const;
    const reason = "Score: [8/10] — good content";
    const topics = ["review"];

    const withEngine = encodeEngineInReason(engine, reason);
    const encoded = encodeTopicsInReason(withEngine, topics);

    const { engine: decodedEngine, cleanReason: reasonWithTopics } = decodeEngineFromReason(encoded);
    const { topics: decodedTopics, cleanReason } = decodeTopicsFromReason(reasonWithTopics);

    expect(decodedEngine).toBe("ollama");
    expect(decodedTopics).toEqual(["review"]);
    expect(cleanReason).toBe("Score: [8/10] — good content");
  });
});
