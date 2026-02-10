import * as fs from "fs";
import * as path from "path";

describe("Offline page", () => {
  const offlinePath = path.resolve(__dirname, "../../app/offline/page.tsx");

  it("exists at app/offline/page.tsx", () => {
    expect(fs.existsSync(offlinePath)).toBe(true);
  });

  it("is a client component", () => {
    const content = fs.readFileSync(offlinePath, "utf-8");
    expect(content).toContain('"use client"');
  });

  it("contains offline messaging", () => {
    const content = fs.readFileSync(offlinePath, "utf-8");
    expect(content).toMatch(/offline/i);
    expect(content).toContain("reload()");
  });
});
