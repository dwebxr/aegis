import * as fs from "fs";
import * as path from "path";

describe("PWA manifest.json (structural)", () => {
  const manifestPath = path.resolve(__dirname, "../../public/manifest.json");
  let manifest: Record<string, unknown>;

  beforeAll(() => {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    manifest = JSON.parse(raw);
  });

  it("exists in public/", () => {
    expect(fs.existsSync(manifestPath)).toBe(true);
  });

  it("has required fields", () => {
    expect(manifest.name).toBe("Aegis");
    expect(manifest.short_name).toBe("Aegis");
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.background_color).toBe("#0a0f1e");
    expect(manifest.theme_color).toBe("#0a0f1e");
  });

  it("has icons array with at least 2 entries", () => {
    const icons = manifest.icons as Array<{ src: string; sizes: string }>;
    expect(Array.isArray(icons)).toBe(true);
    expect(icons.length).toBeGreaterThanOrEqual(2);
  });

  it("icon files exist in public/", () => {
    const icons = manifest.icons as Array<{ src: string }>;
    for (const icon of icons) {
      const iconPath = path.resolve(__dirname, "../../public", icon.src.replace(/^\//, ""));
      expect(fs.existsSync(iconPath)).toBe(true);
    }
  });

  it("includes 192x192 and 512x512 icons", () => {
    const icons = manifest.icons as Array<{ sizes: string }>;
    const sizes = icons.map(i => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });
});
