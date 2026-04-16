# Audit 02 — Type Definition Consolidation

Date: 2026-04-17
Branch: `worktree-agent-ad7029a2`
Baseline `npx tsc --noEmit`: verified clean before consolidation (captured in pre-flight check).

## Scope

- In scope: `/app`, `/contexts`, `/hooks`, `/lib` (excluding `/lib/ic/declarations/`), `/components`, `/__tests__`.
- Excluded by task: `/canisters/**` (Motoko), `/lib/ic/declarations/**` (generated Candid), `/packages/d2a-client/**` (standalone published SDK; `tsconfig.json` already excludes `packages/**`).
- Component `*Props` interfaces: verified local-only; kept in place.

## Catalog of candidates

### HIGH confidence — consolidate

#### H1. `WebLLMScoreResult` duplicates `ScoreParseResult`

- Canonical: `lib/scoring/types.ts:38` — `ScoreParseResult`
- Duplicate: `lib/webllm/types.ts:11` — `WebLLMScoreResult`

Shapes are byte-identical except `verdict: Verdict` vs inline `"quality" | "slop"`. Callers:
- `lib/webllm/engine.ts:2,73` imports `WebLLMScoreResult` as the return of `scoreWithWebLLM`.
- No external references; only the engine module uses this type name.

**Plan:** delete `WebLLMScoreResult` from `lib/webllm/types.ts`; update `lib/webllm/engine.ts` to import `ScoreParseResult` from `@/lib/scoring/types`. Same shape, lossless.

**Risk:** None. Purely renaming a local alias.

---

#### H2. Inline `"quality" | "slop"` literal unions should reuse `Verdict`

`Verdict` is canonically defined at `lib/types/content.ts:1`. Inline spellings remain in:

- `lib/scoring/types.ts:43` (inside `ScoreParseResult`)
- `lib/scoring/parseResponse.ts:49` (local const annotation)
- `contexts/content/scoring.ts:157` (IC→local verdict coercion)

**Plan:** replace inline union with `Verdict` import. Import already exists in some of these files; add where missing.

**Risk:** None — the `Verdict` alias is exported and stable; no semantic drift.

Note: `lib/scoring/prompt.ts:35` embeds the literal inside a prompt string, and `lib/dashboard/utils.ts:23` defines `VerdictFilter = "all" | "quality" | "slop" | "validated" | "bookmarked"` which has extra members — both left alone (not the same type).

---

#### H3. Inline `ContentSyncStatus` union re-spelling

Canonical: `contexts/content/types.ts:8` — `export type ContentSyncStatus = "idle" | "syncing" | "synced" | "offline"`.

Re-spelled literally in:
- `contexts/ContentContext.tsx:58` (useState generic)
- `contexts/content/icSync.ts:124,147,203` (setter parameter)
- `__tests__/hooks/useTranslation.test.tsx:82,363,440` (test harness parameter)

**Plan:** import `ContentSyncStatus` and use it instead.

**Risk:** None — `hooks/useTranslation.ts` already uses it; we are just propagating the existing alias.

Note: `SourceContext.tsx:49,83` has a *different* union `"idle" | "syncing" | "synced" | "error"` (terminal state is "error", not "offline") — semantically distinct, **do not merge**.

---

#### H4. `scoreItemWithHeuristics` local `raw` parameter duplicates `RawItem`

- Canonical: `lib/ingestion/fetchers.ts:3` — `RawItem { text, author, avatar?, sourceUrl?, imageUrl?, nostrPubkey? }`
- Duplicate inline: `lib/filtering/pipeline.ts:87` — same shape spelled inline as a parameter type.

All real callers (`lib/ingestion/scheduler.ts:251`, tests) already construct a `RawItem`. Tests pass literals that structurally match (`{ text, author, ... }`), so inlining `RawItem` loses nothing and gains a named contract.

**Plan:** change parameter type to `RawItem`.

**Risk:** Very low. Structural typing means existing literals still satisfy `RawItem`. Worth watching for any test passing extra fields not in `RawItem` — there are none.

---

### MEDIUM confidence — leave

- `HeuristicScores` vs `ScoreParseResult` vs `AnalyzeResponse` — all have `originality/insight/credibility/composite` but the surrounding fields differ (heuristic has `detectedLang`, parse has `topics/vSignal/cContext/lSlop` required, analyze has them optional). Different layers, different invariants. **Skip.**
- `D2ABriefingItem.scores` inline object vs `ScoreBreakdown + v/c/lSlop` — could be expressed as `ScoreBreakdown & { v/c/lSlop? }`, but `D2ABriefingItem` is a wire format (D2A protocol v1.0). Locking it to an imported type risks future drift if scoring fields change. **Skip** to keep wire contract explicit.
- `RssResponse`, `NostrResponse`, `UrlResponse`, `FarcasterResponse` in `lib/ingestion/fetchers.ts:82,119,154,183` vs the `FetchXResponse` types in `lib/types/api.ts`. The fetchers' local shapes are intentionally permissive (all fields optional) to tolerate server drift. The `lib/types/api.ts` shapes express the authoritative route output. Different contract sides — **do not unify.**

### LOW confidence — do not touch

- `Verdict`, `ContentSource`, `ScoreBreakdown`, `ContentEvaluation` are redeclared in `lib/ic/declarations/aegis_backend.did.d.ts` — **generated Candid**, explicitly excluded from task scope. Hand-written types in `lib/types/content.ts` intentionally diverge (`number` vs Candid `bigint` for timestamps and counters).
- `AgentProfile`, `HandshakeState`, `D2AMessage` etc. appear in both `lib/agent/types.ts` and `packages/d2a-client/src/types.ts`. The `packages/d2a-client` is a standalone npm package (`@aegis/d2a-client`) excluded from the app tsconfig. Merging would break the SDK's self-containment. **Do not touch.**
- Component `*Props` interfaces — all verified single-file local types.
- `type Phase` in three different modals — coincidentally named, disjoint literal unions. Not duplicates.

## Consolidation plan

Commit as a single `refactor(types)` change (small-blast-radius, easy to revert):

1. H1: replace `WebLLMScoreResult` with `ScoreParseResult` in `lib/webllm/*`.
2. H2: replace three `"quality" | "slop"` inline unions with `Verdict`.
3. H3: replace five inline `ContentSyncStatus` unions (3 in `icSync.ts`, 1 in `ContentContext.tsx`, 3 in tests) with the existing alias.
4. H4: tighten `scoreItemWithHeuristics` parameter to `RawItem`.

Post-change: `npx tsc --noEmit` must remain clean. Any error that isn't fixable safely → revert that item only.
