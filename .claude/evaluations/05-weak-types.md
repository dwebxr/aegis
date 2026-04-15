# Weak Type Elimination Evaluation

Worktree: `/Users/masia02/aegis/.claude/worktrees/agent-afd91402`
Branch: `worktree-agent-afd91402`

## Scope
- Files scanned: all `.ts`/`.tsx` under repo root, excluding `node_modules/`, `lib/ic/declarations/` (auto-generated Candid), `.next/`
- Motoko `.mo` files scanned for `Any` type usage
- Patterns searched: `: any`, `as any`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `Record<string, any>`, `Record<string, unknown>`, `: Function`, `: object`, `as unknown`, `: unknown`
- Count: 50 `any`-related occurrences total, ~85 `unknown`-related, 0 `Record<string, any>` in source, 0 Motoko `Any`

## Source Code (non-test) — HIGH Confidence Fixes

| File:Line | Current | Proposed | Confidence | Notes |
|-----------|---------|----------|------------|-------|
| `lib/ic/icpLedger.ts:9` | `{ IDL }: { IDL: any }` | `{ IDL }: { IDL: typeof import("@dfinity/candid").IDL }` | HIGH | `@dfinity/candid` exports `IDL` as namespace; we can reference its type. |
| `app/api/fetch/rss/route.ts:129` | `feed: Parser.Output<any>` | `feed: Parser.Output<RSSCustomFields>` with a narrow interface | HIGH | `Output<U>` takes a custom-field generic; `unknown` works too. |
| `app/api/fetch/briefing/route.ts:42` | `WebSocket as unknown as typeof globalThis.WebSocket` | `WebSocket` (no cast) | HIGH | `useWebSocketImplementation(ws: any)` — cast is load-bearing only to silence lint, not types. Remove double cast. |
| `app/api/fetch/nostr/route.ts:47` | same | same | HIGH | same |
| `app/b/[naddr]/page.tsx:40` | same | same | HIGH | same |

## Source Code — Legitimate `unknown` (KEEP)

All `Record<string, unknown>` in source are inside **runtime type guards** that validate external data before narrowing to strong types. These are correct usage of `unknown` at trust boundaries:

- `contexts/content/cache.ts` — parsing localStorage/IDB cached content
- `contexts/content/icSync.ts` — typed error handlers (`err: unknown` is TS4+ idiom)
- `contexts/content/scoring.ts` — API request body builder typed before `JSON.stringify`
- `contexts/SourceContext.tsx` — JSON.parse narrowing, error handlers
- `contexts/ContentContext.tsx` — promise error handlers
- `contexts/AuthContext.tsx` — promise error handlers
- `lib/preferences/storage.ts` — 16 occurrences, all inside `isValidProfile(parsed: unknown)` type predicate chain
- `lib/agent/handshake.ts` — `isValidOfferPayload`, `isValidDeliverPayload`, `isValidCommentPayload` guards
- `lib/scoring/parseResponse.ts` — `JSON.parse` narrowing for LLM response
- `lib/scoring/cache.ts` — IDB cache validation guards
- `lib/translation/cache.ts` / `lib/translation/debugLog.ts` — localStorage validation guards
- `lib/ingestion/sourceState.ts` — `isValidState` type predicate
- `lib/utils/errors.ts` — error utility functions take `unknown` (TS4+ catch clause idiom)
- `lib/nostr/profile.ts` — NIP-01 metadata merge with unknown extra fields (`[key: string]: unknown`)
- `lib/offline/actionQueue.ts` — queued action payload is intentionally opaque (serialized to IDB, deserialized elsewhere)
- `app/api/fetch/rss/route.ts` — error handlers + `extractAttr(field: unknown)` parsing untrusted XML
- `app/api/fetch/nostr/route.ts` / `app/api/fetch/twitter/route.ts` — error handlers
- `app/api/analyze/route.ts` — LLM response sanitization
- `lib/audio/storage.ts`, `lib/filtering/costTracker.ts`, `lib/mediapipe/engine.ts` — storage / error guards
- `lib/cache/urlExtract.ts` — 3rd-party open-graph metadata `Record<string, unknown>` is correct
- `lib/api/rateLimit.ts` — `guardAndParse<T = Record<string, unknown>>` default generic

## Declarations — KEEP AS-IS

| File | Reason |
|------|--------|
| `lib/ic/declarations/idlFactory.ts` | Auto-generated from Candid by `dfx generate`; MEMORY.md notes this is expected `any` typed IDL. |

## Test Files — Deferred (NOT Fixed)

Tests contain most `as any` usage, legitimately:
- **Partial mock callbacks** (`__tests__/lib/agent/manager-comment-fee.test.ts`, `__tests__/lib/briefing/sync*.test.ts`, `__tests__/lib/ic/agent-config.test.ts`): mocks intentionally lack full actor/manager interface; `as any` at construction is a common test pattern. Could be narrowed with `Partial<Actor> as ActorSubclass` but high churn, low payoff.
- **Intentional SSR / invalid-input coverage** (`__tests__/contexts/themeContext.test.tsx:86`, `filterMode.test.tsx:81`, `agent-config.test.ts @ts-expect-error`): `@ts-expect-error` used to **prove** the test exercises an error path. Removing would be wrong.
- **Prototype cleanup** (`__tests__/lib/utils/errors-extended.test.ts:110` `delete (globalThis as any).window`): intentional global mutation.
- **Test fixture overrides** (`__tests__/contexts/PreferenceContext*.test.tsx:8` `structuredClone` polyfill): the `(val: any) => ...` shape is polyfilling a built-in.

These are considered legitimate test idioms. Could be addressed in a follow-up pass with dedicated mock factories.

## Motoko

No `Any` type usage in `.mo` files.

## Action Plan

Apply all 5 HIGH-confidence source fixes in one commit, run `tsc --noEmit`, commit, done.
