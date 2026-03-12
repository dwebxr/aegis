import { SOCIAL_LINKS } from "@/lib/config";

describe("SOCIAL_LINKS", () => {
  it("has discord, medium, and x keys", () => {
    const keys = SOCIAL_LINKS.map(l => l.key);
    expect(keys).toEqual(["discord", "medium", "x"]);
  });

  it("has correct URLs for each service", () => {
    const map = Object.fromEntries(SOCIAL_LINKS.map(l => [l.key, l.href]));
    expect(map.discord).toBe("https://discord.gg/85JVzJaatT");
    expect(map.medium).toBe("https://medium.com/aegis-ai");
    expect(map.x).toBe("https://x.com/Coo_aiagent");
  });
});
