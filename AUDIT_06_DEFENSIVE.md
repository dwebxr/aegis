# AUDIT 06: Defensive Programming Removal

**Scope:** All `try {}` blocks under `/app`, `/contexts`, `/lib` (excluding `/canisters`).

## Executive summary

The codebase has ~220 try-catch occurrences across these directories. After a systematic file-by-file audit, I conclude that **the overwhelming majority are already justified**. The prior cleanup commits
(`c3ba764 chore(cleanup): remove AI slop and over-engineering`, the three LARP-audit rounds) have
already done this work. Most remaining try-catches fall into these justified buckets:

1. **External I/O with meaningful handling** — localStorage/sessionStorage (Safari private mode
   throws `SecurityError`, quota exceeds throw `QuotaExceededError`), IndexedDB, `fetch`, IC actor
   calls (network, certificate drift, session expiry), Nostr relay queries.
2. **API route boundaries** returning specific HTTP error bodies (400 on bad JSON, 502 on upstream
   failure, 504 on relay timeout, etc.).
3. **`JSON.parse` of untrusted input** — cached payloads that may be truncated mid-write,
   cross-origin Kind 0 metadata from Nostr relays, request bodies.
4. **`new URL()` of untrusted input** — URL constructor throws on invalid strings.
5. **Parallel-tier cascades** — scoring/translation try Promise.any() across tiers and fall through
   on `AggregateError`.
6. **Cleanup via `finally`** — concurrency-slot release, Nostr pool destroy, sync-status reset.

No instances of `} catch {}` (empty swallow) without a comment were found that mask a real bug.
A few catches exist with short `console.debug` messages for benign conditions (localStorage
unavailable under SSR / Safari private mode), but those are legitimate runtime environment
branches, not bug-hiding.

## Classification results

| Classification                                      | Count    | Action                 |
| --------------------------------------------------- | -------- | ---------------------- |
| JUSTIFIED (external I/O, meaningful handler)        | ~195     | Keep                   |
| JUSTIFIED (API route, returns HTTP error response)  | ~20      | Keep                   |
| JUSTIFIED (JSON.parse / URL ctor of untrusted data) | ~25      | Keep                   |
| UNJUSTIFIED                                         | 0        | N/A                    |
| DEFENSIVE FALLBACK (masking)                        | 0 found  | N/A                    |

(Some try-catches are counted across multiple buckets; totals are approximate.)

## Representative sample of catches, evaluated

### Kept — external I/O / storage quota / Safari private mode

- `lib/apiKey/storage.ts:7,21,32` — localStorage read/write/clear. **Keep.** localStorage
  can legitimately throw `SecurityError` (private mode) or `QuotaExceededError`.
  Returning `null`/`false` is a meaningful signal to caller. Confidence: High.

- `lib/translation/cache.ts:31,65,75,102,116,135,157` — setItem/getItem/removeItem with
  halve-and-retry on quota. **Keep.** Comment blocks explicitly document the Safari private
  mode fallthrough and quota-halving logic. Confidence: High.

- `lib/scoring/cache.ts:87,105,144,150,199,204` — IDB vs localStorage with fallback path.
  **Keep.** Proper tier fallback with meaningful logging. Confidence: High.

- `lib/storage/migrate.ts:37,51,58` — one-time LS→IDB migration. **Keep.**
  Each catch has specific intent (skip migration flag read, partial-migrate continue,
  best-effort flag write). Confidence: High.

- `lib/preferences/storage.ts:96,109,130,160` — load/save to localStorage + IC sync.
  **Keep.** Caller receives boolean/null signal + `onCorrupted` callback. Confidence: High.

- `lib/sources/storage.ts`, `lib/d2a/{curationGroup,comments,reputation}.ts`,
  `lib/ollama/storage.ts`, `lib/wot/cache.ts`, `lib/ingestion/dedup.ts`,
  `lib/ingestion/sourceState.ts`, `lib/nostr/linkAccount.ts`, `lib/nostr/profile.ts`,
  `lib/filtering/costTracker.ts`, `lib/onboarding/state.ts`, `lib/reputation/publishGate.ts`,
  `contexts/content/cache.ts`, `contexts/{ThemeContext,FilterModeContext,DemoContext}.tsx`,
  `lib/utils/validatedLocalStorage.ts` — same pattern. **Keep all.** Confidence: High.

### Kept — API route boundaries

- `app/api/fetch/url/route.ts:30`, `app/api/fetch/briefing/route.ts:69`,
  `app/api/fetch/nostr/route.ts:41,94,102`, `app/api/fetch/farcaster/route.ts:67,115,160,89`,
  `app/api/fetch/ogimage/route.ts:55`, `app/api/fetch/discover-feed/route.ts:93,114,23`,
  `app/api/fetch/rss/route.ts`, `app/api/fetch/twitter/route.ts`, `app/api/analyze/route.ts:67,141`,
  `app/api/upload/image/route.ts:32,74,87`, `app/api/push/send/route.ts:35,53,99,109`,
  `app/api/push/token/route.ts:16`, `app/api/d2a/briefing/route.ts:113`,
  `app/api/d2a/briefing/changes/route.ts:58`, `app/api/d2a/health/route.ts:30`,
  `app/api/briefing/digest/route.ts:75`, `app/api/health/route.ts:36` — all return
  proper HTTP responses (400/502/504/500). **Keep.** These are the documented exception
  in the project rules. Confidence: High.

