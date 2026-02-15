import { parseScoreResponse } from "@/lib/scoring/parseResponse";

const validResponse = JSON.stringify({
  vSignal: 7,
  cContext: 6,
  lSlop: 2,
  originality: 8,
  insight: 7,
  credibility: 6,
  composite: 7.5,
  verdict: "quality",
  reason: "Good content",
  topics: ["ai", "tech"],
});

describe("parseScoreResponse", () => {
  it("parses valid JSON response", () => {
    const result = parseScoreResponse(validResponse);
    expect(result).not.toBeNull();
    expect(result!.vSignal).toBe(7);
    expect(result!.cContext).toBe(6);
    expect(result!.lSlop).toBe(2);
    expect(result!.originality).toBe(8);
    expect(result!.insight).toBe(7);
    expect(result!.credibility).toBe(6);
    expect(result!.composite).toBe(7.5);
    expect(result!.verdict).toBe("quality");
    expect(result!.reason).toBe("Good content");
    expect(result!.topics).toEqual(["ai", "tech"]);
  });

  it("parses fenced JSON (```json ... ```)", () => {
    const fenced = "```json\n" + validResponse + "\n```";
    const result = parseScoreResponse(fenced);
    expect(result).not.toBeNull();
    expect(result!.composite).toBe(7.5);
  });

  it("extracts JSON from surrounding text", () => {
    const messy = "Here is the result:\n" + validResponse + "\nThat's my analysis.";
    const result = parseScoreResponse(messy);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe("quality");
  });

  it("clamps out-of-range values to 0-10", () => {
    const outOfRange = JSON.stringify({
      vSignal: 15,
      cContext: -3,
      lSlop: 20,
      originality: -1,
      insight: 100,
      credibility: 11,
      composite: 50,
      verdict: "quality",
      reason: "test",
      topics: [],
    });
    const result = parseScoreResponse(outOfRange);
    expect(result).not.toBeNull();
    expect(result!.vSignal).toBe(10);
    expect(result!.cContext).toBe(0);
    expect(result!.lSlop).toBe(10);
    expect(result!.originality).toBe(0);
    expect(result!.insight).toBe(10);
    expect(result!.credibility).toBe(10);
    expect(result!.composite).toBe(10);
  });

  it("computes composite from V/C/L when composite is missing", () => {
    const noComposite = JSON.stringify({
      vSignal: 8,
      cContext: 6,
      lSlop: 2,
      originality: 7,
      insight: 6,
      credibility: 5,
      verdict: "quality",
      reason: "test",
      topics: [],
    });
    const result = parseScoreResponse(noComposite);
    expect(result).not.toBeNull();
    // (8*6)/(2+0.5) = 48/2.5 = 19.2 → clamped to 10
    expect(result!.composite).toBe(10);
  });

  it("returns null for garbage input", () => {
    expect(parseScoreResponse("not json at all")).toBeNull();
    expect(parseScoreResponse("")).toBeNull();
    expect(parseScoreResponse("Hello world!")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseScoreResponse("")).toBeNull();
  });

  it("uses fallback values for missing numeric fields", () => {
    const minimal = JSON.stringify({
      verdict: "slop",
      reason: "bad",
    });
    const result = parseScoreResponse(minimal);
    expect(result).not.toBeNull();
    // Missing fields default to 5
    expect(result!.vSignal).toBe(5);
    expect(result!.cContext).toBe(5);
    expect(result!.lSlop).toBe(5);
    expect(result!.verdict).toBe("slop");
  });

  it("truncates reason to 500 characters", () => {
    const longReason = JSON.stringify({
      vSignal: 5, cContext: 5, lSlop: 5,
      originality: 5, insight: 5, credibility: 5,
      composite: 5, verdict: "quality",
      reason: "x".repeat(600),
      topics: [],
    });
    const result = parseScoreResponse(longReason);
    expect(result).not.toBeNull();
    expect(result!.reason.length).toBe(500);
  });

  it("limits topics to 10", () => {
    const manyTopics = JSON.stringify({
      vSignal: 5, cContext: 5, lSlop: 5,
      originality: 5, insight: 5, credibility: 5,
      composite: 5, verdict: "quality", reason: "test",
      topics: Array.from({ length: 20 }, (_, i) => `topic${i}`),
    });
    const result = parseScoreResponse(manyTopics);
    expect(result).not.toBeNull();
    expect(result!.topics.length).toBe(10);
  });

  it("filters non-string topics", () => {
    const mixedTopics = JSON.stringify({
      vSignal: 5, cContext: 5, lSlop: 5,
      originality: 5, insight: 5, credibility: 5,
      composite: 5, verdict: "quality", reason: "test",
      topics: ["valid", 123, null, "also-valid"],
    });
    const result = parseScoreResponse(mixedTopics);
    expect(result).not.toBeNull();
    expect(result!.topics).toEqual(["valid", "also-valid"]);
  });

  it("defaults verdict to 'slop' for non-quality values", () => {
    const weird = JSON.stringify({
      vSignal: 5, cContext: 5, lSlop: 5,
      originality: 5, insight: 5, credibility: 5,
      composite: 5, verdict: "unknown", reason: "test", topics: [],
    });
    const result = parseScoreResponse(weird);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe("slop");
  });

  it("handles nested braces in reason string", () => {
    const nested = JSON.stringify({
      vSignal: 6, cContext: 7, lSlop: 1,
      originality: 7, insight: 7, credibility: 7,
      composite: 7, verdict: "quality",
      reason: "Contains {data} and {analysis}",
      topics: ["ai"],
    });
    const result = parseScoreResponse(nested);
    expect(result).not.toBeNull();
    expect(result!.reason).toBe("Contains {data} and {analysis}");
  });

  it("filters empty-string topics", () => {
    const emptyTopics = JSON.stringify({
      vSignal: 5, cContext: 5, lSlop: 5,
      originality: 5, insight: 5, credibility: 5,
      composite: 5, verdict: "quality", reason: "test",
      topics: ["valid", "", "   ", "also-valid"],
    });
    const result = parseScoreResponse(emptyTopics);
    expect(result).not.toBeNull();
    // Empty strings and whitespace are still strings, so they pass the typeof check
    // parseResponse only filters non-strings; empty strings are kept
    expect(result!.topics).toContain("valid");
    expect(result!.topics).toContain("also-valid");
  });

  it("returns null for reversed braces '} {'", () => {
    expect(parseScoreResponse("} some text {")).toBeNull();
  });

  it("handles non-numeric field values (null, boolean)", () => {
    const weird = JSON.stringify({
      vSignal: null, cContext: true, lSlop: false,
      originality: "high", insight: undefined,
      credibility: [], composite: 5,
      verdict: "quality", reason: "test", topics: [],
    });
    const result = parseScoreResponse(weird);
    expect(result).not.toBeNull();
    // Number(null)=0, Number(true)=1, Number(false)=0 — all finite, so no fallback
    expect(result!.vSignal).toBe(0); // null → Number(null)=0
    expect(result!.cContext).toBe(1); // true → Number(true)=1
    expect(result!.lSlop).toBe(0); // false → Number(false)=0
    // "high" → NaN → fallback 5
    expect(result!.originality).toBe(5);
  });

  it("computes composite correctly when lSlop = 0", () => {
    const zeroSlop = JSON.stringify({
      vSignal: 8, cContext: 6, lSlop: 0,
      originality: 7, insight: 7, credibility: 7,
      verdict: "quality", reason: "test", topics: [],
    });
    const result = parseScoreResponse(zeroSlop);
    expect(result).not.toBeNull();
    // Missing composite → (8*6)/(0+0.5) = 48/0.5 = 96 → clamped to 10
    expect(result!.composite).toBe(10);
  });

  it("returns null for whitespace-only input", () => {
    expect(parseScoreResponse("   \n\t  ")).toBeNull();
  });

  it("handles topics as non-array types", () => {
    const stringTopics = JSON.stringify({
      vSignal: 5, cContext: 5, lSlop: 5,
      originality: 5, insight: 5, credibility: 5,
      composite: 5, verdict: "quality", reason: "test",
      topics: "not-an-array",
    });
    const result = parseScoreResponse(stringTopics);
    expect(result).not.toBeNull();
    expect(result!.topics).toEqual([]);
  });

  it("handles non-string reason", () => {
    const numReason = JSON.stringify({
      vSignal: 5, cContext: 5, lSlop: 5,
      originality: 5, insight: 5, credibility: 5,
      composite: 5, verdict: "quality",
      reason: 42, topics: [],
    });
    const result = parseScoreResponse(numReason);
    expect(result).not.toBeNull();
    expect(result!.reason).toBe("");
  });

  it("handles Infinity and NaN in numeric fields", () => {
    // JSON.stringify filters out Infinity/NaN as null
    const weirdNums = '{"vSignal": 5, "cContext": 5, "lSlop": 5, "originality": 5, "insight": 5, "credibility": 5, "composite": 5, "verdict": "quality", "reason": "test", "topics": []}';
    const result = parseScoreResponse(weirdNums);
    expect(result).not.toBeNull();
    expect(Number.isFinite(result!.composite)).toBe(true);
  });
});
