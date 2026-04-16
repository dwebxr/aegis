# AUDIT 03: Dead Code Sweep (knip + ts-prune)

Date: 2026-04-17
Branch: worktree-agent-a15c4b03
Tools: `npx knip@latest --no-progress` and `npx ts-prune`

## Summary

The existing `knip.json` was reasonably well-configured. After verification,
**0 whole files** were safe to delete (the one flagged whole-file finding was a
false positive — see below). **2 functions** were removed from a test helper
and **24 unused exported symbols** were demoted to module-local (dropping the
`export` keyword preserves internal use).

Build (`npx next build`) and type-check (`npx tsc --noEmit`) both pass after
cleanup.

---

## Genuine dead code (deleted / un-exported)

Confidence: **HIGH** — verified with per-symbol `grep` across
`app/`, `components/`, `contexts/`, `hooks/`, `lib/`, `styles/`, `__tests__/`,
`e2e/`. Every flagged symbol had zero external consumers.

### `styles/theme.ts` — removed 7 entirely unused exports

The only theme exports imported anywhere in the codebase are `colors`,
`breakpoints`, and `scoreGrade`. Removed:

| Symbol          | Why removed                                                          |
|-----------------|----------------------------------------------------------------------|
| `fonts`         | Not imported anywhere. Font stack is applied via globals.css instead.|
| `space`         | Not imported anywhere. Spacing is done via Tailwind/inline styles.   |
| `type`          | Not imported anywhere. Only used to build the deleted `kpiLabelStyle`.|
| `shadows`       | Not imported anywhere. Shadows are inlined in components.            |
| `radii`         | Not imported anywhere.                                               |
| `transitions`   | Not imported anywhere.                                               |
| `kpiLabelStyle` | Not imported anywhere. A stale React.CSSProperties fragment.         |

File shrinks from 127 lines → 62 lines. `import type React from "react"` is
also removed since `kpiLabelStyle` was the only consumer.

### `__tests__/__helpers__/mocks.ts` — removed 2 unused mock factories

| Symbol                | Why removed                                                            |
|-----------------------|------------------------------------------------------------------------|
| `mockAgentCallbacks`  | Never imported. Tests define their own callback mocks inline.          |
| `mockAgentState`      | Never imported. Tests define their own `mockAgentState` local vars.    |

Also removed the local `AgentManagerCallbacksLike` interface and the
`ContentItem`/`UserPreferenceProfile`/`AuthorTrust`/`AgentState`/
`ActivityLogEntry` imports that only served those two factories.

`mockWoTGraph`, `mockBackendActor`, `mockHttpAgent` are used elsewhere and were
preserved.

### `contexts/SourceContext.tsx` — removed unused type re-export

`export type { SchedulerSource };` (line 18) — all consumers already import
`SchedulerSource` directly from `@/lib/ingestion/scheduler`. The re-export was
a stale alias from an earlier refactor (see README note about "deduplication").

### Unused exported types — demoted to module-local

For 16 types flagged by knip as unused exports, verified no external imports.
Changed `export interface X` / `export type X` to `interface X` / `type X`
(type is still used inside its declaring module).

| File                             | Symbol(s) un-exported                         |
|----------------------------------|-----------------------------------------------|
| `components/ui/BurnedItemsDrawer.tsx` | `BurnedItemsDrawerProps`                 |
| `lib/api/anthropic.ts`           | `CallAnthropicOptions`, `AnthropicResponse`   |
| `lib/api/byok.ts`                | `ByokResolution`                              |
| `lib/audio/mediaSession.ts`      | `MediaSessionHandlers`                        |
| `lib/audio/webspeech.ts`         | `SpeakChunkOptions`                           |
| `lib/d2a/filterItems.ts`         | `BriefingFilterParams`, `PaginatedBriefingResponse` |
| `lib/d2a/peerStats.ts`           | `PeerStat`                                    |
| `lib/dashboard/utils.ts`         | `DashboardActivityStats`, `TopicDistEntry`    |
| `lib/feed/buildFeed.ts`          | `BuildFeedOptions`                            |
| `lib/feed/serveFeed.ts`          | `FeedFormat`                                  |
| `lib/ingestion/quickFilter.ts`   | `HeuristicScores`, `HeuristicOptions`         |
| `lib/ingestion/sourceState.ts`   | `SourceHealth`                                |
| `lib/mediapipe/types.ts`         | `MediaPipeModelDef`                           |
| `lib/offline/actionQueue.ts`     | `QueuedActionType`, `QueuedAction`            |
| `lib/onboarding/state.ts`        | `OnboardingState`, `OnboardingStep`           |
| `lib/sources/catalog.ts`         | `CatalogSource`                               |
| `lib/sources/platformFeed.ts`    | `PlatformFeedResult`                          |
| `lib/translation/validate.ts`    | `ValidationResult`                            |
| `lib/utils/statusEmitter.ts`     | `StatusEmitter`                               |

