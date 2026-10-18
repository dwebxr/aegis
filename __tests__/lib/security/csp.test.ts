import { buildContentSecurityPolicy } from "@/lib/security/csp.cjs";

// Keep this literal independent of the builder: production must stay byte-identical.
const PRODUCTION_POLICY = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://va.vercel-scripts.com https://browser.sentry-cdn.com https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' https: data: blob:; connect-src 'self' https: wss:; font-src 'self' https://fonts.gstatic.com; frame-src https://www.youtube.com; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

describe("buildContentSecurityPolicy", () => {
  it("preserves the exact production policy", () => {
    const policy = buildContentSecurityPolicy("production");

    expect(policy).toBe(PRODUCTION_POLICY);
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it("adds only unsafe-eval to script-src in development", () => {
    const policy = buildContentSecurityPolicy("development");

    expect(policy).toBe(PRODUCTION_POLICY.replace(
      "script-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    ));
    expect(policy.replace(" 'unsafe-eval'", "")).toBe(PRODUCTION_POLICY);
  });

  it.each(["test", "staging", "", undefined])(
    "keeps the production policy for NODE_ENV=%s",
    nodeEnv => {
      expect(buildContentSecurityPolicy(nodeEnv)).toBe(PRODUCTION_POLICY);
    },
  );
});
