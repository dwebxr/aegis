# AUDIT 05 — Weak Types (`any`, `unknown`, `@ts-*`)

**Scope:** full repo. **tsconfig:** `strict: true`, `noEmit: true` already enforced. Baseline `npx tsc --noEmit --strict` is clean.

## Summary

Aegis is already remarkably clean. Production code (`app/`, `lib/`, `components/`, `contexts/`, `hooks/`, `packages/d2a-client/`) contains **exactly one** `any` usage — the intentional `IDL: any` parameter in the Candid IDL factory (documented in user memory as "any typed IDL param" convention).

All remaining weak-type sites live in test files (`__tests__/`, `e2e/`). No `@ts-ignore`, `@ts-nocheck`, or `as any` exists in production source. `@ts-expect-error` appears only in tests where it is correct (tests that intentionally call APIs with wrong types to verify runtime behaviour).

`unknown` is used pervasively and correctly at boundary validators (storage parsers, Nostr message handlers, fetch error handlers, type guards).

| Category | Count | Notes |
|---|---|---|
| `any` in production | 1 | IDL factory, preserved per user memory |
| `any` in tests/e2e | 13 | Triaged below |
| `as any` total | 7 | All in tests/e2e |
| `@ts-ignore` | 0 | — |
| `@ts-expect-error` | 11 | All legitimate SSR / mock-window tests |
| `@ts-nocheck` | 0 | — |
| `Record<string, any>` | 0 | — |
| Unjustified `unknown` | 0 | All uses are boundary validators |

---

## Production `any` — evaluated

### lib/ic/declarations/idlFactory.ts:2

```ts
/* eslint-disable @typescript-eslint/no-explicit-any */
export const idlFactory = ({ IDL }: { IDL: any }) => { ... }
```

**Proposed:** `{ IDL: typeof import('@dfinity/candid').IDL }` would technically work (the package exports `IDL` as a namespace).

**Decision: KEEP `any`.** User memory explicitly notes: "IDL factory files from dfx generate are JS; for strict TS projects, convert to `.ts` with `any` typed IDL param." This matches the convention used across @dfinity projects, keeps the file easy to regenerate from `dfx generate`, and is already isolated with an eslint-disable comment. Typing it as `typeof IDL` would work but locks the file to the current candid package layout and diverges from dfx-generated output.

**Confidence:** High (keep decision).

---

## Test-file `any` — evaluated

### __tests__/__helpers__/mocks.ts (zero `any` in code)

The phrase "without sprinkling `as any`" appears in a comment, not actual code. No change.

### __tests__/api/d2a-briefing.test.ts:291, 302 — `(c: any) => c.principal`

**Current:** `data.contributors.map((c: any) => c.principal)`
**Evidence:** `data` is parsed `await res.json()` — Response.json() returns `Promise<any>` per the standard DOM types. The consumer should destructure to `{ contributors }: GlobalBriefingResponse` so `c` becomes `GlobalBriefingContributor`.
**Proposed:** `(c: GlobalBriefingContributor) => c.principal` with `const data: GlobalBriefingResponse = await res.json();`
**Confidence:** High. Will fix.

### __tests__/api/d2a-briefing-changes.test.ts:56 — `as any`

**Current:** `items: (itemsOverride ?? [...]) as any`
**Context:** `itemsOverride` is `Array<Record<string, unknown>>` because the test needs to pass deliberately partial items. The `as any` satisfies the `D2ABriefingItem[]` field on `D2ABriefingResponse`.
**Proposed:** `as unknown as D2ABriefingItem[]` — narrows what the double-cast is doing.
**Confidence:** High. Will fix.

### __tests__/api/d2a-briefing-changes.test.ts:156 — `(c: any) => c.title`

Same pattern as d2a-briefing.test.ts 291/302. Proposed type: `BriefingChange`.
**Confidence:** High. Will fix.

### __tests__/lib/d2a/briefingProvider-raw.test.ts:154 — `"not-bigint" as any`

**Current:** Mocks return `[[Principal, string, "not-bigint" as any]]` to exercise a runtime fallback when `typeof generatedAtNs === "bigint"` is false.
**Proposed:** `"not-bigint" as unknown as bigint` — same runtime behaviour, documents the deliberate type violation.
**Confidence:** High. Will fix.

### __tests__/contexts/PreferenceContext.test.tsx:8, PreferenceContext-edge.test.tsx:8 — `((val: any) => ...)`

**Current:** `globalThis.structuredClone = ((val: any) => JSON.parse(JSON.stringify(val))) as typeof structuredClone;`
**Evidence:** Real `structuredClone<T>(val: T): T` has a generic signature. `unknown` works identically at runtime and documents the boundary.
**Proposed:** `(val: unknown) => ...`
**Confidence:** High. Will fix.

### __tests__/larp-audit-fixes.test.ts:87 — `delete (state as any).rateLimitedUntil`

**Current:** Deleting a required field for a negative test.
**Proposed:** Build the state without the field: `const { rateLimitedUntil: _omit, ...stateWithoutField } = defaultState();` (or use a typed partial). The field is required on `SourceRuntimeState` so deleting it is the real intent — an `as unknown as Record<string, unknown>` cast preserves intent while avoiding `any`.
**Confidence:** High. Will fix (prefer destructure omit — cleaner).

### __tests__/lib/ingestion/dedup-thorough.test.ts:127 — `globalThis.localStorage as any`

