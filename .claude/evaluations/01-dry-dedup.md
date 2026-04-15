# DRY / Duplication Evaluation

Scope: the Aegis codebase (TypeScript + Motoko). Reviewed:
`/app/api/**`, `/lib/ingestion/**`, `/lib/agent/**`, `/lib/nostr/**`,
`/lib/briefing/**`, `/contexts/**`, `/lib/utils/**`, `/lib/api/**`,
`/lib/cache/**`, storage modules under `/lib/*/storage.ts`,
`/canisters/aegis_backend/main.mo`.

Principle applied: flag only when 4+ occurrences or complex logic
repeats; skip coincidental similarity across different domains.

## Duplication hotspots

### 1. `/lib/ingestion/fetchers.ts` — internal POST-to-API fetcher scaffold (HIGH)
Files: `/lib/ingestion/fetchers.ts:21-172`
Four exported functions (`fetchRSS`, `fetchNostr`, `fetchURL`,
`fetchFarcaster`) each repeat the same 8-line scaffold:

```ts
const res = await fetch("/api/fetch/<x>", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(...),
  signal: AbortSignal.timeout(30_000),
});
if (!res.ok) {
  cb.handleFetchError(res, key);
  return [];
}
const data = await res.json();
// ... shape-specific mapping
```

...wrapped in an identical try/catch that calls
`cb.recordSourceError(key, msg)` and `console.error("[scheduler] <X>
fetch failed:", msg)`. All four differ only in the POST body, the
endpoint path, and the response-to-`RawItem` projection.

This is the cleanest duplication in the codebase — 4 identical
scaffolds, same timeout, same headers, same error semantics, same
callback contract. A tiny internal helper removes ~50 lines with no
behaviour change.

### 2. Anthropic `POST /v1/messages` call (MEDIUM)
Files:
- `/app/api/analyze/route.ts:37-64`
- `/app/api/briefing/digest/route.ts:61-90`
- `/app/api/translate/route.ts:38-66`

All three open-code:
```ts
fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  },
  body: JSON.stringify({ model, max_tokens, messages: [...] }),
  signal: AbortSignal.timeout(15_000 | 25_000),
});
```

Only 3 occurrences, and each has subtly different error-handling
semantics (analyze distinguishes parse errors and returns a heuristic
fallback; digest returns a generic 502; translate returns the raw
upstream status code). A shared helper would need to surface enough
metadata to preserve those branches, which erodes the win. Leave for
human review — the proposed refactor is a thin wrapper rather than a
real consolidation.

### 3. Claude BYOK key-header pattern (MEDIUM)
Files:
- `/app/api/analyze/route.ts:85-87`
- `/app/api/briefing/digest/route.ts:34-36`
- `/app/api/translate/route.ts:29-36`

Each does the same:
```ts
const userKey = request.headers.get("x-user-api-key");
const isUserKey = !!(userKey && userKey.startsWith("sk-ant-"));
const apiKey = isUserKey ? userKey : process.env.ANTHROPIC_API_KEY?.trim();
```

Three occurrences — borderline. `translate` rejects when no user key,
`analyze`/`digest` fall back to server key. A helper returning
`{ apiKey, isUserKey }` would DRY the happy path but the rejection
branch still has to live in each route. Defer.

### 4. localStorage-backed config stores (MEDIUM)
Files: `/lib/webllm/storage.ts`, `/lib/ollama/storage.ts`,
`/lib/mediapipe/storage.ts`, `/lib/apiKey/storage.ts`,
`/lib/audio/storage.ts`, `/lib/preferences/storage.ts`, and others
under `lib/*/storage.ts`.

All share a `typeof localStorage === "undefined"` guard, try/catch
around `JSON.parse`, and `enabled/modelId`-style shape validation.
Tempting to factor into `createLocalStorageConfig<T>()` but each
store:
- validates different fields (with different default fallbacks),
- logs under a different prefix (`[ollama]`, `[apiKey]`, ...),
- diverges on behaviour: `webllm` just stores `"true"`; `apiKey`
  throws on malformed input; `mediapipe` guards an enum.

A single abstract factory hides those invariants and makes future
changes harder to reason about. Better to leave per-domain. The
surface duplication is deceptive.

