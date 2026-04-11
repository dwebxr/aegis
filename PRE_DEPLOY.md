# Pre-Deployment Checklist

Run through this list before promoting a new build to production. Items marked **REQUIRED** block deployment; items marked **ADVISORY** degrade the deployment but do not block it.

## Automated smoke test

```sh
scripts/smoke-test.sh              # hits https://aegis-ai.xyz
BASE_URL=https://staging scripts/smoke-test.sh
```

The script hits `/api/health`, `/api/translate` (expects 401 for the BYOK guard — see below), the landing page, and `/manifest.json`. It makes **no writes**, creates **no records**, and exits non-zero on any failed assertion so CI can consume it. Requires `jq` for body structure checks (falls back to status-only without it).

## Manual health check

```sh
curl -s https://aegis-ai.xyz/api/health | jq
```

The `checks` block reveals which env vars are configured. Compare against the table below.

## Required env vars (production)

| Var | Purpose | Currently set in Vercel? |
|---|---|---|
| `ANTHROPIC_API_KEY` | Server-side Claude API for scoring + briefing | ✅ |
| `NEXT_PUBLIC_CANISTER_ID` | IC backend canister ID | ✅ |
| `NEXT_PUBLIC_IC_HOST` | IC API host | ✅ |
| `NEXT_PUBLIC_INTERNET_IDENTITY_URL` | Internet Identity provider URL | ✅ |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Web Push public key | ✅ |
| `VAPID_PRIVATE_KEY` | Web Push private key (server only) | ✅ |
| `VAPID_SUBJECT` | Push notification contact email | ✅ |

## Advisory env vars — currently MISSING in production

The endpoint above returns `warnings` for these. They reduce observability and rate-limit safety but do not break functionality:

| Var | Purpose | Impact when missing |
|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` (or `SENTRY_DSN`) | Sentry error tracking | **No errors are captured in production**. Bug reports rely on user-side console screenshots. |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Vercel KV (Upstash Redis) for distributed rate limit + daily Anthropic budget tracking | Rate limit is **per serverless instance**, which on Vercel means effectively no rate limit. Daily Anthropic budget enforcement is per-instance and resets on cold start. |
| `ANTHROPIC_DAILY_BUDGET` | Daily Anthropic API call count cap (integer, default 500). Parsed via `parseInt()` so fractional values are truncated. **Not a USD figure.** | Defaults to 500 calls/day. Set explicitly to override. |
| `SENTRY_ORG` + `SENTRY_PROJECT` + `SENTRY_AUTH_TOKEN` | Build-time source map upload | Sentry stack traces show minified code, not source. |

### How to set them

```sh
# Example: enable Sentry
echo -n "https://your-dsn@sentry.io/12345" | vercel env add NEXT_PUBLIC_SENTRY_DSN production
echo -n "your-org" | vercel env add SENTRY_ORG production
echo -n "aegis" | vercel env add SENTRY_PROJECT production
echo -n "$SENTRY_TOKEN" | vercel env add SENTRY_AUTH_TOKEN production

# Example: enable distributed rate limit via Vercel KV
# (provision via https://vercel.com/dashboard → Storage → Create KV)
echo -n "https://your-kv.upstash.io" | vercel env add KV_REST_API_URL production
echo -n "$KV_TOKEN" | vercel env add KV_REST_API_TOKEN production
```

`echo -n` is critical: trailing `\n` causes `Principal.fromText()` to fail silently at build time when used with `NEXT_PUBLIC_*` vars (see CLAUDE.md memory).

After adding env vars, redeploy:

```sh
vercel --prod
```

## Pre-deploy checklist

- [ ] `npm test` — all suites pass
- [ ] `npm run lint` — clean
- [ ] `npm run build` — succeeds
- [ ] `npm audit --audit-level=critical` — exits 0
- [ ] Local production build smoke test: `npm run build && npm start`
- [ ] If touching `canisters/`: dry-run the upgrade against `dfx start --clean` (see ROLLBACK.md)
- [ ] If touching auth or session code: manual login flow on staging (II + linked Nostr)
- [ ] Confirm `git status` is clean and the deploying SHA matches `main`

## Translation endpoint: BYOK-only

Hotfix 17 (and the matching LARP audit fix C1) redesigned `/api/translate` so the operator's `ANTHROPIC_API_KEY` is **never** used for translation — regardless of what the client sends. The contract is:

- A valid `x-user-api-key: sk-ant-*` header is **required** on every request.
- Requests with no header, an empty header, or a non-`sk-ant-*` prefix return **401 Unauthorized**.
- The `ANTHROPIC_API_KEY` env var is still used by `/api/analyze` for scoring (which has its own daily-budget cap), but `/api/translate` will not fall back to it.

Operator rationale: anonymous browser users must not silently burn the operator's Anthropic budget. Users who want Claude-quality translation must provide their own API key via the Translation Settings BYOK field; all other users fall through to Ollama / WebLLM / MediaPipe / IC LLM in the auto cascade, none of which hit the operator's Anthropic account.

Future regressions that reintroduce a server-key fallback would be caught by `scripts/smoke-test.sh` (section [2]) and `__tests__/api/translate.test.ts`.

## Sentry trace sampling

`sentry.client.config.ts` sets `tracesSampleRate: 0.1` — **only 10%** of translation/scoring spans are forwarded to Sentry. The rationale is volume management: a single briefing fetch can produce 30-50 translation spans per user per minute, and at 100% sampling a modestly-trafficked deployment would hit Sentry's free-tier span quota inside hours.

Implications operators need to know:

- A production-wide translation outage WILL surface on Sentry error dashboards because `captureException` in the `infra-error` path is not subject to traces sampling — every cascade-exhausted transport failure is captured.
- Individual translation latency / cascade composition debugging is best-effort: 90% of successful translations leave no Sentry trace.
- To escalate sampling during an active incident, bump `tracesSampleRate` temporarily in `sentry.client.config.ts` and redeploy. Remember to revert before the quota window rolls over.
- Per-error context (`contexts.translate.failures`, `contexts.translate.attempts`) is always attached regardless of the sample rate — those are on the `captureException` event, not the span.

## Known accepted limitations

### Dev-dependency audit vulnerabilities (4 LOW)

`npm audit` reports 4 LOW-severity vulnerabilities in the dev chain: `@tootallnate/once` → `http-proxy-agent` → `jsdom` → `jest-environment-jsdom`. All four are dev-only; none ship in the production bundle (`npm audit --production` reports 0 vulnerabilities).

The suggested `npm audit fix` downgrades `jest-environment-jsdom` to `27.0.0`, which is a breaking semver-major downgrade that rearranges the jsdom API. The fix is **accepted as-is** until the jsdom upstream maintainers ship a non-breaking patch. Verification command:

```sh
npm audit --production    # must report "found 0 vulnerabilities"
```

### Task #32 — Qwen3 / Llama4Scout cycle-cost verification

Deferred. The canister-side upgrade from Llama 3.1 8B to Qwen3 or Llama4Scout requires a running local `dfx` replica to measure cycle costs before committing the upgrade to mainnet. The task is tracked for future operators with local dfx access; it does not block the current production build because the translation cascade no longer depends on IC LLM for smart-model translation (Claude BYOK is the authoritative path, IC LLM is the free-but-flaky fallback).

## Rollback if something is wrong

See [ROLLBACK.md](./ROLLBACK.md).
