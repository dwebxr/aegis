// Flags evaluated ONCE at module load (Vercel cold start reads env, warm reuses).
// Truthy values: "true" | "1" | "yes" (.trim()ed; Vercel envs can carry trailing \n).
// Scopes: "server" reads process.env at load; "public" must use NEXT_PUBLIC_* (DefinePlugin inlines).

type FlagScope = "server" | "public";

interface FlagDef {
  envName: string;
  defaultValue: boolean;
  description: string;
  scope: FlagScope;
}

// Adding a flag? Document the kill-switch behaviour in `description`.
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

const resolved: Record<FlagName, boolean> = Object.entries(FLAGS).reduce(
  (acc, [name, def]) => {
    acc[name as FlagName] = parseBooleanEnv(process.env[def.envName], def.defaultValue);
    return acc;
  },
  {} as Record<FlagName, boolean>,
);

export function isFeatureEnabled(name: FlagName): boolean {
  return resolved[name];
}

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
