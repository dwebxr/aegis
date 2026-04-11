import { validateTranslation } from "@/lib/translation/validate";

const longEn = "Apple announced a new MacBook with the M5 chip on October 15. ".repeat(3);

describe("validateTranslation — empty / whitespace", () => {
  it("rejects empty string", () => {
    const r = validateTranslation("", "ja", longEn);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/empty/);
  });

  it("rejects whitespace-only string", () => {
    const r = validateTranslation("   \n\t  ", "ja", longEn);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/empty/);
  });
});

describe("validateTranslation — meta-commentary detection", () => {
  it.each([
    "Here is the translation: アップルは...",
    "Here are the translated paragraphs: ...",
    "The translation is: アップルは...",
    "The translated text follows below.",
    "Translation: アップルは...",
    "Translated text: アップルは...",
    "Sure! Here is the translation in Japanese.",
    "Certainly, アップルは10月15日...",
    "Of course! アップルは...",
    "I can translate this text into Japanese.",
    "I cannot translate this text.",
    "I won't translate this content.",
    "I am sorry, this content cannot be translated.",
    "I apologize, but I cannot help with this.",
    "As an AI, I cannot translate copyrighted material.",
    "I am an AI assistant.",
    "Note: this text is partially in Japanese.",
  ])("rejects model self-talk: %s", (text) => {
    const r = validateTranslation(text, "ja", longEn);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/meta-commentary/);
  });

  it("does not reject when meta-pattern appears mid-text (model quoted itself)", () => {
    const r = validateTranslation(
      "アップルは10月15日、新型MacBookを発表しました。Note: this is a sample.",
      "ja",
      longEn,
    );
    expect(r.valid).toBe(true);
  });
});

describe("validateTranslation — Japanese kana check", () => {
  // Inputs sized so output/input ratio falls within the validator's [0.2, 5.0]
  // window. For en→ja the typical ratio is 0.4–0.7.
  const enInput = "Apple announced a new MacBook with the M5 chip today.";

  it("accepts text containing hiragana", () => {
    const r = validateTranslation("アップルは新型MacBookを発表しました。", "ja", enInput);
    expect(r.valid).toBe(true);
  });

  it("accepts text containing only katakana", () => {
    const r = validateTranslation("アップル ハッピョウ M5 マックブック", "ja", enInput);
    expect(r.valid).toBe(true);
  });

  it("rejects pure-English output for ja target", () => {
    const r = validateTranslation(
      "Apple announced a new MacBook with the M5 chip today.",
      "ja",
      enInput,
    );
    // Ratio is 1.0 so it passes the ratio check; the kana check rejects it.
    // identical-to-input also rejects it, but the kana check fires first.
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/no kana/);
  });

  it("rejects pure-kanji output for ja target (no kana = treated as missing)", () => {
    const r = validateTranslation("林檎社新型製品発表", "ja", enInput);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/no kana/);
  });
});

describe("validateTranslation — non-Japanese targets skip kana check", () => {
  it("accepts French output for fr target", () => {
    const r = validateTranslation(
      "Apple a annoncé un nouveau MacBook avec la puce M5 le 15 octobre.",
      "fr",
      longEn,
    );
    expect(r.valid).toBe(true);
  });

  it("accepts German output for de target", () => {
    const r = validateTranslation(
      "Apple kündigte am 15. Oktober ein neues MacBook mit M5-Chip an.",
      "de",
      longEn,
    );
    expect(r.valid).toBe(true);
  });

  it("rejects identical-to-input even for non-ja target", () => {
    const r = validateTranslation(longEn, "fr", longEn);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/identical/);
  });
});

describe("validateTranslation — length ratio", () => {
  it("rejects output much shorter than input (ratio < 0.2)", () => {
    const input = "a".repeat(200);
    const output = "あ".repeat(5);
    const r = validateTranslation(output, "ja", input);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/too short/);
  });

  it("rejects output much longer than input (ratio > 5.0)", () => {
    const input = "Apple released a product. This is news content with enough length.";
    const output = "アップル製品発表。" + "あ".repeat(input.length * 6);
    const r = validateTranslation(output, "ja", input);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/too long/);
  });

  it("skips length-ratio check for short inputs (< 30 chars)", () => {
    const r = validateTranslation("あ", "ja", "Hi!");
    expect(r.valid).toBe(true);
  });

  it("accepts a normal en→ja ratio (~0.6)", () => {
    const input = "Apple announced a new MacBook with the M5 chip on October 15, 2025.";
    const output = "Appleは2025年10月15日、M5チップ搭載の新型MacBookを発表しました。";
    const r = validateTranslation(output, "ja", input);
    expect(r.valid).toBe(true);
  });

  it("accepts the boundary ratio of exactly 0.2", () => {
    const input = "x".repeat(100);
    const output = "あ".repeat(20);
    const r = validateTranslation(output, "ja", input);
    expect(r.valid).toBe(true);
  });
});

describe("validateTranslation — identical-to-input check", () => {
  it("rejects when output equals input verbatim", () => {
    const text = "This is exactly the same.";
    const r = validateTranslation(text, "fr", text);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/identical/);
  });

  it("rejects when output equals input after trim", () => {
    const r = validateTranslation("  Apple released news.  ", "fr", "Apple released news.");
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/identical/);
  });
});
