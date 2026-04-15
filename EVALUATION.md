# Circular Dependency Evaluation

Tool: `madge@8.0.0` with TS config.
Command: `npx madge --extensions ts,tsx --circular --ts-config tsconfig.json .`
Initial result: **3 circular dependencies**.

---

## Cycle 1: `lib/scoring/types.ts` <-> `lib/types/content.ts`

**Chain:**
- `lib/scoring/types.ts` -> `lib/types/content.ts` (`import type { Verdict }`)
- `lib/types/content.ts` -> `lib/scoring/types.ts` (inline `import("@/lib/scoring/types").ScoringEngine` type query on lines 35 and 69)

**Classification:** TYPE-ONLY.
Both edges are pure TypeScript type references: `import type` on the scoring side, and inline `import(...).X` type expressions on the content side. Both are erased at compile time, so there is no runtime module-init hazard. Still worth eliminating to reduce coupling and silence madge.

**Root cause:** Two sibling "types" barrels (`lib/types/content.ts` and `lib/scoring/types.ts`) each reach into each other for a single scalar type. `content.ts` needs `ScoringEngine` to annotate `ContentItem.scoringEngine`; `scoring/types.ts` needs `Verdict` to annotate `ScoreParseResult.verdict`.

**Fix plan (HIGH confidence):**
Break the scoring -> content edge by inlining `Verdict` in `scoring/types.ts` as `"quality" | "slop"`. The union is already used as a string literal in `parseResponse.ts` (line 49) and is the canonical domain value everywhere. Zero behavioral risk; one file, one line. Keeps `content.ts -> scoring/types.ts` as the one-way direction.

Alternative considered: extract `Verdict` to a new leaf module. Rejected — introduces another file for a 2-member union used in few places.

---

## Cycle 2: `lib/d2a/briefingProvider.ts` <-> `lib/d2a/types.ts`

**Chain:**
- `lib/d2a/briefingProvider.ts` -> `lib/d2a/types.ts` (`import type { D2ABriefingResponse }`)
- `lib/d2a/types.ts` -> `lib/d2a/briefingProvider.ts` (`export type { GlobalBriefingResponse, GlobalBriefingContributor } from "./briefingProvider"`)

**Classification:** TYPE-ONLY.
Both edges are `import type`/`export type` and erased at runtime.

**Root cause:** Interfaces `GlobalBriefingResponse` and `GlobalBriefingContributor` were defined alongside their only producer (`briefingProvider.ts`) rather than in the types barrel, then re-exported for public consumption. Classic "type lives with implementation, barrel re-exports, implementation still needs other barrel types" cycle.

**Fix plan (HIGH confidence):**
Move `GlobalBriefingResponse` and `GlobalBriefingContributor` interface definitions from `briefingProvider.ts` into `lib/d2a/types.ts` (their natural home alongside `D2ABriefingResponse`). Remove the re-export. `briefingProvider.ts` then imports them from `./types`. Zero runtime change; purely a relocation of type declarations.

---

## Cycle 3: `lib/filtering/types.ts` <-> `lib/filtering/serendipity.ts`

**Chain:**
- `lib/filtering/types.ts` -> `lib/filtering/serendipity.ts` (`export type { SerendipityItem, DiscoveryType } from "./serendipity"`)
- `lib/filtering/serendipity.ts` -> `lib/filtering/types.ts` (`import type { FilteredItem, FilterPipelineResult }`)

**Classification:** TYPE-ONLY.
Both edges are type-only (`import type` / `export type`).

**Root cause:** Same pattern as cycle 2. `SerendipityItem` and `DiscoveryType` are declared in the implementation file (`serendipity.ts`) instead of the types barrel, then re-exported. `serendipity.ts` legitimately needs `FilteredItem`/`FilterPipelineResult` from the types barrel.

**Fix plan (HIGH confidence):**
Move `SerendipityItem` and `DiscoveryType` from `serendipity.ts` into `lib/filtering/types.ts`. Delete the re-export. `serendipity.ts` imports them back from `./types`. Pure type relocation, no runtime change.

---

## Summary

| Cycle | Severity | Fix Confidence | Action |
| --- | --- | --- | --- |
| 1 | TYPE-ONLY | HIGH | Inline `Verdict` literal in `scoring/types.ts` |
| 2 | TYPE-ONLY | HIGH | Move global-briefing interfaces into `d2a/types.ts` |
| 3 | TYPE-ONLY | HIGH | Move `SerendipityItem`/`DiscoveryType` into `filtering/types.ts` |

All three are TYPE-ONLY (no runtime hazard) but eliminable with low-risk, narrow edits. Applying all three.
