# AUDIT_08: AI SLOP, STUBS, LARP, UNHELPFUL COMMENTS

Scope: `/app`, `/contexts`, `/lib`, `/canisters`. Tests and `/components` excluded except where directly coupled to a source finding.

## Executive summary

The codebase has been aggressively cleaned by prior audit passes (see recent commits: "remove AI slop", "LARP findings", "resolve gaps"). Most comments that remain are genuine WHY — iOS Safari quirks, DFINITY LLM byte caps, Llama 3.1 8B model tics, persistent actor field rules, unicode regex workarounds, env-var trailing-newline gotchas. No `TODO` / `FIXME` / `XXX` / `HACK` markers remain. No obvious stub functions. No commented-out code blocks.

**Real bug found**: one LARP (Background Sync handler in the service worker calls a non-existent API route).

Total actions this pass:
- **Comments deleted**: 9
- **Comments rewritten** (tight WHY): 3
- **LARP fix (code)**: 1 (removed dead service-worker Background Sync handler + its caller + associated tests)
- **Comments deliberately kept** as real WHY: ~180+ across the codebase (unicode regex workarounds, iOS Safari 150-char utterance bug, DFINITY 10 KiB prompt cap, Motoko persistent-actor migration rules, @noble/hashes `.js` suffix, Llama 3.1 8B meta-commentary patterns, test seams, etc.)

---

## HIGH severity: LARP bug

### `app/sw.ts` + `lib/offline/actionQueue.ts` — Background Sync is dead code
**Category**: LARP (security-/correctness-theatre — looks like it handles offline replay; actually never works)
**Confidence**: High

**What it claimed**: The service worker listened for `sync` events with tag `aegis-offline-queue` and attempted to replay queued IC evaluations by POSTing each action to `/api/offline-sync`. `actionQueue.enqueueAction()` registered the sync tag after every enqueue.

**What actually happened**: `/api/offline-sync` does not exist (verified — there is no `app/api/offline-sync/` directory; `Grep` finds only the 404-bound fetch in `sw.ts`). Every SW-triggered replay would hit a 404 and land in the silent `catch { /* Will retry on next sync event */ }` block, leaving the actions forever enqueued until the user happened to come back online (at which point the real client-side drain in `contexts/content/icSync.ts::drainOfflineQueue` — triggered by `useOnlineStatus` — actually does the work). The SW path was thus a no-op wrapped in convincing scaffolding.

**Action taken**: Removed the entire `drainOfflineQueueFromSW` function and the `sync` event listener from `app/sw.ts`. Removed the SyncManager registration from `enqueueAction` in `lib/offline/actionQueue.ts`. Removed the three now-stale tests in `__tests__/lib/offline/actionQueue-sync.test.ts` that exercised the registration path. The real drain path (online-event + IC actor creation) is untouched and remains the sole replay mechanism.

---

## Slop / unhelpful comments — deleted

| Location | Category | Original | Action |
|---|---|---|---|
| `app/api/analyze/route.ts:80` | slop (decorative divider) | `// --- Batch mode ---` | Deleted |
| `app/api/analyze/route.ts:118` | slop (decorative divider) | `// --- Single mode (backward compatible) ---` | Deleted |
| `app/api/fetch/url/route.ts:71` | slop (restates `if (urls && Array.isArray(urls))`) | `// Batch mode: accept array of URLs` | Deleted |
| `app/api/fetch/ogimage/route.ts:68` | slop (restates code) | `// Batch mode: accept array of URLs, return results for all` | Deleted |
| `app/api/fetch/ogimage/route.ts:83` | slop | `// Single mode (backward compatible)` | Deleted |
| `canisters/aegis_backend/main.mo:867` | slop | `// Save the signal` | Deleted |
| `contexts/content/cache.ts:93` | slop (restates catch body) | `// Fallback: attempt localStorage write when IDB fails` | Deleted |
| `lib/reputation/publishGate.ts:67` | slop (section divider, not useful in 140-line file) | `// Recovery` | Deleted |
| `lib/reputation/publishGate.ts:82` | slop | `// Gate check` | Deleted |

## Comments rewritten (trimmed bloat, kept WHY)

| Location | Before | After |
|---|---|---|
| `canisters/aegis_backend/main.mo:1213` | `// Check if this signal's stake was returned (= validated)` | `// #returned status = stake was returned, treat as community-validated` (renamed for precision — the `=` gloss was borderline useful, new form ties directly to the switch arm below) |
| `contexts/content/icSync.ts:88-95` | 8-line block citing test name by title | 3-line block listing the affected fields + the scoringEngine downgrade rule |
| `app/api/fetch/url/route.ts:95` (kept) | `// Single mode (backward compatible — preserves exact status codes)` | Retained — the parenthetical is real WHY, explains an observable contract difference |

## Comments deliberately KEPT as real WHY (representative sample)

These capture hidden constraints or project-specific gotchas. Stripping them would cost more than keeping them.

