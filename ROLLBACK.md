# Rollback Procedures

Aegis runs in two places: a Vercel-hosted Next.js frontend and an Internet Computer canister. Each has its own rollback path.

## Release tagging

Every production deploy should be tagged on main so operators have a
stable reference to point `vercel rollback` at without hunting through
deployment IDs.

```sh
# Bump package.json version first (patch for fixes, minor for features,
# major for breaking changes), then:
npm run release:tag
git push origin "v$(node -p "require('./package.json').version")"
```

The script (`scripts/release-tag.sh`) refuses to tag a dirty tree, a
non-main branch, a diverged local main, or an already-used version.
Tags take the form `vMAJOR.MINOR.PATCH` and match the `version` field
in `package.json`. Roll back to a tag with:

```sh
git checkout v0.2.1            # inspect the tagged state
vercel rollback <deployment>   # Vercel still lists the deploy; tag tells you which one
```

## Vercel (frontend + API routes)

Vercel keeps every prior production deployment. To revert:

```sh
# 1. List recent production deployments
vercel ls --prod

# 2. Promote a previous deployment to production (accepts URL or deployment ID)
vercel rollback <deployment-url-or-id>

# 3. (optional) Watch the rollback status
vercel rollback status
```

The rollback is atomic — traffic switches once the previous deployment is promoted. No build re-runs, so it is safe to use during incidents. Default timeout is 3 minutes; override with `--timeout`.

After rolling back, verify:

```sh
curl -s https://aegis-ai.xyz/api/health | jq '.version, .checks'
```

The `version` field is the short git SHA (`VERCEL_GIT_COMMIT_SHA`). Confirm it matches the rollback target.

## Internet Computer canister

The backend canister is `rluf3-eiaaa-aaaam-qgjuq-cai`. Motoko upgrades preserve `stable var` state but the wasm itself is replaced.

### Forward upgrade

```sh
dfx deploy --network ic aegis_backend
```

### Reverting a bad upgrade

There is **no automatic rollback**. To revert, redeploy the previous wasm:

1. Find the prior commit (before the bad upgrade): `git log canisters/aegis_backend/`
2. Check it out: `git checkout <prev-sha> -- canisters/`
3. Redeploy: `dfx deploy --network ic aegis_backend`
4. Restore working tree: `git checkout HEAD -- canisters/`

`stable var` fields are upgrade-compatible across versions, so as long as the schema (field names, types) was not destructively changed, the data survives. **Renaming or removing a `stable let` or `stable var` field is NOT reversible** — see CLAUDE.md memory entry on M0169.

### Pre-flight check

Before any canister upgrade, dry-run locally:

```sh
dfx start --background --clean
dfx deploy aegis_backend
# verify queries / updates work against local replica
dfx stop
```

## Database / state

There is no separate database — content state lives in:
- IndexedDB (per-browser, user-controlled)
- The IC canister (covered above)
- Vercel KV (rate limit + daily budget counters; ephemeral, no rollback needed)

## Stateless server-only additions

The following routes are pure read-paths over the IC canister briefing data
— no DB writes, no canister writes, no published artifacts. `vercel rollback`
reverts them cleanly with no side-effects to clean up:

- `/api/feed/rss`, `/api/feed/atom` — public per-principal RSS/Atom view
- `/api-docs` — Scalar-rendered OpenAPI viewer over `/openapi.yaml`
- `/api/d2a/info` `specUrl` field — additive JSON response field

The `@aegis/d2a-client` SDK in `packages/d2a-client/` is a publishable
artifact but is not yet on npm. Until `npm publish` is run there is
nothing external to roll back.

## Incident response order

1. **Frontend regression** → `vercel rollback` (≤30s).
2. **API route regression** → same as above (API routes are part of the Next.js bundle).
3. **Canister regression** → manual wasm redeploy (≥2 min, requires controller key).
4. **Both** → roll back Vercel first (faster), then canister.

## Verification after rollback

```sh
curl -s https://aegis-ai.xyz/api/health
curl -s https://aegis-ai.xyz/api/d2a/health
```

Both should return HTTP 200 with `status: "ok"` and `icCanister: "reachable"`.
A 503 response means degraded — check the body's `checks` and `warnings`
to identify the failing dependency. Uptime monitors can alert on HTTP
status code alone.

## Canister cycles runbook

The canister needs cycles to execute queries and updates. `/api/health`
surfaces the balance as `checks.canisterCycles` (`ok` | `low` | `error`).
Low cycles → canister eventually freezes and all updates/queries fail.

### Thresholds

| State | Balance | Action |
| --- | --- | --- |
| `ok` | ≥ 2T cycles | no action |
| `low` | < 2T cycles | top up within days — see below |
| `error` | probe failed | investigate (canister may be unreachable, not necessarily low) |

The 2T threshold mirrors `CYCLES_THRESHOLD` in
`canisters/aegis_backend/main.mo`. Below this, the canister attempts
self-top-up from on-chain revenue (see `topUpFromRevenue`), but if revenue
is zero or the CMC path fails, manual top-up is required.

### Manual top-up (dfx)

```sh
# From the controller identity. Amount in cycles — 1T cycles ≈ $1.30 at
# current rates; top up in 1T–5T increments depending on runway.
dfx wallet --network ic send <amount_cycles> <canister_id>

# Or top up directly from ICP via the cycles minting canister:
dfx ledger --network ic top-up rluf3-eiaaa-aaaam-qgjuq-cai --amount 1.0
```

Verify:

```sh
curl -s https://aegis-ai.xyz/api/health | jq '.checks.canisterCycles'
# Expect "ok" within a minute (the probe is cached 60s).
```

### Freeze recovery

If the canister has frozen (all calls fail with "canister frozen"),
top up using `dfx ledger top-up` (that path works even when the target
canister is frozen, since the CMC does the work). After top-up, issue a
query to confirm the canister responds again.

### Why the probe is cached

`/api/health` caches the cycles probe in-process for 60 seconds
(`CYCLES_CACHE_TTL_MS` in `lib/ic/health.ts`). This keeps the cost of
frequent uptime polling bounded: one IC query per minute per serverless
instance instead of one per request.

## Feature-flag kill switches

In addition to rollback, the app exposes env-driven kill switches for
expensive code paths. Set and redeploy (Vercel env change triggers a
rebuild). No code change required.

| Flag env var | Default | Effect when `false` |
| --- | --- | --- |
| `FEATURE_SCORING_CASCADE` | `true` | `/api/analyze` returns heuristic only; client cascade still tries local tiers but server is short-circuited |
| `FEATURE_TRANSLATION_CASCADE` | `true` | `/api/translate` returns 503 |
| `FEATURE_BRIEFING_AGGREGATION` | `true` | `/api/d2a/briefing` (no principal) returns 503; per-principal unaffected |
| `FEATURE_PUSH_SEND` | `true` | `/api/push/send` returns 503 |
| `X402_FREE_TIER_ENABLED` | `false` | `?preview=true` bypasses x402 payment |

Kill switches are faster than a rollback for cost-spike incidents
(Anthropic budget blown, push campaign gone wrong) and do not
invalidate the Vercel cache.

See `lib/featureFlags.ts` for the flag registry and
`/api/health` response's `flags` field for the current state.
