# Rollback Procedures

Aegis runs in two places: a Vercel-hosted Next.js frontend and an Internet Computer canister. Each has its own rollback path.

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

Both should return `status: "ok"` with `icCanister: "reachable"`.
