# AUDIT 04: Circular Dependencies

**Date:** 2026-04-17
**Branch:** worktree-agent-a989da9e
**Scope:** All TypeScript/TSX files under `/app`, `/contexts`, `/lib`, `/components`, `/hooks`, and siblings
**Tool:** `madge` (v8.x via `npx`)

## TL;DR

**Zero circular dependencies detected.** The codebase is cleanly layered. No fixes were applied because no cycles exist. Recommendation: add a pre-push or CI check to keep it that way.

## Commands run

```
npx madge --circular --extensions ts,tsx .
# -> Processed 728 files (3.8s). No circular dependency found.

npx madge --circular --extensions ts,tsx --ts-config ./tsconfig.json app contexts lib
# -> Processed 257 files (1.5s). No circular dependency found.

npx madge --circular --extensions ts,tsx --ts-config ./tsconfig.json .
# -> Processed 728 files (4.0s). No circular dependency found.
```

Raw outputs captured at `/tmp/madge-before.txt`, `/tmp/madge-before-tsconfig.txt`, `/tmp/madge-full-tsconfig.txt`.

## Cross-check: manual DFS over madge graph

Because the `madge` CLI emits only a summary line, I also exported the full dependency graph as JSON (`npx madge --json --ts-config ./tsconfig.json .`) and ran a Tarjan-lite DFS over it to independently confirm there are no back-edges.

```
Total nodes: 728
Cycles found: 0
```

Restricted to `app contexts lib` (257 nodes): also 0 cycles.

## Structural spot-check (ContentContext chain)

The task flagged `/contexts/ContentContext.tsx` and its `/contexts/content/*` sub-modules as a likely hotspot. I verified by hand:

- `/contexts/content/cache.ts` imports only from `@/lib/types/content`, `@/lib/utils/errors`, `@/lib/storage/idb`.
- `/contexts/content/dedup.ts` imports only `@/lib/types/content`.
- `/contexts/content/icSync.ts` imports only from `@/lib/*` (types, utils, scoring/types, offline/actionQueue, ic/declarations) and `@sentry/nextjs`.
- `/contexts/content/scoring.ts` imports only from `@/lib/*` (types, preferences/types, ic/declarations, utils, apiKey, webllm, mediapipe, ollama, scoring/cache, ic/icLlmConcurrency, ic/icLlmCircuitBreaker) and `@sentry/nextjs`.
- `/contexts/content/types.ts` imports only types from `@/lib/types/*`, `@/lib/preferences/types`, `@/lib/briefing/types`.

None of these sub-modules imports back into `/contexts/ContentContext.tsx` or any peer `/contexts/*` module, so the layered boundary holds: `ContentContext (orchestrator) -> content/* (leaves) -> lib/* (utilities & types)`.

## Why the codebase appears cycle-free

Patterns observed that keep the graph acyclic:

1. **Dedicated type-only leaves.** Shared types live in `/lib/types/*`, `/contexts/content/types.ts`, `/lib/preferences/types.ts`, `/lib/briefing/types.ts`, `/lib/d2a/types.ts`, `/lib/agent/types.ts`, `/lib/nostr/types.ts`. These files are imported by feature code but import nothing from feature code.
2. **No barrel re-exports linking peers.** `/lib/ic/declarations/index.ts` is the generated Candid barrel (explicitly excluded from this audit) and is a leaf consumer of `.did.js`.
3. **Context modules are consumers, not peers.** `AuthContext`, `ContentContext`, `PreferenceContext`, `AgentContext`, etc. all depend on `/lib/*` one-way. They don't import each other in ways that loop; e.g. `ContentContext` reads auth via hook from `AuthContext` but `AuthContext` does not import `ContentContext`.
4. **App routes (`/app/api/*`) are top-level consumers** of `/lib/*` only.

## Cycles evaluated

| # | Cycle | Root cause | Proposed fix | Confidence | Risk |
|---|-------|------------|--------------|------------|------|
| -- | none detected | n/a | n/a | High | None |

## Intentionally untouched

- `/canisters/` — Motoko, out of scope.
- `/lib/ic/declarations/` — dfx-generated Candid bindings.

## Verification after "fix" (no-op)

Since no cycles were found, no code changes were made. Nonetheless:

- `npx madge --circular --extensions ts,tsx .` -> still 0 cycles.
- `npx tsc --noEmit` -> clean (no output = success).

## Recommendation (not applied here)

Add a lightweight CI guard to prevent regressions:

```
"scripts": {
  "check:cycles": "madge --circular --extensions ts,tsx --ts-config ./tsconfig.json app contexts lib"
}
```

and invoke in pre-push or CI. This is low-cost (runs in <2s on 257 files) and catches the regression class early, where it's cheap to fix.
