import { buildTranslationPrompt, isAlreadyInTarget } from "@/lib/translation/prompt";

describe("buildTranslationPrompt", () => {
  it("includes target language name", () => {
    const prompt = buildTranslationPrompt("Hello world", "ja");
    expect(prompt).toContain("Japanese");
  });

  it("includes the text content", () => {
    const prompt = buildTranslationPrompt("Test article content", "fr");
    expect(prompt).toContain("Test article content");
  });

  it("truncates text to maxLength", () => {
    const longText = "a".repeat(5000);
    const prompt = buildTranslationPrompt(longText, "de", 100);
    expect(prompt).toContain("a".repeat(100));
    expect(prompt).not.toContain("a".repeat(101));
  });

  it("instructs to respond ALREADY_IN_TARGET if already in target language", () => {
    const prompt = buildTranslationPrompt("Hello", "en");
    expect(prompt).toContain("ALREADY_IN_TARGET");
  });

  it("uses default maxLength of 3000", () => {
    const text = "Q".repeat(4000);
    const prompt = buildTranslationPrompt(text, "ko");
    const qCount = (prompt.match(/Q/g) ?? []).length;
    expect(qCount).toBe(3000);
  });

  it("works for all supported languages", () => {
    const codes = ["en", "ja", "zh", "ko", "es", "fr", "de", "pt", "it", "ru"] as const;
    for (const code of codes) {
      const prompt = buildTranslationPrompt("test", code);
      expect(prompt.length).toBeGreaterThan(50);
    }
  });
});

describe("isAlreadyInTarget", () => {
  it("returns true for exact match", () => {
    expect(isAlreadyInTarget("ALREADY_IN_TARGET")).toBe(true);
  });

  it("returns true with surrounding whitespace", () => {
    expect(isAlreadyInTarget("  ALREADY_IN_TARGET  \n")).toBe(true);
  });

  it("returns false for translated text", () => {
    expect(isAlreadyInTarget("This is a translation")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isAlreadyInTarget("")).toBe(false);
  });

  it("returns false for partial match", () => {
    expect(isAlreadyInTarget("ALREADY_IN_TARGET plus more text")).toBe(false);
  });
});
