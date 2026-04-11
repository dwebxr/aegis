import { detectLanguage } from "@/lib/ingestion/langDetect";

describe("detectLanguage", () => {
  describe("Japanese", () => {
    it("detects hiragana-only text as ja", () => {
      expect(detectLanguage("これはにほんごのてきすとです")).toBe("ja");
    });

    it("detects katakana-only text as ja", () => {
      expect(detectLanguage("コンピュータサイエンス")).toBe("ja");
    });

    it("detects mixed kanji + hiragana as ja", () => {
      expect(detectLanguage("日本語の研究によれば、データは興味深い結果を示している")).toBe("ja");
    });

    it("detects mixed kanji + katakana as ja", () => {
      expect(detectLanguage("AIモデルのベンチマーク結果")).toBe("ja");
    });

    it("detects ja even with embedded English code/links", () => {
      expect(detectLanguage("研究論文 https://example.com で発表された AI のアルゴリズム")).toBe("ja");
    });

    it("detects ja with halfwidth katakana", () => {
      expect(detectLanguage("ｺﾝﾋﾟｭｰﾀ ｻｲｴﾝｽ")).toBe("ja");
    });

    it("detects ja with emphatic punctuation", () => {
      expect(detectLanguage("やばすぎる！！！")).toBe("ja");
    });
  });

  describe("English", () => {
    it("detects plain English as en", () => {
      expect(detectLanguage("This is a normal English sentence about technology.")).toBe("en");
    });

    it("detects English with numbers and punctuation", () => {
      expect(detectLanguage("The benchmark improved by 25% in Q4 2025.")).toBe("en");
    });

    it("detects English with URLs", () => {
      expect(detectLanguage("See the paper at https://example.com for the full methodology.")).toBe("en");
    });

    it("detects English even when capitalized", () => {
      expect(detectLanguage("BREAKING NEWS ABOUT TECHNOLOGY ADVANCES")).toBe("en");
    });
  });

  describe("Unknown", () => {
    it("returns unknown for empty string", () => {
      expect(detectLanguage("")).toBe("unknown");
    });

    it("returns unknown for whitespace-only", () => {
      expect(detectLanguage("   \n\t   ")).toBe("unknown");
    });

    it("returns unknown for very short input (< 4 chars)", () => {
      expect(detectLanguage("hi")).toBe("unknown");
      expect(detectLanguage("ABC")).toBe("unknown");
    });

    it("returns unknown for Arabic (out of Phase 1 scope)", () => {
      expect(detectLanguage("هذا نص عربي للاختبار")).toBe("unknown");
    });

    it("returns unknown for Chinese without kana (avoid Chinese-as-ja false positives)", () => {
      // Pure simplified Chinese — should NOT be classified as Japanese in Phase 1
      expect(detectLanguage("这是一段中文测试内容关于技术")).toBe("unknown");
    });

    it("returns unknown for Korean (out of Phase 1 scope)", () => {
      expect(detectLanguage("이것은 한국어 테스트입니다")).toBe("unknown");
    });

    it("returns unknown for emoji-heavy text with insufficient Latin ratio", () => {
      expect(detectLanguage("WOW!!! 🎉🔥💯🚀🎊 YES!!!")).toBe("unknown");
    });

    it("returns unknown for mixed-script texts where Latin is below 60%", () => {
      // Mostly punctuation and digits, only a few Latin letters
      expect(detectLanguage("!!!! 12345 !!! 67890 ABC !!!!")).toBe("unknown");
    });
  });

  describe("override-friendly behavior", () => {
    it("is deterministic for the same input", () => {
      const text = "Same input every time";
      expect(detectLanguage(text)).toBe(detectLanguage(text));
    });

    it("does not crash on extremely long input", () => {
      const text = "word ".repeat(10000);
      expect(detectLanguage(text)).toBe("en");
    });
  });
});
