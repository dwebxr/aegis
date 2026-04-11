/**
 * @jest-environment jsdom
 */
import {
  recordTranslationAttempt,
  getTranslationDebugLog,
  clearTranslationDebugLog,
  formatDebugLog,
} from "@/lib/translation/debugLog";

beforeEach(() => {
  localStorage.clear();
});

describe("debugLog — record + read", () => {
  it("returns empty array when nothing has been recorded", () => {
    expect(getTranslationDebugLog()).toEqual([]);
  });

  it("records and reads a single entry", () => {
    recordTranslationAttempt({
      itemHint: "Apple announced...",
      targetLanguage: "ja",
      backend: "ic-llm",
      outcome: "ok",
      reason: "",
      elapsedMs: 1234,
    });
    const log = getTranslationDebugLog();
    expect(log).toHaveLength(1);
    expect(log[0].backend).toBe("ic-llm");
    expect(log[0].outcome).toBe("ok");
    expect(log[0].elapsedMs).toBe(1234);
    expect(log[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("records multiple entries in order", () => {
    recordTranslationAttempt({
      itemHint: "first", targetLanguage: "ja", backend: "ic-llm",
      outcome: "ok", reason: "", elapsedMs: 100,
    });
    recordTranslationAttempt({
      itemHint: "second", targetLanguage: "ja", backend: "claude-server",
      outcome: "failed", reason: "HTTP 502", elapsedMs: 200,
    });
    const log = getTranslationDebugLog();
    expect(log).toHaveLength(2);
    expect(log[0].itemHint).toBe("first");
    expect(log[1].itemHint).toBe("second");
  });

  it("truncates reason to 300 characters", () => {
    const longReason = "x".repeat(500);
    recordTranslationAttempt({
      itemHint: "x", targetLanguage: "ja", backend: "ic-llm",
      outcome: "failed", reason: longReason, elapsedMs: 50,
    });
    const log = getTranslationDebugLog();
    expect(log[0].reason).toHaveLength(300);
  });

  it("truncates itemHint to 60 characters", () => {
    const longHint = "y".repeat(200);
    recordTranslationAttempt({
      itemHint: longHint, targetLanguage: "ja", backend: "ic-llm",
      outcome: "ok", reason: "", elapsedMs: 50,
    });
    const log = getTranslationDebugLog();
    expect(log[0].itemHint).toHaveLength(60);
  });

  it("caps the log at 50 entries (rolling)", () => {
    for (let i = 0; i < 60; i++) {
      recordTranslationAttempt({
        itemHint: `item-${i}`, targetLanguage: "ja", backend: "ic-llm",
        outcome: "ok", reason: "", elapsedMs: i,
      });
    }
    const log = getTranslationDebugLog();
    expect(log).toHaveLength(50);
    // Oldest 10 dropped, newest 50 kept
    expect(log[0].itemHint).toBe("item-10");
    expect(log[49].itemHint).toBe("item-59");
  });

  it("clearTranslationDebugLog wipes the log", () => {
    recordTranslationAttempt({
      itemHint: "x", targetLanguage: "ja", backend: "ic-llm",
      outcome: "ok", reason: "", elapsedMs: 100,
    });
    expect(getTranslationDebugLog()).toHaveLength(1);
    clearTranslationDebugLog();
    expect(getTranslationDebugLog()).toEqual([]);
  });

  it("recovers from corrupted localStorage", () => {
    localStorage.setItem("aegis-translation-debug-log", "{not json");
    expect(getTranslationDebugLog()).toEqual([]);
  });

  it("recovers from non-array data", () => {
    localStorage.setItem("aegis-translation-debug-log", '{"not":"array"}');
    expect(getTranslationDebugLog()).toEqual([]);
  });

  it("filters malformed entries when reading", () => {
    const mixed = [
      { timestamp: "x", backend: "ic-llm", outcome: "ok", reason: "", elapsedMs: 1, itemHint: "x", targetLanguage: "ja" },
      { not: "valid" },
      "string-entry",
      null,
    ];
    localStorage.setItem("aegis-translation-debug-log", JSON.stringify(mixed));
    const log = getTranslationDebugLog();
    expect(log).toHaveLength(1);
    expect(log[0].backend).toBe("ic-llm");
  });
});

describe("formatDebugLog", () => {
  it("returns placeholder when log is empty", () => {
    const out = formatDebugLog("abc1234");
    expect(out).toContain("build abc1234");
    expect(out).toContain("(no entries yet)");
  });

  it("formats entries with build version, item hints and reasons", () => {
    recordTranslationAttempt({
      itemHint: "Apple announced...", targetLanguage: "ja", backend: "ic-llm",
      outcome: "failed", reason: "translation failed", elapsedMs: 2500,
    });
    const out = formatDebugLog("abc1234");
    expect(out).toContain("build abc1234");
    expect(out).toContain("Total entries: 1");
    expect(out).toContain("[ic-llm]");
    expect(out).toContain("failed");
    expect(out).toContain("(2500ms)");
    expect(out).toContain("Apple announced");
    expect(out).toContain("translation failed");
  });

  it("includes 'unknown' build when version is omitted", () => {
    const out = formatDebugLog();
    expect(out).toContain("build unknown");
  });
});