**Current:** `jest.spyOn(globalThis.localStorage as any, "setItem")`
**Evidence:** `jest.spyOn<T, K>` requires `T` + key `K extends keyof T`. `localStorage` (`Storage`) is fine, the cast is unnecessary.
**Proposed:** Remove the cast entirely.
**Confidence:** High. Will fix.

### __tests__/lib/utils/errors-extended.test.ts:110 — `delete (globalThis as any).window`

**Current:** Simulating SSR by removing `window`.
**Evidence:** `globalThis.window` is `Window & typeof globalThis` (required). Cannot `delete` a required property under strict mode without widening.
**Proposed:** `delete (globalThis as unknown as { window?: Window }).window` — narrower cast.
**Confidence:** High. Will fix.

### e2e/fixtures/auth-mock.ts:10 — `window as any`

**Current:** Attaching `__AEGIS_MOCK_AUTH` / `__AEGIS_MOCK_PRINCIPAL` to window.
**Evidence:** `contexts/AuthContext.tsx:71` already reads the same globals using the exact pattern we need: `const w = window as Window & { __AEGIS_MOCK_AUTH?: boolean; __AEGIS_MOCK_PRINCIPAL?: string };`.
**Proposed:** Mirror that typing.
**Confidence:** High. Will fix.

### packages/d2a-client/__tests__/handshake-senders.test.ts:6 — `jest.fn<unknown[], unknown[]>()`

**Current:** `jest.fn<unknown[], unknown[]>()`
**Evidence:** The second generic is the *args type*, which should be a tuple matching `SimplePool.publish(relays, event)` → `[string[], Event]`. Using `unknown[]` is lazy but harmless; fixing means importing nostr-tools types into tests. Jest's generic position semantics also changed across major versions (v27 is `<TReturn, TArgs>` tuple; v30 is `<TFn extends (...args) => any>`). Using `unknown[]` avoids the version-coupling tangle.
**Proposed:** Keep. Legitimate boundary — test mock surface for a third-party SDK.
**Confidence:** Medium. No change.

---

## `unknown` — evaluated

All `unknown` uses in production are at legitimate boundaries. Spot-checked:

- `lib/offline/actionQueue.ts:10,40` — queued payload persisted across worker boundary. Correct.
- `lib/nostr/profile.ts:17,106` — parsed Nostr profile JSON. Correct.
- `lib/ic/icpLedger.ts:89` — Candid variant error shape unknown. Correct.
- `lib/agent/handshake.ts:97-126`, `packages/d2a-client/src/handshake.ts:180-224` — Nostr message validators return `p is T`. Correct; textbook type-guard use.
- `lib/translation/cache.ts`, `lib/scoring/cache.ts`, `lib/preferences/storage.ts`, `lib/audio/storage.ts`, `contexts/content/cache.ts`, `lib/ingestion/sourceState.ts` — all storage/IDB shape validators. Correct.
- `lib/utils/errors.ts`, `lib/mediapipe/engine.ts` — `(err: unknown)` for catch handlers. Correct post-TS 4.4.
- `lib/ingestion/fetchers.ts:40,76` — fetch body payload. Correct.
- `app/api/analyze/route.ts:14,33`, `app/sw.ts:116` — external JSON input / Promise callback. Correct.
- `lib/utils/validatedLocalStorage.ts:15,36` — generic guard signature. Correct.
- `lib/api/rateLimit.ts:175` — `guardAndParse<T = Record<string, unknown>>` default. Correct (body is arbitrary until guard runs).
- `lib/api/anthropic.ts:28` — `raw: unknown` on SDK response passthrough. Correct.
- `contexts/*.tsx` catch handlers using `(err: unknown) =>` — correct.

**No lazy `unknown` found.** All boundary-justified.

---

## `@ts-expect-error` — evaluated

All 11 hits are in tests deliberately constructing invalid runtime state (missing `window`, mock window attribute shapes, SSR simulation). Keeping.

- `__tests__/contexts/filterMode.test.tsx:81` — SSR assertion, correct
- `__tests__/contexts/themeContext.test.tsx:86` — SSR assertion, correct
- `__tests__/lib/ic/agent-config.test.ts:27,53,61,69,97,127,158,173,196` — all mock-window attribute pokes with explanatory comments

No change needed.

---

## Library-level blockers

**None.** Every weak type identified in tests has a strong replacement.

---

## Plan summary

Replacements to implement:

1. `e2e/fixtures/auth-mock.ts:10` — type the `window` extension.
2. `__tests__/api/d2a-briefing.test.ts:291,302` — type `data` as `GlobalBriefingResponse`.
3. `__tests__/api/d2a-briefing-changes.test.ts:56,156` — `as unknown as D2ABriefingItem[]`; type `data` as `ChangesResponse`.
4. `__tests__/lib/d2a/briefingProvider-raw.test.ts:154` — `as unknown as bigint`.
5. `__tests__/contexts/PreferenceContext.test.tsx:8`, `PreferenceContext-edge.test.tsx:8` — `(val: unknown)`.
6. `__tests__/larp-audit-fixes.test.ts:87` — destructure-omit rather than `delete … as any`.
7. `__tests__/lib/ingestion/dedup-thorough.test.ts:127` — remove superfluous `as any`.
8. `__tests__/lib/utils/errors-extended.test.ts:110` — `as unknown as { window?: Window }`.

After all edits, run `npx tsc --noEmit --strict` and commit.
