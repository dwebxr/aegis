# Unused Code Evaluation

Tool: knip 6.4.1 (config at `knip.json`)
Date: 2026-04-15

## Knip raw findings summary

- 18 unused files (all in `components/ui/` plus `app/sw.ts`)
- 5 files with unused exports
- 18 files with unused types
- 4 unused dependencies, 2 unused devDependencies
- 2 unlisted dependencies (transitive — ignore)

## Per-item evaluation

### Unused files

| File | Confidence | Reason |
|------|------------|--------|
| `app/sw.ts` | **LOW (false positive)** | Used by `next.config.mjs` as `swSrc` for `@serwist/next` PWA. Knip can't follow config-string references. KEEP. |
| `components/ui/Tooltip.tsx` | **LOW (false positive)** | macOS filesystem is case-insensitive: code imports `@/components/ui/tooltip` which resolves to this file on macOS/Windows. (The shadcn tooltip component.) Renaming risks breaking on case-sensitive FS. KEEP. |
| `components/ui/avatar.tsx` | **HIGH** | `grep -r '@/components/ui/avatar'` returns no matches. Never imported. |
| `components/ui/badge.tsx` | **HIGH** | No references. |
| `components/ui/card.tsx` | **HIGH** | No references. |
| `components/ui/command.tsx` | **HIGH** | No references. Uses `cmdk` dep. CommandPalette.tsx is a custom implementation, not from shadcn. |
| `components/ui/dropdown-menu.tsx` | **HIGH** | No references. |
| `components/ui/input.tsx` | **HIGH** | No references. |
| `components/ui/label.tsx` | **HIGH** | No references. |
| `components/ui/popover.tsx` | **HIGH** | No references. |
| `components/ui/scroll-area.tsx` | **HIGH** | No references. |
| `components/ui/select.tsx` | **HIGH** | No references. |
| `components/ui/separator.tsx` | **HIGH** | No references. |
| `components/ui/sheet.tsx` | **HIGH** | No references. |
| `components/ui/skeleton.tsx` | **HIGH** | No references. |
| `components/ui/switch.tsx` | **HIGH** | No references. |
| `components/ui/tabs.tsx` | **HIGH** | No references. |
| `components/ui/textarea.tsx` | **HIGH** | No references. |

### Unused exports

| File : export | Confidence | Reason |
|---------------|------------|--------|
| `lib/nostr/publish.ts : RELAY_FLUSH_MS` | **HIGH** | Grep shows external consumers use `_setRelayFlushMs`, never `RELAY_FLUSH_MS` directly. Internal use only. Drop `export` keyword. |
| `lib/ic/agent.ts : isLocal` (re-export) | **HIGH** | Consumers import `isLocal` from `@/lib/ic/config` directly. The re-export from `agent.ts` has no external consumer. Drop the re-export. |
| `styles/theme.ts : fonts, space, type, shadows, radii, transitions, kpiLabelStyle` | **MEDIUM** | Design-system module — public API by convention. Could be used by future components. KEEP. |
| `components/icons/index.tsx : ChevronDownIcon` | **HIGH** | Defined but never referenced. (`select.tsx` imports from `lucide-react`, different symbol.) |
| `components/icons/index.tsx : DiscordIcon, MediumIcon, XIcon` | **LOW (false positive)** | Used internally via `socialIconMap`. Drop `export` keyword (or leave — cheap). Leaving as-is. |
| `components/ui/dialog.tsx : DialogClose, DialogDescription, DialogFooter, DialogOverlay, DialogPortal, DialogTrigger` | **HIGH** | Only `command.tsx` used some of these; deleting command.tsx removes last consumer. GlossaryModal only uses `Dialog, DialogContent, DialogHeader, DialogTitle`. |

### Unused types

All the below are types exported from their defining file but only consumed internally. Removing `export` is safe but low-value; the types represent module API surface that may document intent for future consumers.