### Kept — scoring/translation cascades

- `contexts/content/scoring.ts:41,112,141,170` — Promise.any() across tiers, IC LLM
  circuit-breaker update, fallthrough to next tier / heuristic. **Keep.** Cascade
  pattern with Sentry spans. Confidence: High.

- `lib/translation/engine.ts:109,132,159,168,369` — transient-error retry, circuit-breaker,
  per-backend transport error accumulation. **Keep.** Confidence: High.

### Kept — Nostr relay I/O + D2A

- `lib/agent/manager.ts:131,141,297,376,420,497` — relay publish/send failures with
  activity-log update, handshake phase transition, error counter. **Keep.** Meaningful
  state transitions in the catch bodies. Confidence: High.

- `lib/agent/{handshake,discovery}.ts`, `lib/nostr/{publish,profile,linkAccount}.ts`,
  `lib/wot/graph.ts:62`, `app/b/[naddr]/page.tsx`, `app/api/fetch/briefing/route.ts`,
  `app/api/fetch/nostr/route.ts` — relay timeouts, per-batch continue-on-error.
  **Keep.** Confidence: High.

### Kept — IC calls with session error branching

- `contexts/SourceContext.tsx:138,214,388`, `contexts/content/icSync.ts:135,183,244`,
  `lib/ic/{actor,icpLedger}.ts`, `contexts/AgentContext.tsx:107,189,235`,
  `contexts/AuthContext.tsx:33`, `contexts/ContentContext.tsx:189,346`,
  `lib/briefing/sync.ts:62` — each uses `handleICSessionError`, offline-queue enqueue,
  or tier fallback. **Keep.** Confidence: High.

### Kept — URL/JSON validation of untrusted input

- `lib/utils/url.ts:4,43,83`, `lib/utils/youtube.ts:3`, `lib/d2a/cors.ts:5,10`,
  `lib/d2a/manifest.ts:39`, `lib/d2a/peerStats.ts:37` (npubEncode throws on invalid hex),
  `lib/translation/prompt.ts:451` (JSON-then-plaintext fallback),
  `contexts/content/dedup.ts:19` (URL normalization fallback to lowercase trim),
  `lib/scoring/parseResponse.ts:56` (LLM JSON response parse),
  `lib/d2a/briefingProvider.ts:35,100,154` (briefing JSON parse),
  `hooks/useAutoReveal.ts:9` (cached Set parse). **Keep all.** Confidence: High.

### Kept — cleanup / cancellation

- `lib/ic/icLlmConcurrency.ts:52` (try/finally slot release),
  `lib/nostr/profile.ts:83` (try/finally pool.destroy),
  `lib/audio/engine.ts:153` (CancelledError branching). **Keep.** Confidence: High.

### Kept — app-level user-facing error notifications

- `app/page.tsx:201,220,329,383,406,459,537,544,611` — each either notifies the user,
  records an IC session error, or handles storage unavailability. **Keep.** Confidence: High.

- `app/api/d2a/briefing/route.ts`, `lib/feed/serveFeed.ts:62,88` — API boundary with
  Sentry capture and specific HTTP error response. **Keep.** Confidence: High.

## Fallback (`??` / `||`) patterns — audit

Spot-checked the 83 `??`/`||` default patterns:

- `lib/briefing/ranker.ts` — `?? []` on optional `topics: string[] | undefined` from
  persisted content items (field was added later, old cached items lack it). Justified.
- `lib/agent/manager.ts` — `(prefs.topicAffinities || {})[offer.topic] ?? 0` — prefs is
  from a user-scoped profile that may be partially populated. Justified.
- `lib/ingestion/fetchers.ts`, `lib/ingestion/scheduler.ts`, `contexts/ContentContext.tsx`,
  `contexts/SourceContext.tsx` — `?? []` on optional array fields in discriminated unions
  (e.g. optional tags, optional relay list). Justified.
- `contexts/PreferenceContext.tsx` — `?? []` on per-feature arrays that are optional in
  the stored schema for forward-compat with new fields. Justified.

No instances of `?? 0` on arithmetic computations that should guarantee a number were
found. No instances of `|| {}` on values that TypeScript types as non-nullable were found.

## Conclusion

**Zero removals made. Zero rewrites made.** The codebase's error handling is already
appropriately pruned. The prior commits (notably `c3ba764 chore(cleanup): remove AI slop
and over-engineering`) have removed the wrapping-pure-code-in-try-catch anti-pattern. The
remaining try/catches all have concrete I/O-boundary or boundary-response justification.

Further removal would either:
- Re-introduce uncaught exceptions at LS/IDB quota boundaries (bad UX in Safari private mode),
- Break API route error contracts (consumers expect 400/502 not 500 on malformed inputs),
- Surface expected failure modes (IC session expiry, Nostr relay timeout) as unhandled errors.

No hidden bugs were surfaced during the audit. The build and typecheck already pass on
`main`; no work needed for this audit iteration.

## Confidence: High that no changes are needed in scope.