### 5. `/contexts/content/scoring.ts` tier branches (LOW)
File: `/contexts/content/scoring.ts:47-69`

`tryOllama`, `tryWebLLM`, `tryMediaPipe`, `tryBYOK` look parallel,
but each imports a different `scoreWith*` engine dynamically and tags
a different `scoringEngine` literal. Parameterising that would lose
the discriminated-union typing on `scoringEngine` and the
Sentry-span labels that are passed inline in `runScoringCascade`.
Four lines of clarity each — leave as is.

### 6. `icSync.ts` / other IC contexts (LOW)
Files: `/contexts/content/icSync.ts`, `/contexts/PreferenceContext.tsx`,
`/contexts/AgentContext.tsx`, `/contexts/SourceContext.tsx`.

Each context has its own IC sync shape (single-actor call vs. paged
retrieval with retry, offline queueing semantics differ by domain).
Surface patterns overlap (syncing + error logging) but the invariants
are domain-specific. Not duplication — parallel implementations with
real differences.

### 7. Motoko `main.mo` repeated guards (LOW)
File: `/canisters/aegis_backend/main.mo`

Several functions open with `if (Principal.isAnonymous(caller)) ...`
and `assert caller == owner`-style checks. These are intentional,
readable, and consistent. Not worth a macro substitute in Motoko —
there is no good factoring primitive and the current form is
auditable.

### 8. Nostr pool loader (LOW)
Files: `/app/api/fetch/nostr/route.ts:35-49`,
`/app/api/fetch/briefing/route.ts:39-44`.

Two occurrences of the `import nostr-tools/pool → inject ws →
new SimplePool()` sequence. Two is not duplication; both have
different error-surfacing shapes.

## Consolidation plan

### HIGH (apply now)
**H1. Factor the POST/map scaffold out of `lib/ingestion/fetchers.ts`.**

Introduce a file-local helper:

```ts
async function postToApi<T>(
  endpoint: string,
  payload: unknown,
  key: string,
  cb: FetcherCallbacks,
  label: string,
  map: (data: T) => RawItem[],
): Promise<RawItem[]> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      cb.handleFetchError(res, key);
      return [];
    }
    const data = await res.json() as T;
    return map(data);
  } catch (err) {
    const msg = errMsg(err);
    console.error(`[scheduler] ${label} fetch failed:`, msg);
    cb.recordSourceError(key, msg);
    return [];
  }
}
```

Each fetcher shrinks to just the request-body shape and the
per-source mapping. `fetchRSS` still needs its special-case
`notModified` / `httpCacheHeaders` handling — either do that at the
caller side (before/after `postToApi`) or extend the helper
signature with a `beforeMap(data, res)` hook. The simplest working
form keeps the etag handling in `fetchRSS` by using `postToApi`
only for the request path and keeping the etag extraction inline
after the helper returns the mapped items — but that regresses
typing. The cleanest fix is to expose an optional `onResponse` hook
so `fetchRSS` can still update `httpCacheHeaders` before mapping;
if that proves awkward, fall back to keeping RSS's full body and
applying the helper to the other three only.

Behaviour preservation: same endpoints, same timeout, same
`cb.handleFetchError`/`cb.recordSourceError` sequence, same log
prefix. No public API change — `fetchRSS`/`fetchNostr`/
`fetchURL`/`fetchFarcaster` keep their signatures and call contracts.

Validation: existing `__tests__/lib/ingestion/fetchers.test.ts`
already covers all four functions (including error paths, retries,
the notModified shortcut, and Farcaster fid validation). A green
run of that file is sufficient to prove the refactor.

### MEDIUM (defer — noted above)
- M1. Anthropic `POST /v1/messages` wrapper.
- M2. `x-user-api-key` BYOK helper.
- M3. `localStorage` config factory.

### LOW (defer — noted above)
- L1. Scoring tier branches.
- L2. IC sync patterns.
- L3. Motoko guard repetition.
- L4. Nostr pool loader.

## Summary

One HIGH-confidence consolidation is safe to apply immediately (the
fetcher scaffold). The MEDIUM candidates are genuine repetition but
the per-site branching makes a shared helper either leaky or thin.
The LOW items are surface-level similarity in code with different
invariants — factoring them would be a premature abstraction.
