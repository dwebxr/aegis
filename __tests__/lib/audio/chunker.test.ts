import { chunkText } from "@/lib/audio/chunker";

describe("chunkText", () => {
  describe("trivial cases", () => {
    it("returns empty array for empty input", () => {
      expect(chunkText("")).toEqual([]);
    });

    it("returns empty array for whitespace-only input", () => {
      expect(chunkText("   \n\t  ")).toEqual([]);
    });

    it("returns single chunk for short input", () => {
      const out = chunkText("Hello world.");
      expect(out).toEqual(["Hello world."]);
    });

    it("trims surrounding whitespace from short input", () => {
      const out = chunkText("   Hello world.   ");
      expect(out).toEqual(["Hello world."]);
    });
  });

  describe("sentence splitting", () => {
    it("splits long English text into sentence-based chunks", () => {
      const text = Array(20)
        .fill("This is a sentence about heuristic evaluation methodology.")
        .join(" ");
      const chunks = chunkText(text, 150);
      expect(chunks.length).toBeGreaterThan(1);
      for (const c of chunks) {
        expect(c.length).toBeLessThanOrEqual(150);
      }
      expect(chunks.join(" ")).toContain("methodology");
    });

    it("preserves sentence terminators", () => {
      const text = "First sentence. Second sentence! Third sentence? Fourth sentence.";
      const out = chunkText(text, 150);
      expect(out.join(" ")).toMatch(/First sentence\./);
      expect(out.join(" ")).toMatch(/Second sentence!/);
      expect(out.join(" ")).toMatch(/Third sentence\?/);
    });

    it("splits Japanese text on full-width terminators", () => {
      const text
        = "これは最初の文章です。これは二番目の文章です。これは三番目の文章で長めの内容を含んでいます。"
        + "これは四番目の文章です。これは五番目の文章でさらに長い内容を含んでいます。";
      const chunks = chunkText(text, 80);
      expect(chunks.length).toBeGreaterThan(1);
      for (const c of chunks) {
        expect(c.length).toBeLessThanOrEqual(80);
      }
    });
  });

  describe("invariants", () => {
    it("never produces empty chunks", () => {
      const text = "...!!!??? Hello!!!? World??? Now... testing!";
      const chunks = chunkText(text, 30);
      for (const c of chunks) {
        expect(c.length).toBeGreaterThan(0);
      }
    });

    it("never exceeds maxChars", () => {
      const inputs = [
        "Word ".repeat(100),
        "あ".repeat(500),
        "Long sentence with no terminator that just keeps going forever and ever and ever and ever and ever and ever and ever and ever",
        "https://very-long-url.example.com/path/to/something/that/is/much/longer/than/any/reasonable/chunk/limit/value",
      ];
      const limit = 100;
      for (const input of inputs) {
        const chunks = chunkText(input, limit);
        for (const c of chunks) {
          expect(c.length).toBeLessThanOrEqual(limit);
        }
      }
    });

    it("preserves character order", () => {
      const text = "Alpha. Beta. Gamma. Delta. Epsilon. Zeta. Eta. Theta. Iota.";
      const chunks = chunkText(text, 30);
      const joined = chunks.join(" ").replace(/\s+/g, " ");
      // Each Greek letter should appear in order in the joined output.
      const letters = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota"];
      let pos = 0;
      for (const l of letters) {
        const found = joined.indexOf(l, pos);
        expect(found).toBeGreaterThanOrEqual(pos);
        pos = found + l.length;
      }
    });
  });

  describe("oversized sentences", () => {
    it("soft-splits long sentences on commas", () => {
      const text = "Part one with details, part two with more details, part three with even more, part four wraps it up";
      const chunks = chunkText(text, 30);
      expect(chunks.length).toBeGreaterThan(1);
      for (const c of chunks) {
        expect(c.length).toBeLessThanOrEqual(30);
      }
    });

    it("hard-splits sentences with no comma fallback", () => {
      const text = "word ".repeat(100).trim();
      const chunks = chunkText(text, 50);
      for (const c of chunks) {
        expect(c.length).toBeLessThanOrEqual(50);
      }
    });

    it("handles single tokens longer than maxChars", () => {
      const giant = "x".repeat(500);
      const chunks = chunkText(giant, 100);
      expect(chunks.length).toBe(5);
      for (const c of chunks) {
        expect(c.length).toBe(100);
      }
    });
  });
});
