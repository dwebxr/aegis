# AUDIT 07 — Legacy / Deprecated / Fallback Code

Scope: Hunt across the codebase for deprecated, legacy, and fallback code paths.
Distinguish truly dead code from load-bearing defensive fallbacks that must stay.

---

## Findings

### HIGH — Remove

| # | File | Lines | Category | Evidence | Action |
|---|------|-------|----------|----------|--------|
| L1 | `components/ui/LegacyTooltip.tsx` | whole file | legacy | Only consumer is `__tests__/components/ui/Tooltip.test.tsx`. Production uses Radix `@/components/ui/tooltip`. Filename explicitly tagged `Legacy`. | DELETE file + test |
| L2 | `styles/theme.ts` | 4 (`fonts`), 64 (`space`), 69 (`type`), 85 (`shadows`), 98 (`radii`), 103 (`transitions`), 110 (`kpiLabelStyle`) | dead exports | knip reports unused; grep confirms only `colors`, `scoreGrade`, `breakpoints` are imported from this file anywhere in the tree. Internal references (from `kpiLabelStyle` → `type.kpiLabel`) also drop. | DELETE 7 exports + internal deps |

### MEDIUM — Left alive (intentional)

| # | File | Reason it stays |
|---|------|-----------------|
| M1 | `canisters/aegis_backend/main.mo` — `ContentEvaluationV1`, `ContentEvaluationV2`, `stableEvaluations`, `stableEvaluationsV2` | Persistent-actor `let`/stable-var fields CANNOT be renamed or removed without a deploy failure (M0169). Body already writes empty arrays, so the fields are zero-cost on disk. User memory explicitly flags this. |
| M2 | `canisters/aegis_backend/main.mo:195` — comment "V1/V2 migration branches removed" | Comment is accurate history. Fields are load-bearing (see M1). Leave. |
| M3 | `lib/filtering/pipeline.ts:37` — `item.scoredByAI ?? !item.reason?.startsWith("Heuristic")` | Load-bearing: on-chain historical evaluations predate the `scoredByAI` field; the coalescing branch correctly classifies them. Removing breaks filtering of all pre-field content. |
| M4 | `lib/scoring/prompt.ts:22` — "Also score the legacy axes: originality / insight / credibility" | The O/I/C axes are still live — canister Motoko `ScoreBreakdown` type, the public `/api/d2a/info` contract, stored evaluations on IC, and the `WhyFilteredModal` UI all depend on them. Labeling them "legacy" is historical but the axes themselves are active. |
| M5 | `app/api/d2a/info/route.ts:62` — `legacy:` block | Public API documentation exposing O/I/C for external consumers. Breaks third-party D2A clients if removed. |
| M6 | `components/ui/WhyFilteredModal.tsx:114` — "O/I/C breakdown (legacy)" | User-facing transparency UI for pre-v3 stored items. The underlying fields on the IC canister are still served. |
| M7 | `lib/storage/migrate.ts` — localStorage→IDB migration | Per-browser one-shot migration flagged via `aegis-idb-migrated-v1`. Still reachable for any new/cleared client. Removing risks orphaning data for users who haven't migrated yet. |
| M8 | `lib/translation/prompt.ts:249-257` — JSDoc `legacy maxLength parameter` | Tests exercise the 4-arg form; removing the parameter breaks 20+ tests and changes an exported API shape. Low value. |
| M9 | `app/api/analyze/route.ts:118`, `app/api/fetch/url/route.ts:95`, `app/api/fetch/ogimage/route.ts:83` — "Single mode (backward compatible)" | These are the primary non-batch code paths still called by the front-end. Not dead — the batch/single duality is load-bearing. |
| M10 | `contexts/content/scoring.ts` — 6-tier cascade (Ollama → WebLLM/MediaPipe → BYOK → IC → Server → Heuristic) | Every tier is gated by a real user setting (`isOllamaEnabled()`, `isWebLLMEnabled()`, `isMediaPipeEnabled()`, `getUserApiKey()`) or a legitimate defensive fallback. Grep'd each flag — all are set from user config. No dead tiers. |
| M11 | `app/api/d2a/briefing/route.ts:13` — `X402_FREE_TIER_ENABLED` env gate | Documented feature flag (README, openapi.yaml, 2 test files). Not dead. |
| M12 | `app/sw.ts` — flagged unused by knip | `next.config.mjs` loads it via `withSerwist({ swSrc: "app/sw.ts" })`. Knip can't follow string-based configs. Load-bearing (PWA service worker). |
| M13 | `@dfinity/identity`, `serwist`, `eslint`, `@testing-library/dom` — flagged by knip | Prior audit (.claude/evaluations/03-unused-code.md) already concluded KEEP. Indirect / peer deps. |
| M14 | Various `BurnedItemsDrawerProps`, `CallAnthropicOptions`, … unused type exports | Used locally as type arguments; `export` keyword is semantic self-documentation. Not legacy; low-risk; out of scope. |
| M15 | `app/globals.css:232-244` — `--color-*` CSS vars labeled "legacy" | Actively used (62 occurrences across 8 files). Label is wrong; content is live. |

### LOW — Not found

- No `@deprecated` JSDoc in source.
- No `*Legacy`, `*V1`, `*V2`, `*Compat`, `*Fallback` function names outside the LegacyTooltip file.
- No v1/v2 API route folders — current app router is single-level clean.

---

## Summary

The codebase has already been aggressively cleaned (see git log: "remove AI slop",
"remove unused exports", "drop dead code", knip integration, 8-agent parallel sweep).
Remaining "legacy" markers are mostly:
1. Historical labels on still-live features (O/I/C axes, legacy CSS vars) — required for
   backward compat with on-chain data and/or the public API contract.
2. Persistent-actor stable-var fields that CANNOT be removed without breaking upgrades.
3. Defensive fallbacks (scoring cascade, storage migration, null-coalescing) that are
   load-bearing by design.

Clear high-confidence removals limited to:
- `components/ui/LegacyTooltip.tsx` + its test
- 7 unused exports from `styles/theme.ts`
