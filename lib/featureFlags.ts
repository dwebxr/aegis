/**
 * Typed feature-flag framework.
 *
 * Every flag is declared here with its env variable name, default, scope,
 * and description. Flags are evaluated ONCE at process start and cached
 * for the lifetime of the process. This matches Vercel's serverless
 * execution model (cold start reads env, warm starts reuse) and avoids
 * per-request env-var access overhead.
 *
 * Scopes:
 *  - `server`: backend only. Reads `process.env[envName]` at module load.
 *  - `public`: inlined into the client bundle. Must use `NEXT_PUBLIC_*`
 *    env names so Next.js/webpack DefinePlugin picks them up.
 *
 * Values: `"true"` / `"1"` / `"yes"` → enabled. Any other value → disabled.
 * Missing env var → the flag's `defaultValue` is used.
 *
 * Per user memory: Vercel env vars can carry trailing `\n`. All reads are
 * `.trim()`ed before comparison.
 */

type FlagScope = "server" | "public";

interface FlagDef {
  envName: string;
  defaultValue: boolean;
  description: string;
  scope: FlagScope;
}

/**
 * Central flag registry. All flags the app uses MUST be declared here.
 * Adding a flag? Document the kill-switch behaviour in `description`.
 */
export const FLAGS = {
  x402FreeTier: {
    envName: "X402_FREE_TIER_ENABLED",
    defaultValue: false,
    description: "Allow ?preview=true queries on /api/d2a/briefing to bypass x402 payment gate.",
    scope: "server",
  },
  scoringCascade: {
    envName: "FEATURE_SCORING_CASCADE",
    defaultValue: true,
    description: "Multi-tier AI scoring cascade (Ollama→WebLLM/MediaPipe→BYOK→IC LLM→Server Claude→Heuristic). When OFF the app uses the heuristic tier only, skipping all AI tiers. Useful to disable quickly if Anthropic/IC costs spike.",
    scope: "server",
  },
  translationCascade: {
    envName: "FEATURE_TRANSLATION_CASCADE",
    defaultValue: true,
    description: "Multi-tier translation (Ollama→WebLLM→BYOK→IC LLM). When OFF, /api/translate returns 503. Useful during cost incidents.",
    scope: "server",
  },
  briefingAggregation: {
    envName: "FEATURE_BRIEFING_AGGREGATION",
    defaultValue: true,
    description: "Global briefing aggregation endpoint /api/d2a/briefing (no principal path). When OFF the endpoint 503s. Per-principal briefings remain available.",
    scope: "server",
  },
  pushSend: {
    envName: "FEATURE_PUSH_SEND",
    defaultValue: true,
    description: "Web Push send endpoint /api/push/send. When OFF the endpoint 503s. Useful if VAPID keys rotate mid-incident or a campaign is paused.",
    scope: "server",
  },
} as const satisfies Record<string, FlagDef>;

type FlagName = keyof typeof FLAGS;

function parseBooleanEnv(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined) return defaultValue;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "") return defaultValue;
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

// Evaluate each flag once at module load. In Next.js server runtime this
// runs on cold start; the cache is shared across requests on the same
// instance. Public flags are inlined at build time via DefinePlugin, so
// reading process.env for them is also a build-time constant substitution.
const resolved: Record<FlagName, boolean> = Object.entries(FLAGS).reduce(
  (acc, [name, def]) => {
    acc[name as FlagName] = parseBooleanEnv(process.env[def.envName], def.defaultValue);
    return acc;
  },
  {} as Record<FlagName, boolean>,
);

/**
 * Returns the boolean value of a flag. Stable for the lifetime of the
 * process — cold-start re-reads env, warm requests hit the cache.
 */
export function isFeatureEnabled(name: FlagName): boolean {
  return resolved[name];
}

/** Reverse of isFeatureEnabled. Reads nicer at call sites sometimes. */
export function isFeatureDisabled(name: FlagName): boolean {
  return !resolved[name];
}

/**
 * Returns the full flag state. Exposed for the health endpoint + an
 * admin-only status view; not meant for per-request reads.
 */
export function getFlagSnapshot(): Record<FlagName, boolean> {
  return { ...resolved };
}

/**
 * Test seam: re-read env vars. Production code should never call this;
 * jest tests that mutate `process.env` use this to pick up the change
 * without reloading the module. Does NOT respect module-caching rules.
 */
export function _resetFeatureFlagsForTests(): void {
  for (const [name, def] of Object.entries(FLAGS)) {
    resolved[name as FlagName] = parseBooleanEnv(process.env[def.envName], def.defaultValue);
  }
}

/** Human-readable metadata — the health endpoint surfaces this. */
export function getFlagDefinitions(): Array<{ name: FlagName; envName: string; defaultValue: boolean; description: string; scope: FlagScope; enabled: boolean }> {
  return (Object.entries(FLAGS) as Array<[FlagName, FlagDef]>).map(([name, def]) => ({
    name,
    envName: def.envName,
    defaultValue: def.defaultValue,
    description: def.description,
    scope: def.scope,
    enabled: resolved[name],
  }));
}
