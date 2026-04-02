import { buildTranslationPrompt, parseTranslationResponse } from "@/lib/translation/prompt";

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
    const prompt = buildTranslationPrompt(longText, "de", undefined, 100);
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

  it("includes reason in prompt when provided", () => {
    const prompt = buildTranslationPrompt("Article text", "ja", "High quality analysis");
    expect(prompt).toContain("Article text");
    expect(prompt).toContain("High quality analysis");
    expect(prompt).toContain("JSON");
  });

  it("uses plain text format when no reason", () => {
    const prompt = buildTranslationPrompt("Article text", "ja");
    expect(prompt).not.toContain("JSON");
    expect(prompt).not.toContain("Reason");
  });

  it("truncates reason to 500 chars", () => {
    const longReason = "Z".repeat(600);
    const prompt = buildTranslationPrompt("text", "ja", longReason);
    const zCount = (prompt.match(/Z/g) ?? []).length;
    expect(zCount).toBe(500);
  });
});

describe("parseTranslationResponse", () => {
  it("parses JSON response with text and reason", () => {
    const result = parseTranslationResponse('{"text":"翻訳テキスト","reason":"翻訳理由"}');
    expect(result).not.toBeNull();
    expect(result!.text).toBe("翻訳テキスト");
    expect(result!.reason).toBe("翻訳理由");
  });

  it("parses JSON response with text only", () => {
    const result = parseTranslationResponse('{"text":"翻訳テキスト"}');
    expect(result).not.toBeNull();
    expect(result!.text).toBe("翻訳テキスト");
    expect(result!.reason).toBeUndefined();
  });

  it("returns null for ALREADY_IN_TARGET", () => {
    expect(parseTranslationResponse("ALREADY_IN_TARGET")).toBeNull();
  });

  it("falls back to plain text when JSON is invalid", () => {
    const result = parseTranslationResponse("Plain translated text");
    expect(result).not.toBeNull();
    expect(result!.text).toBe("Plain translated text");
    expect(result!.reason).toBeUndefined();
  });

  it("extracts JSON from surrounding text", () => {
    const result = parseTranslationResponse('Here is the translation: {"text":"翻訳","reason":"理由"}');
    expect(result!.text).toBe("翻訳");
    expect(result!.reason).toBe("理由");
  });

  it("handles whitespace around response", () => {
    const result = parseTranslationResponse("  ALREADY_IN_TARGET  ");
    expect(result).toBeNull();
  });
});