| File : type | Confidence | Action |
|-------------|------------|--------|
| `lib/ingestion/sourceState.ts : SourceHealth` | MEDIUM | Public-looking type, used as function return. KEEP. |
| `lib/ingestion/quickFilter.ts : HeuristicScores, HeuristicOptions` | MEDIUM | Public-looking API. KEEP. |
| `contexts/SourceContext.tsx : SchedulerSource` | MEDIUM | Context public type. KEEP. |
| `lib/onboarding/state.ts : OnboardingState, OnboardingStep` | MEDIUM | Public types. KEEP. |
| `lib/d2a/filterItems.ts : BriefingFilterParams, PaginatedBriefingResponse` | MEDIUM | Used by API layer. KEEP. |
| `lib/d2a/briefingProvider.ts : GlobalBriefingContributor, GlobalBriefingResponse` | MEDIUM | Module-level public API. KEEP. |
| `lib/d2a/types.ts : re-export GlobalBriefingResponse, GlobalBriefingContributor` | **HIGH** | Re-export never consumed; callers hit briefingProvider directly. |
| `lib/filtering/types.ts : re-export SerendipityItem, DiscoveryType` | **HIGH** | Re-export never consumed; callers hit serendipity.ts directly. |
| `lib/audio/webspeech.ts : SpeakChunkOptions` | MEDIUM | KEEP. |
| `lib/offline/actionQueue.ts : QueuedActionType, QueuedAction` | MEDIUM | Public-looking API. KEEP. |
| `lib/dashboard/utils.ts : DashboardActivityStats, TopicDistEntry` | MEDIUM | KEEP. |
| `lib/sources/catalog.ts : CatalogSource` | MEDIUM | KEEP. |
| `lib/sources/platformFeed.ts : PlatformFeedResult` | MEDIUM | KEEP. |
| `lib/audio/mediaSession.ts : MediaSessionHandlers` | MEDIUM | KEEP. |
| `lib/d2a/peerStats.ts : PeerStat` | MEDIUM | KEEP. |
| `lib/mediapipe/types.ts : MediaPipeModelDef` | MEDIUM | KEEP. |
| `lib/translation/validate.ts : ValidationResult` | MEDIUM | KEEP. |
| `lib/utils/statusEmitter.ts : StatusEmitter` | MEDIUM | KEEP. |

### Unused dependencies

| Dep | Confidence | Reason |
|-----|------------|--------|
| `@dfinity/candid` | MEDIUM | Not imported in source, but transitive of `@dfinity/agent`. Explicit declaration may be intentional for version pinning. KEEP. |
| `@dfinity/identity` | MEDIUM | Same rationale. KEEP. |
| `cmdk` | **HIGH** | Only used by `components/ui/command.tsx` which is being removed. |
| `serwist` | **LOW (false positive)** | Imported by `app/sw.ts` (PWA worker source). KEEP. |
| `@testing-library/dom` | MEDIUM | Peer dep of `@testing-library/react`; explicit pin is defensive. KEEP. |
| `eslint` | **LOW (false positive)** | Required by `next lint` / eslint-config-next. KEEP. |

### Unlisted (ignore)

- `postcss.config.mjs : postcss-load-config` — Next.js internal.
- `__tests__/lib/translation/engine-sentry-types.test.ts : @sentry/core` — transitive via `@sentry/nextjs`.

## Action Plan

**DELETE (HIGH):**
1. 16 unused shadcn UI files: `avatar, badge, card, command, dropdown-menu, input, label, popover, scroll-area, select, separator, sheet, skeleton, switch, tabs, textarea`
2. After (1), remove unused exports from `components/ui/dialog.tsx` (DialogClose/Description/Footer/Overlay/Portal/Trigger)
3. Remove `export` from `lib/nostr/publish.ts : RELAY_FLUSH_MS`
4. Remove `isLocal` re-export from `lib/ic/agent.ts`
5. Remove `ChevronDownIcon` from `components/icons/index.tsx`
6. Remove re-export line from `lib/d2a/types.ts`
7. Remove re-export line from `lib/filtering/types.ts`
8. Remove `cmdk` from package.json

**KEEP (LOW/MEDIUM):** Everything else.
