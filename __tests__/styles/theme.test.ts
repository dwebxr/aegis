import { scoreGrade, colors } from "@/styles/theme";

describe("scoreGrade", () => {
  describe("grade boundaries", () => {
    it("returns grade A for composite >= 8", () => {
      const result = scoreGrade(8);
      expect(result.grade).toBe("A");
      expect(result.color).toBe(colors.green[400]);
      expect(result.bg).toBe(colors.green.bg);
    });

    it("returns grade A for composite = 10 (maximum)", () => {
      expect(scoreGrade(10).grade).toBe("A");
    });

    it("returns grade A for composite = 8.0 (exact boundary)", () => {
      expect(scoreGrade(8.0).grade).toBe("A");
    });

    it("returns grade B for composite = 7.99 (just below A)", () => {
      expect(scoreGrade(7.99).grade).toBe("B");
    });

    it("returns grade B for composite >= 6 and < 8", () => {
      const result = scoreGrade(6);
      expect(result.grade).toBe("B");
      expect(result.color).toBe(colors.cyan[400]);
    });

    it("returns grade B for composite = 6.0 (exact boundary)", () => {
      expect(scoreGrade(6.0).grade).toBe("B");
    });

    it("returns grade C for composite = 5.99 (just below B)", () => {
      expect(scoreGrade(5.99).grade).toBe("C");
    });

    it("returns grade C for composite >= 4 and < 6", () => {
      const result = scoreGrade(4);
      expect(result.grade).toBe("C");
      expect(result.color).toBe(colors.amber[400]);
    });

    it("returns grade C for composite = 4.0 (exact boundary)", () => {
      expect(scoreGrade(4.0).grade).toBe("C");
    });

    it("returns grade D for composite = 3.99 (just below C)", () => {
      expect(scoreGrade(3.99).grade).toBe("D");
    });

    it("returns grade D for composite >= 2 and < 4", () => {
      const result = scoreGrade(2);
      expect(result.grade).toBe("D");
      expect(result.color).toBe(colors.orange[400]);
      expect(result.bg).toBe(colors.orange.bg);
    });

    it("returns grade D for composite = 2.0 (exact boundary)", () => {
      expect(scoreGrade(2.0).grade).toBe("D");
    });

    it("returns grade F for composite = 1.99 (just below D)", () => {
      expect(scoreGrade(1.99).grade).toBe("F");
    });

    it("returns grade F for composite < 2", () => {
      const result = scoreGrade(1);
      expect(result.grade).toBe("F");
      expect(result.color).toBe(colors.red[400]);
      expect(result.bg).toBe(colors.red.bg);
    });

    it("returns grade F for composite = 0", () => {
      expect(scoreGrade(0).grade).toBe("F");
    });
  });

  describe("edge cases", () => {
    it("handles negative composite", () => {
      const result = scoreGrade(-1);
      expect(result.grade).toBe("F");
      expect(result.color).toBe(colors.red[400]);
    });

    it("handles very large composite", () => {
      const result = scoreGrade(100);
      expect(result.grade).toBe("A");
    });

    it("handles fractional composite at boundaries", () => {
      expect(scoreGrade(7.9999).grade).toBe("B");
      expect(scoreGrade(8.0001).grade).toBe("A");
      expect(scoreGrade(5.9999).grade).toBe("C");
      expect(scoreGrade(6.0001).grade).toBe("B");
      expect(scoreGrade(3.9999).grade).toBe("D");
      expect(scoreGrade(4.0001).grade).toBe("C");
      expect(scoreGrade(1.9999).grade).toBe("F");
      expect(scoreGrade(2.0001).grade).toBe("D");
    });

    it("handles NaN composite", () => {
      // NaN comparisons always return false, so all >= checks fail → grade F
      const result = scoreGrade(NaN);
      expect(result.grade).toBe("F");
    });

    it("handles Infinity", () => {
      expect(scoreGrade(Infinity).grade).toBe("A");
    });

    it("handles -Infinity", () => {
      expect(scoreGrade(-Infinity).grade).toBe("F");
    });
  });

  describe("return value shape", () => {
    it("always returns an object with grade, color, and bg", () => {
      for (const val of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
        const result = scoreGrade(val);
        expect(typeof result.grade).toBe("string");
        expect(result.grade).toMatch(/^[ABCDF]$/);
        expect(typeof result.color).toBe("string");
        expect(typeof result.bg).toBe("string");
        // Colors should be valid CSS color values
        expect(result.color).toMatch(/^#|^rgba?\(/);
        expect(result.bg).toMatch(/^#|^rgba?\(/);
      }
    });

    it("each grade maps to a distinct color", () => {
      const grades = [9, 7, 5, 3, 1].map(v => scoreGrade(v));
      const colorSet = new Set(grades.map(g => g.color));
      expect(colorSet.size).toBe(5); // All 5 grades have unique colors
    });
  });
});
