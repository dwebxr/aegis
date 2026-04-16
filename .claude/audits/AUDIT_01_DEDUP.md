# AUDIT 01 — Code Duplication / DRY Evaluation

Scope: `/app/**`, `/contexts/**`, `/lib/**`, `/components/**`.
Excluded: `/canisters/**` (Motoko; out of scope for this audit).

Historical context: `.claude/evaluations/01-dry-dedup.md` already drove
two prior rounds — the `postToApi` scaffold (`lib/ingestion/fetchers.ts`),
the Anthropic wire helper (`lib/api/anthropic.ts`), the BYOK key
resolver (`lib/api/byok.ts`), and the generic `validatedLocalStorage`
helper have all already been factored. This round audits what remains.

Principle applied: flag only when (a) 2+ genuine occurrences with a
meaningfully-sized copied block, (b) identical invariants (not just
similar shapes), (c) a consolidation that preserves all observable
behaviour. Skip anything that would need a leaky helper.

## Findings

### F1 — IC canister reachability probe (HIGH severity / HIGH confidence)
Files:
- `app/api/health/route.ts:25-39` (11-line block)
- `app/api/d2a/health/route.ts:20-33` (11-line block)

Both health routes open-code the same "POST empty CBOR body to
/api/v2/canister/<id>/query, treat 400 as reachable, 200 as reachable,
anything else as `error (<status>)`, catch → `unreachable`" dance. Both
call `getHost()` + `getCanisterId()` and emit identical strings
(`"reachable"`, `"unreachable"`, `` `error (${res.status})` ``). Tests in
`__tests__/api/health.test.ts:104-120` and
`__tests__/api/d2a-health.test.ts:73-105` already lock down the exact
output strings — a shared helper is safe.

Consolidation: new `lib/ic/health.ts` exporting
`checkIcCanisterReachable(): Promise<"reachable" | "unreachable" | string>`
(the `string` variant is the `error (N)` form). Both health routes call
the helper and assign the return to `checks.icCanister`.

Risk: near-zero. The only observable difference was the log-prefix
(`"[health]"` vs `"[d2a/health]"`) — the helper takes a `label` arg so
the prefix stays the same.

### F2 — HTML-strip + whitespace-normalize string utility (HIGH severity / HIGH confidence)
Files:
- `app/api/fetch/url/route.ts:43`
- `app/api/fetch/rss/route.ts:137`

Both use the exact same expression:
`content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()`

Not a huge block, but an exact-duplicate one-liner that behaves as a
primitive: "strip HTML tags, collapse whitespace, trim." Easy to get
subtly wrong if one call site changes later (e.g., one team adds
decode-entities and the other doesn't).

Consolidation: export `stripHtmlToText(raw: string): string` from a new
`lib/utils/text.ts`.

Risk: none — both sites use literally the same regex-chain; no
semantic drift possible.

### F3 — `version` + `region` envelope fields in health routes (MEDIUM severity / HIGH confidence)
Files:
- `app/api/health/route.ts:53-55`
- `app/api/d2a/health/route.ts:40-41`

Same pair of fields read identically:
```ts
version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local",
region: (process.env.VERCEL_REGION || "local").trim(),
```
Tests at `__tests__/api/health.test.ts:50-54,122-127` and
`__tests__/api/d2a-health.test.ts:48-58` lock down the exact strings.

Consolidation: tiny `getDeployMeta()` helper in `lib/ic/health.ts` (or
`lib/utils/deployMeta.ts`) returning `{ version, region }`. Folded into
F1 since both consumers already import that file.

Risk: trivially safe — both sites already use identical expressions.

### F4 — naddr → long-form Nostr event fetch (MEDIUM severity / MEDIUM confidence)
Files:
- `app/api/fetch/briefing/route.ts:23-78`
- `app/b/[naddr]/page.tsx:21-74`

Both decode an `naddr`, validate `kind === KIND_LONG_FORM`, load
nostr-tools pool with ws injection, build a `{kinds, authors, "#d",
limit: 1}` filter, `withTimeout(pool.querySync(...), 15000)`, and
`pool.close(relays)` in finally. ~30 lines of near-identical flow.

Diverging concerns that prevent a straightforward extraction:
- the `/api/fetch/briefing` route returns `NextResponse` for each error
  branch (`400`/`404`/`502`/`504`) with specific messages;
- `app/b/[naddr]/page.tsx` caches results in a module-scope `Map` and
  maps failures to `null`;
- the page runs `parseBriefingMarkdown` on success before returning;
  the API route returns the raw event fields.

A shared helper that returns the raw `NostrEvent | null` would shave
the pool-loading + query boilerplate (~10 lines) but the two routes
would still need their own error mapping. Worth doing, but not HIGH
confidence — risk of subtle regression in error-code mapping if a
caller forgets to translate `null` to the right status. **Defer to
human review**; not implemented in this pass.

### F5 — Repeated inline `|| "Unknown"` author fallback (LOW / declined)
Observed in a handful of mappers (`fetchers.ts`, `url/route.ts`); each
fallback is contextual ("hostname", "RSS", "Unknown", `fid:${fid}`).
Not a DRY target — the default is part of the caller's semantics.

### F6 — `typeof .+ !== "string" || !.+\.trim()` guard (LOW / declined)
Three occurrences total (`analyze/route.ts`, two in `twitter/route.ts`).
Each returns a differently-worded 400 response. A helper would save
one line per site and produce worse error messages. Decline.

### F7 — `isNaN(new Date(x).getTime())` pattern (LOW / declined)
Appears in `lib/d2a/filterItems.ts`, `app/api/d2a/briefing/route.ts`,
`app/api/d2a/briefing/changes/route.ts`. This is idiomatic JS; a helper
(`parseIsoOrNull`) would cost more line-of-indirection than it saves.
Decline.

### F8 — SimplePool construction boilerplate (LOW / declined)
Seven+ sites do `new SimplePool()` + `setWsImpl(ws)` + `pool.close()`
or `pool.destroy()`. Each site has a different lifetime (one keeps a
long-lived listener pool, one uses `destroy()` to tear down, others
use `close(relays)`). Abstracting would either leak the pool (risk
of socket leaks) or impose a template the long-lived `manager.ts`
listener pool can't satisfy. Decline.

## Implementation plan

Apply F1, F2, F3. Defer F4 with a note. F5-F8 declined per rationale.

All changes land in a single commit. No public APIs change — only
internal routes consuming newly-exported helpers.

## Risks and caveats

- The `checks.icCanister` output strings are observable by operators and
  by `scripts/smoke-test.sh:100`. Preserving them exactly was mandatory
  and the helper returns the same strings.
- `getDeployMeta().region` keeps the `.trim()` call — the test at
  `__tests__/api/health.test.ts:122-127` asserts the trimmed value.
- `stripHtmlToText` is a spartan text stripper; it does NOT decode
  HTML entities (neither did the open-coded sites). Preserving
  observable behaviour takes precedence over "obvious improvements."
