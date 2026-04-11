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
  it("rejects output much shorter than input (ratio < 0.02)", () => {
    const input = "a".repeat(1000);
    const output = "あ".repeat(5); // ratio 0.005
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

  it("accepts terse Llama 3.1 8B output where ratio is ~0.19", () => {
    const input = "Apple announced a new MacBook with the M5 chip and improved battery life today.";
    const output = "アップルが新製品発表しました。"; // 15 chars, ratio ~0.19
    const r = validateTranslation(output, "ja", input);
    expect(r.valid).toBe(true);
  });

  it("accepts very terse Claude output where ratio is ~0.04", () => {
    // Real-world claude-server failure mode (build 2be91af, 2026-04-12):
    // a 200-char boilerplate-heavy English input compressed into a
    // short-but-kana-containing Japanese summary. Pre-hotfix-15 with
    // MIN_RATIO=0.05 the cascade rejected this; with MIN_RATIO=0.02
    // the terse-but-valid translation passes and the user sees text.
    const input = "a".repeat(200);
    const output = "アップル発表"; // 6 chars, ratio 0.03 (above new 0.02 floor)
    const r = validateTranslation(output, "ja", input);
    expect(r.valid).toBe(true);
  });

  it("accepts the boundary ratio of exactly 0.02", () => {
    const input = "x".repeat(500);
    const output = "あ".repeat(10); // ratio 0.02
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

describe("validateTranslation — Unicode edge cases for ja kana check", () => {
  const enInput = "Apple announced a new MacBook with the M5 chip today.";

  it("accepts half-width katakana (U+FF66..U+FF9F)", () => {
    // "アップルデス" in half-width
    const r = validateTranslation("ｱｯﾌﾟﾙﾃﾞｽ", "ja", enInput);
    expect(r.valid).toBe(true);
  });

  it("accepts katakana phonetic extensions (U+31F0..U+31FF)", () => {
    // Leading "アップル" then a phonetic-extension codepoint (ㇸ U+31F8).
    const r = validateTranslation("アップルㇸ発表", "ja", enInput);
    expect(r.valid).toBe(true);
  });

  it("accepts mixed kana + kanji (typical real-world Japanese)", () => {
    const r = validateTranslation("アップルが新製品を発表しました。", "ja", enInput);
    expect(r.valid).toBe(true);
  });

  it("accepts kana mixed with ASCII punctuation and numbers", () => {
    const r = validateTranslation("Apple・M5搭載の新型MacBook(2025年10月)を発表", "ja", enInput);
    expect(r.valid).toBe(true);
  });

  it("accepts emoji-prefixed Japanese output", () => {
    const r = validateTranslation("🎉 アップルが新型MacBookを発表しました。", "ja", enInput);
    expect(r.valid).toBe(true);
  });

  it("rejects pure CJK Unified Ideographs (kanji only, no kana) for ja target", () => {
    // 林檎社 means "Apple Inc" but has no kana — mirrors a real Llama
    // failure mode where the model compresses input to kanji-only.
    const r = validateTranslation("林檎社新型発表", "ja", enInput);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/no kana/);
  });

  it("rejects text with full-width space but no kana", () => {
    const r = validateTranslation("Apple　released　news", "ja", enInput);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/no kana/);
  });

  it("surrogate-pair emoji in input does NOT break ratio calculation", () => {
    // "🍎" is a surrogate pair — JS string length counts 2 code units
    const input = "🍎 Apple announced a new MacBook M5 chip. " + "x".repeat(100);
    const output = "🎉 アップルが新型MacBook M5を発表しました。";
    const r = validateTranslation(output, "ja", input);
    expect(r.valid).toBe(true);
  });
});

describe("validateTranslation — RATIO_MIN_INPUT_LENGTH boundary", () => {
  // 30 chars is the cutoff — below it, ratio check is skipped.
  it("skips ratio check for input at 29 chars (below boundary)", () => {
    const input = "x".repeat(29);
    // 1 char of kana — ratio 1/29 ≈ 0.034 would pass anyway, but
    // short-input rule should exempt it regardless.
    const r = validateTranslation("あ", "ja", input);
    expect(r.valid).toBe(true);
  });

  it("applies ratio check at exactly 30 chars (boundary)", () => {
    const input = "x".repeat(30);
    const output = "あ".repeat(1); // ratio 0.033 — above MIN_RATIO=0.02
    const r = validateTranslation(output, "ja", input);
    expect(r.valid).toBe(true);
  });

  it("applies ratio check at 31 chars and rejects below floor", () => {
    // Input well above MIN_RATIO_INPUT_LENGTH, output would be below
    // 0.02 ratio — validator rejects.
    const input = "a".repeat(1000);
    const output = "あ".repeat(15); // 0.015 < 0.02
    const r = validateTranslation(output, "ja", input);
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/too short/);
  });
});

describe("validateTranslation — meta-commentary edge cases", () => {
  it("accepts text that CONTAINS the word 'translation' mid-sentence", () => {
    // Meta-commentary patterns are anchored at the start of the
    // trimmed string. A valid Japanese translation that mentions the
    // English word "translation" somewhere in its body must not trip.
    const input = "The translation feature is now available.";
    const r = validateTranslation("翻訳機能が利用可能になりました。", "ja", input);
    expect(r.valid).toBe(true);
  });

  it("rejects meta-commentary even with leading whitespace", () => {
    const r = validateTranslation(
      "   \n  Here is the translation: アップルが発表",
      "ja",
      "Apple announced a new product.",
    );
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/meta-commentary/);
  });

  it("case-insensitive meta-commentary detection", () => {
    const r = validateTranslation("HERE IS THE TRANSLATION: アップル", "ja", "Apple");
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/meta-commentary/);
  });
});

describe("validateTranslation — return shape invariants", () => {
  it("always sets `reason` when valid is false", () => {
    const cases: Array<[string, string]> = [
      ["", "some input"],
      ["   ", "some input"],
      ["Here is the translation: x", "Apple announced"],
      ["Apple announced", "Apple announced"],
      ["No kana here", "a".repeat(100)],
      ["あ", "x".repeat(5000)], // too short
    ];
    for (const [output, input] of cases) {
      const r = validateTranslation(output, "ja", input);
      expect(r.valid).toBe(false);
      expect(typeof r.reason).toBe("string");
      expect(r.reason!.length).toBeGreaterThan(0);
    }
  });

  it("never sets `reason` when valid is true", () => {
    const r = validateTranslation("アップル発表", "ja", "Apple announced a new thing.");
    expect(r.valid).toBe(true);
    expect(r.reason).toBeUndefined();
  });
});
