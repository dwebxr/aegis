# Type Consolidation Evaluation

Baseline `npx tsc --noEmit` at start: **1 pre-existing casing error** in `components/layout/Sidebar.tsx` (Tooltip casing) — unrelated to types. All subsequent TS checks below must not introduce additional errors.

## Catalog of candidates

### HIGH confidence — consolidate

#### 1. `SchedulerSource` duplicated across two files
- `contexts/SourceContext.tsx:44` — exported
- `lib/ingestion/scheduler.ts:31` — local duplicate (identical shape)

Both represent the same concept (a source config handed to the ingestion scheduler). The SourceContext version is already exported and consumed by tests. Plan: define canonically in `lib/ingestion/scheduler.ts` (or re-export from SourceContext) — the scheduler owns the scheduler's input contract. Target: export from `lib/ingestion/scheduler.ts`, import in `contexts/SourceContext.tsx`.

Decision: move canonical definition into `lib/ingestion/scheduler.ts` as `export`, delete SourceContext duplicate, update SourceContext to import it.

#### 2. Inline `"quality" | "slop"` instead of the existing `Verdict` alias
- `lib/types/content.ts:1` defines `Verdict = "quality" | "slop"` (canonical)
- Spelled inline in:
  - `lib/preferences/engine.ts:20`
  - `contexts/PreferenceContext.tsx:18,19`
  - `contexts/content/types.ts:33,34` (in `PreferenceCallbacks`)
  - `lib/ingestion/quickFilter.ts:25` (inside `HeuristicScores`)
  - `lib/webllm/types.ts:14` (inside `WebLLMScoreResult`)
  - `lib/d2a/types.ts:15` (inside `D2ABriefingItem`)
  - `lib/d2a/briefingProvider.ts:53` (inside `GlobalBriefingContributor.topItems[].verdict`)

All refer to the same concept (verdict of an analyzer). Plan: replace inline unions with `Verdict` import from `@/lib/types/content`.

#### 3. Inline `syncStatus` unions
- `contexts/content/types.ts:9` uses `"idle" | "syncing" | "synced" | "offline"`
- `hooks/useTranslation.ts:32` repeats the same literal union in a parameter signature
- `__tests__/hooks/useTranslation.test.tsx:82` repeats it again

Plan: export a named type from `contexts/content/types.ts` (`ContentSyncStatus`) and import from the hook/test. (SourceContext uses a slightly different union: `...|"error"` — keep separate.)

### MEDIUM confidence — leave unless specifically requested

- `QuickAddId` in `components/tabs/SourcesTab.tsx:28` has the same literals as `SourcePlatform` in `lib/types/sources.ts:1`. Semantically similar but `QuickAddId` is a UI-local "mode" concept. Risk of coupling UI state to platform enum is low; consolidation possible but stylistic. **Skip** — risk of conflating UI state with data domain.
- `type Phase` defined three separate times (`ShareBriefingModal`, `AgentProfileEditModal`, `PullToRefresh`) — coincidentally named, different literal unions, different domains. **Skip.**
- `ScoreBreakdown`-like shapes appear in `WebLLMScoreResult`, `HeuristicScores`, `ScoreParseResult`, `AnalyzeResponse`. Each adds extra fields particular to its layer (V/C/L, heuristics reason, etc). Merging would leak concerns. **Skip.**
- `ThemeMode` redefined in `__tests__/contexts/themeContext.test.tsx:23` — local test copy; another test file already imports the shared type. Low-risk rewrite; **skip unless touching tests.**

### LOW confidence — do not touch

- `Verdict` / `ContentSource` / `ScoreBreakdown` / `ContentEvaluation` appear in both `lib/ic/declarations/aegis_backend.did.d.ts` (Candid-generated) and `lib/types/content.ts` (hand-written). The hand-written types diverge slightly (numeric fields are `number` vs Candid `bigint` for some). Task rules forbid touching generated declarations. **Skip.**
- Component `Props` interfaces (one per component) — local UI contracts, not duplicates.

## Consolidation plan

HIGH #1 — scheduler source type → single commit
HIGH #2 — Verdict reuse → single commit
HIGH #3 — sync status alias → single commit

Run `npx tsc --noEmit` after each; require error count unchanged (stays at the 1 pre-existing casing error).
