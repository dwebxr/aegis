import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

describe("robots()", () => {
  it("points the sitemap at /sitemap.xml", () => {
    const result = robots();
    expect(result.sitemap).toMatch(/\/sitemap\.xml$/);
  });

  it("disallows /api/ but allows /api/d2a/info", () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
    const rule = rules[0];
    const disallow = Array.isArray(rule.disallow) ? rule.disallow : [rule.disallow];
    const allow = Array.isArray(rule.allow) ? rule.allow : [rule.allow];
    expect(disallow).toContain("/api/");
    expect(allow).toContain("/api/d2a/info");
  });
});

describe("sitemap()", () => {
  it("contains the root URL and /api-docs", () => {
    const result = sitemap();
    const urls = result.map((entry) => entry.url);
    expect(urls.some((u) => /\/api-docs$/.test(u))).toBe(true);
    expect(urls.some((u) => !/\/api-docs$/.test(u))).toBe(true);
  });
});
