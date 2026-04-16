import {
  isFeatureEnabled,
  isFeatureDisabled,
  getFlagSnapshot,
  getFlagDefinitions,
  _resetFeatureFlagsForTests,
  FLAGS,
} from "@/lib/featureFlags";

describe("featureFlags", () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
  });

  afterEach(() => {
    process.env = origEnv;
    _resetFeatureFlagsForTests();
  });

  it("returns the declared default when env var is missing", () => {
    delete process.env.X402_FREE_TIER_ENABLED;
    _resetFeatureFlagsForTests();
    expect(isFeatureEnabled("x402FreeTier")).toBe(FLAGS.x402FreeTier.defaultValue);
  });

  it("treats 'true' as enabled", () => {
    process.env.X402_FREE_TIER_ENABLED = "true";
    _resetFeatureFlagsForTests();
    expect(isFeatureEnabled("x402FreeTier")).toBe(true);
  });

  it("treats '1' as enabled", () => {
    process.env.X402_FREE_TIER_ENABLED = "1";
    _resetFeatureFlagsForTests();
    expect(isFeatureEnabled("x402FreeTier")).toBe(true);
  });

  it("treats 'yes' as enabled", () => {
    process.env.X402_FREE_TIER_ENABLED = "yes";
    _resetFeatureFlagsForTests();
    expect(isFeatureEnabled("x402FreeTier")).toBe(true);
  });

  it("treats 'false' as disabled", () => {
    process.env.FEATURE_SCORING_CASCADE = "false";
    _resetFeatureFlagsForTests();
    expect(isFeatureEnabled("scoringCascade")).toBe(false);
  });

  it("treats empty string as default", () => {
    process.env.X402_FREE_TIER_ENABLED = "";
    _resetFeatureFlagsForTests();
    expect(isFeatureEnabled("x402FreeTier")).toBe(FLAGS.x402FreeTier.defaultValue);
  });

  it("trims trailing whitespace from Vercel-injected vars", () => {
    process.env.X402_FREE_TIER_ENABLED = "true\n";
    _resetFeatureFlagsForTests();
    expect(isFeatureEnabled("x402FreeTier")).toBe(true);
  });

  it("is case-insensitive on the TRUE/True input", () => {
    process.env.X402_FREE_TIER_ENABLED = "TRUE";
    _resetFeatureFlagsForTests();
    expect(isFeatureEnabled("x402FreeTier")).toBe(true);
  });

  it("isFeatureDisabled is the inverse of isFeatureEnabled", () => {
    process.env.FEATURE_PUSH_SEND = "false";
    _resetFeatureFlagsForTests();
    expect(isFeatureDisabled("pushSend")).toBe(true);
    expect(isFeatureEnabled("pushSend")).toBe(false);
  });

  it("getFlagSnapshot returns every declared flag", () => {
    _resetFeatureFlagsForTests();
    const snap = getFlagSnapshot();
    for (const name of Object.keys(FLAGS) as (keyof typeof FLAGS)[]) {
      expect(snap).toHaveProperty(name);
      expect(typeof snap[name]).toBe("boolean");
    }
  });

  it("getFlagDefinitions mirrors FLAGS registry with evaluated state", () => {
    process.env.FEATURE_SCORING_CASCADE = "false";
    _resetFeatureFlagsForTests();
    const defs = getFlagDefinitions();
    expect(defs).toHaveLength(Object.keys(FLAGS).length);
    const cascade = defs.find(d => d.name === "scoringCascade");
    expect(cascade).toBeDefined();
    expect(cascade!.envName).toBe("FEATURE_SCORING_CASCADE");
    expect(cascade!.enabled).toBe(false);
    expect(cascade!.scope).toBe("server");
    expect(cascade!.description.length).toBeGreaterThan(10);
  });

  it("default values match the intended production posture (kill switches default ON, x402 free tier default OFF)", () => {
    for (const [envName, val] of Object.entries(process.env)) {
      if (envName.startsWith("FEATURE_") || envName === "X402_FREE_TIER_ENABLED") {
        void val;
        delete process.env[envName];
      }
    }
    _resetFeatureFlagsForTests();
    const snap = getFlagSnapshot();
    expect(snap.scoringCascade).toBe(true);
    expect(snap.translationCascade).toBe(true);
    expect(snap.briefingAggregation).toBe(true);
    expect(snap.pushSend).toBe(true);
    expect(snap.x402FreeTier).toBe(false);
  });
});
