import * as fs from "fs";
import * as path from "path";

describe("OGP / Meta tags (structural)", () => {
  const layoutPath = path.resolve(__dirname, "../../app/layout.tsx");
  const ogImagePath = path.resolve(__dirname, "../../public/og-image.png");
  let layoutContent: string;

  beforeAll(() => {
    layoutContent = fs.readFileSync(layoutPath, "utf-8");
  });

  describe("OG image", () => {
    it("exists at public/og-image.png", () => {
      expect(fs.existsSync(ogImagePath)).toBe(true);
    });

    it("is under 300KB", () => {
      const stats = fs.statSync(ogImagePath);
      expect(stats.size).toBeLessThan(300 * 1024);
    });
  });

  describe("metadata in layout.tsx", () => {
    it("has metadataBase set", () => {
      expect(layoutContent).toContain("metadataBase");
      expect(layoutContent).toContain("https://aegis.dwebxr.xyz");
    });

    it("has openGraph config", () => {
      expect(layoutContent).toContain("openGraph");
      expect(layoutContent).toContain("og-image.png");
      expect(layoutContent).toMatch(/type:\s*"website"/);
    });

    it("has twitter card config", () => {
      expect(layoutContent).toContain("twitter");
      expect(layoutContent).toContain("summary_large_image");
    });

    it("has description", () => {
      expect(layoutContent).toMatch(/description/);
    });

    it("has robots config", () => {
      expect(layoutContent).toContain("robots");
      expect(layoutContent).toMatch(/index:\s*true/);
    });

    it("has JSON-LD structured data", () => {
      expect(layoutContent).toContain("application/ld+json");
      expect(layoutContent).toContain("WebApplication");
      expect(layoutContent).toContain("schema.org");
    });
  });
});