Total: **24 type symbols** (knip's count of 26 includes `BurnedItemsDrawerProps`
and `SchedulerSource` which were handled above, so all 26 findings are
addressed).

---

## False positives (documented, not deleted)

### `app/sw.ts` — Serwist service worker source (KEEP)

knip flags this as an unused file because it cannot follow the string reference
`swSrc: "app/sw.ts"` inside `next.config.mjs`'s `withSerwist(...)` call.

`next.config.mjs` already has a warning comment noting this static-analysis
blind spot. File is actively used at build time (Serwist bundles it into
`public/sw.js`). **`knip.json` updated to ignore this file** so future runs
don't re-flag it.

### `serwist` package (KEEP)

knip flags the `serwist` dependency as unused because its only importer
(`app/sw.ts`) is excluded from analysis as noted above. Verified via
`next build` — serwist is wired into the webpack config via `withSerwist` and
bundles `app/sw.ts` into `public/sw.js`. **Added to `ignoreDependencies`.**

### `ts-prune` whole-icon false positives

ts-prune flags every individual icon in `components/icons/index.tsx`
(`ShieldIcon`, `FireIcon`, etc. — 23 symbols) as "only used in module".
Verified with grep: every single icon has 2-13 external consumers across
`app/`, `components/`, `__tests__/`. This appears to be a limitation of
ts-prune's barrel-file heuristic. knip correctly does **not** flag these.

### ts-prune framework convention false positives (37 symbols)

ts-prune flags every Next.js / Sentry / Playwright framework entrypoint:
`app/**/page.tsx default`, `maxDuration`, `metadata`, `viewport`,
`generateMetadata`, `revalidate`, `dynamic`, `onRouterTransitionStart`,
`register`, `onRequestError`, `playwright.config.ts default`, etc.

These are framework conventions — Next.js / Playwright / Sentry import them by
convention, not by explicit `import` statement. knip is aware of these and
correctly does **not** flag them.

### ts-prune IC declarations (20 symbols)

ts-prune flags all Candid-generated types in `lib/ic/declarations/`. These are
imported via the `_SERVICE` interface generated by `dfx generate`. `knip.json`
already excludes this directory. **Kept as-is.**

### ts-prune mock helpers flagged as "used in module"

`mockWoTGraph`, `mockBackendActor`, `mockHttpAgent` are flagged by ts-prune as
"used in module" — false. Verified grep: all three have 3-7 external consumers
in `__tests__/lib/*`. Kept.

### knip "Unlisted dependencies" (4 packages)

| Package               | Status                                                            |
|-----------------------|-------------------------------------------------------------------|
| `glob`                | Transitive via `@types/glob`; used in 2 test files. Not dead.     |
| `@sentry/core`        | Transitive via `@sentry/nextjs`; used in 1 test file. Not dead.   |
| `postcss-load-config` | Transitive via `postcss`; referenced in `postcss.config.mjs`.     |

These are hygiene warnings about missing explicit declarations, not dead code.
Out of scope for this sweep; a follow-up could add them to `devDependencies`
for explicitness.

### knip "Unlisted binary"

`scripts/audit-guard.sh` — referenced by package.json's `audit:guard` script
but no binary entry in deps. It's a local shell script; not a dead-code issue.

---

## Config updates to `knip.json`

1. Added `app/sw.ts` to `ignore` (serwist string reference).
2. Added `serwist` to `ignoreDependencies` (same reason).

No other config changes — the existing entry patterns are correct and the
knip-suggested "redundant entry pattern" hints for Next.js/Sentry/Jest config
files are better left explicit for documentation value.

---

## Verification

- `npx tsc --noEmit` — **clean**, no errors
- `npx next build` — **success**, 26 routes generated, no TS/build errors
- `npx knip --no-progress` — remaining flags are only the documented false
  positives (4 unlisted transitive deps + 22 configuration hints)

---

## Counts

| Category                    | Count |
|-----------------------------|-------|
| Whole files deleted         | 0     |
| Whole files flagged as unused but kept (false positive) | 1 (`app/sw.ts`) |
| Exported consts removed     | 7 (`styles/theme.ts`) |
| Exported functions removed  | 2 (`mockAgentCallbacks`, `mockAgentState`) |
| Re-exports removed          | 1 (`SchedulerSource` from SourceContext) |
| Exported types demoted to internal | 24 |
| Lines removed               | ~130 |
