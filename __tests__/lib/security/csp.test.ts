import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants";
import { buildContentSecurityPolicy } from "@/lib/security/csp.cjs";

// Keep this literal independent of the builder: production must stay byte-identical.
const PRODUCTION_POLICY = "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://va.vercel-scripts.com https://browser.sentry-cdn.com https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' https: data: blob:; connect-src 'self' https: wss:; font-src 'self' https://fonts.gstatic.com; frame-src https://www.youtube.com; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

describe("buildContentSecurityPolicy", () => {
  it.each([PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER])("preserves the exact production policy for %s", phase => {
    const policy = buildContentSecurityPolicy(phase);

    expect(policy).toBe(PRODUCTION_POLICY);
    expect(policy).not.toContain("'unsafe-eval'");
  });

  it("adds unsafe-eval only to script-src for the dev-server phase", () => {
    const policy = buildContentSecurityPolicy(PHASE_DEVELOPMENT_SERVER);

    expect(policy).toBe(PRODUCTION_POLICY.replace(
      "script-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    ));
    expect(policy.replace(" 'unsafe-eval'", "")).toBe(PRODUCTION_POLICY);
  });

  it.each([PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER])(
    "ignores NODE_ENV=development for %s",
    phase => {
      const env = jest.replaceProperty(process, "env", { ...process.env, NODE_ENV: "development" });
      try {
        expect(buildContentSecurityPolicy(phase)).toBe(PRODUCTION_POLICY);
      } finally {
        env.restore();
      }
    },
  );

  it.each(["development", "test", "staging", "", undefined])(
    "keeps the production policy for unrecognized phase %s",
    phase => {
      expect(buildContentSecurityPolicy(phase)).toBe(PRODUCTION_POLICY);
    },
  );
});
