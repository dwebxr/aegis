import { buildTranslationPrompt, parseTranslationResponse } from "@/lib/translation/prompt";

describe("buildTranslationPrompt", () => {
  it("includes target language name (Japanese template)", () => {
    const prompt = buildTranslationPrompt("Hello world", "ja");
    expect(prompt).toContain("Japanese");
  });

  it("includes the text content", () => {
    const prompt = buildTranslationPrompt("Test article content", "fr");
    expect(prompt).toContain("Test article content");
  });

  it("truncates text to maxLength when explicit", () => {
    const longText = "a".repeat(5000);
    const prompt = buildTranslationPrompt(longText, "de", undefined, 100);
    expect(prompt).toContain("a".repeat(100));
    expect(prompt).not.toContain("a".repeat(101));
  });

  it("instructs to respond ALREADY_IN_TARGET if already in target language", () => {
    const prompt = buildTranslationPrompt("Hello", "en");
    expect(prompt).toContain("ALREADY_IN_TARGET");
  });

  it("byte budget keeps full prompt under 9000 bytes for ASCII inputs", () => {
    const text = "Q".repeat(20_000);
    const prompt = buildTranslationPrompt(text, "ko");
    const bytes = new TextEncoder().encode(prompt).length;
    expect(bytes).toBeLessThanOrEqual(9000);
  });

  it("byte budget keeps full prompt under 9000 bytes for Japanese inputs (3 bytes/char)", () => {
    // Japanese characters are 3 bytes each in UTF-8 — a 5000-char input
    // would be 15000 bytes if not truncated. The budget should clamp it.
    const text = "あ".repeat(5000);
    const prompt = buildTranslationPrompt(text, "en");
    const bytes = new TextEncoder().encode(prompt).length;
    expect(bytes).toBeLessThanOrEqual(9000);
  });

  it("works for all supported languages", () => {
    const codes = ["en", "ja", "zh", "ko", "es", "fr", "de", "pt", "it", "ru"] as const;
    for (const code of codes) {
      const prompt = buildTranslationPrompt("test", code);
      expect(prompt.length).toBeGreaterThan(50);
    }
  });

  describe("Japanese specialization", () => {
    it("uses 敬体 / です・ます調 instructions for ja target", () => {
      const prompt = buildTranslationPrompt("Apple announced a new product.", "ja");
      expect(prompt).toContain("敬体");
      expect(prompt).toContain("です");
    });

    it("includes katakana proper-noun rule for ja target", () => {
      const prompt = buildTranslationPrompt("Apple released news.", "ja");
      expect(prompt).toContain("カタカナ");
      expect(prompt).toContain("アップル");
    });

    it("includes few-shot example for ja target", () => {
      const prompt = buildTranslationPrompt("Apple released news.", "ja");
      expect(prompt).toContain("Appleは10月15日");
      expect(prompt).toContain("M5チップ");
    });

    it("does NOT use Japanese-specific rules for other targets", () => {
      const fr = buildTranslationPrompt("Apple released news.", "fr");
      expect(fr).not.toContain("敬体");
      expect(fr).not.toContain("カタカナ");
    });

    it("ja template uses JSON output format when reason is provided", () => {
      const prompt = buildTranslationPrompt("Apple released news.", "ja", "High insight");
      expect(prompt).toContain("JSON");
      expect(prompt).toContain("translated reason here");
    });

    it("ja template uses plain output format when reason is omitted", () => {
      const prompt = buildTranslationPrompt("Apple released news.", "ja");
      expect(prompt).not.toContain("JSON");
      expect(prompt).not.toContain("Reason:");
    });
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

describe("parseTranslationResponse — meta-prefix stripping", () => {
  it.each([
    ["Here is the translation: アップルが新製品を発表しました。", "アップルが新製品を発表しました。"],
    ["Here is the translation in Japanese: アップルが新製品を発表しました。", "アップルが新製品を発表しました。"],
    ["The translation is: アップルが新製品を発表しました。", "アップルが新製品を発表しました。"],
    ["Translation: アップルが新製品を発表しました。", "アップルが新製品を発表しました。"],
    ["Translation:アップルが新製品を発表しました。", "アップルが新製品を発表しました。"],
    ["Translated text: アップルが新製品を発表しました。", "アップルが新製品を発表しました。"],
    ["Sure! アップルが新製品を発表しました。", "アップルが新製品を発表しました。"],
    ["Certainly. アップルが新製品を発表しました。", "アップルが新製品を発表しました。"],
    ["Of course! Here is the translation: アップルが新製品を発表しました。", "アップルが新製品を発表しました。"],
    ["Sure! Here is the translation in Japanese: アップルが新製品を発表しました。", "アップルが新製品を発表しました。"],
  ])("strips meta-prefix from %s", (input, expected) => {
    const result = parseTranslationResponse(input);
    expect(result).not.toBeNull();
    expect(result!.text).toBe(expected);
  });

  it("strips meta-prefix from JSON text field", () => {
    const json = '{"text":"Here is the translation: アップルが発表しました。","reason":"Translation: 新発表"}';
    const result = parseTranslationResponse(json);
    expect(result).not.toBeNull();
    expect(result!.text).toBe("アップルが発表しました。");
    expect(result!.reason).toBe("新発表");
  });

  it("does not strip mid-text meta words (only leading prefixes)", () => {
    const result = parseTranslationResponse("アップルが発表しました。Translation note: see source.");
    expect(result!.text).toBe("アップルが発表しました。Translation note: see source.");
  });

  it("plain Japanese without meta-prefix passes through unchanged", () => {
    const result = parseTranslationResponse("アップルが新製品を発表しました。");
    expect(result!.text).toBe("アップルが新製品を発表しました。");
  });
});