- `lib/audio/webspeech.ts` (entire file): iOS Safari 150-char `onend` bug, voice-list lazy loading, user-gesture unlock requirement — all user-memory-level gotchas
- `lib/audio/types.ts:19-21`: iOS chunking constraint — explicitly cited as driving the `chunks` design
- `lib/audio/engine.ts:12-26`: state-machine diagram for a nontrivial session lifecycle; 165-167 Safari iOS `onend` / `onerror` quirk
- `lib/translation/prompt.ts` (multiple blocks): Llama 3.1 8B meta-commentary patterns; DFINITY 10 KiB envelope cap; Japanese 敬体 prompt rationale; "why strip from the top" walkthrough — each block encodes a non-obvious tuning decision
- `lib/translation/validate.ts:4-17, 49-55, 131-134`: MIN/MAX ratio bounds with empirical observations; kana-presence-is-necessary rationale
- `lib/ic/icLlmCircuitBreaker.ts:1-20`: empirical 3-concurrent-call-rejection discovery (not in canister README)
- `lib/ic/icLlmConcurrency.ts:1-16`: same empirical gotcha, separate module — both worth keeping
- `lib/ingestion/heuristics/common.ts:15-18`: unicode regex via `new RegExp(string, "u")` — per user memory, TS target compatibility workaround
- `lib/utils/hashing.ts:1`: `@noble/hashes/sha2.js` suffix — user-memory-noted import rule
- `canisters/aegis_backend/main.mo:195-196, 48-98, 142-160`: V1/V2/V3 migration branches with explanation that stable vars cannot be renamed (Motoko persistent actor field layout rule); `initCertCache()` with "bypasses persistent actor stale let" (user-memory-noted deploy issue with `aegis-ai.xyz`)
- `app/api/translate/route.ts:9-30`: BYOK-only boundary enforcement rationale (ties to a specific hotfix number — real WHY, not "refactored to X")
- `app/page.tsx:68, 97-98, 117-119, 229-230`: sessionStorage SSR/private-mode safety, Web Share Target + Deep Link flow documentation
- `contexts/AuthContext.tsx:67-68, 148`: test-mock injection rationale, cross-context session-expired event listener
- `lib/filtering/serendipity.ts:68, 76-78`: V_signal/C_context scoring rationale — encodes a product-level meaning, not what the code does
- `hooks/useKeyboardNav.ts:108`: data attribute fallback for collapsed cards (real UI state coupling)
- `app/api/fetch/discover-feed/route.ts:39, 97`: "Step 1"/"Step 2" label a two-stage strategy — each stage is 40+ lines and the numbering is the strategy
- `lib/briefing/ranker.ts:68, 76-78`: serendipity heuristic math rationale (AI-scored-vs-missing branch)
- `canisters/aegis_backend/main.mo:1308-1309`: unauthenticated endpoint + risk model note — security-relevant WHY, must remain
- `canisters/aegis_backend/main.mo:794-795`: `try/finally` guarantees `releaseGuard` even on trap — concurrency-correctness WHY

## Findings dismissed after review

| Location | Initial suspicion | Dismissal reason |
|---|---|---|
| `app/api/analyze/route.ts::sanitizeUserContext` | LARP candidate (name suggests it might not sanitize) | It does sanitize — filters by type, length, array size |
| `contexts/content/cache.ts::validateContentItems` | LARP candidate | Real structural + range validation |
| `lib/translation/validate.ts::validateTranslation` | LARP candidate (could be theatre) | Thorough — kana check for ja targets, meta-commentary prefixes, length ratio, byte-identical-to-input guard |
| `lib/reputation/publishGate.ts::checkPublishGate` | LARP candidate (could be bypassable) | Two-threshold gate with recovery; no obvious bypass |
| `lib/utils/validatedLocalStorage.ts::getValidated` | Candidate for being a claim without teeth | Enforces guard predicate; returns fallback on any failure path; no silent accept |
| `lib/ingestion/dedup.ts::ArticleDeduplicator` | LARP candidate (cache that doesn't cache) | Real IDB + localStorage fallback, real pruning, real fingerprint-based duplicate detection |
| `lib/ic/icLlmCircuitBreaker.ts` | LARP candidate (retries that don't retry) | Correct closed/open/half-open state machine; tested |
| `catch { /* private-mode SecurityError — drop */ }` (various) | LARP candidate (silently swallow) | Paired with an explicit return of fallback/false — not swallowing meaningful errors |
| `catch {}` in `packages/d2a-client/src/handshake.ts:254, 260` | Out of scope (packages/ not in /app /contexts /lib /canisters), and each returns `null` which is the documented decrypt-failure signal |

## Out of scope but notable

- `/components` contains ~50 files with sporadic "//" comments. Spot-checked — mostly single-line WHYs for UI edge cases. No TODO/FIXME/HACK. Recommend a follow-up pass if desired, but not part of this audit.
- `/packages/d2a-client` is a separate workspace (published package); its JSDoc drives external consumer tooltips and should be preserved regardless of internal-slop heuristics.
- `/hooks` spot-checked — clean.
- Tests (`__tests__/`, `e2e/`) not audited — test comments serve a different purpose (documenting test intent).
