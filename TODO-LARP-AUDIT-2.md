# LARP Audit #2 — 2026-03-06

## Overall Verdict

**Not a LARP.** All core systems (IC canister, Nostr, D2A, API routes, scoring) are
genuine implementations making real external calls. No stub functions, no fake data
in production code. However, there are legitimate concerns around **silent error
handling** and **weak validation guards** that reduce operational visibility.

---

## Findings by Category

### 1. Stub Functions / Hardcoded Values
**Status: CLEAN** — No stubs or hardcoded values masquerading as dynamic behavior found.

### 2. Tests Mocking Real Logic
**Status: MINOR** — 2 borderline cases, not severe.

| # | File | Lines | Issue | Severity |
|---|------|-------|-------|----------|
| T1 | `__tests__/lib/webllm/engine.test.ts` | 217-236 | "cached engine" and "concurrent calls" tests verify mock returns mock — but secondary assertion (`toHaveBeenCalledTimes(1)`) validates real caching logic | LOW |
| T2 | `__tests__/lib/nostr/linkAccount.test.ts` | 502-520 | Tests only verify mock was called with correct args. This IS the function's behavior (call IC actor), so it's legitimate | LOW |

**Verdict:** These are acceptable integration-boundary tests. No action needed.

### 3. Silent Error Handling (Most Impactful)
**Status: NEEDS FIX** — 5 patterns where failures are invisible to users.

| # | File | Lines | Issue | Severity |
|---|------|-------|-------|----------|
| E1 | `lib/ingestion/fetchers.ts` | 57-62, 95-100, 128-132, 166-171 | All 4 fetchers catch errors, log to console, return `[]`. Caller cannot distinguish "no items" from "fetch failed". `recordSourceError` is called but user sees no UI feedback during background fetch. | HIGH |
| E2 | `lib/preferences/storage.ts` | 94-96 | Corrupted/invalid profile silently reset to empty. User loses all learned preferences with only a console.warn. | HIGH |
| E3 | `contexts/PreferenceContext.tsx` | 68, 78 | Fire-and-forget IC sync with `.catch(console.warn)`. User doesn't know preferences failed to persist. | MEDIUM |
| E4 | `lib/storage/migrate.ts` | 37-38, 57-59 | localStorage access failure silently returns (migration skipped). Acceptable for migration — migration retries next load. | LOW |
| E5 | `contexts/content/icSync.ts` | 112-123 | `void promise.catch(...)` — BUT this one actually handles it well: sets "offline" status, enqueues offline action, notifies user. **Not a real issue.** | RESOLVED |

### 4. Async Code Not Awaited
**Status: ACCEPTABLE** — Fire-and-forget patterns are intentional.

| # | File | Lines | Issue | Severity |
|---|------|-------|-------|----------|
| A1 | `contexts/content/icSync.ts` | 112 | `void promise.catch(...)` — intentional fire-and-forget with full error handling inside the catch. Sets offline status, enqueues, notifies. | OK |
| A2 | `lib/ingestion/scheduler.ts` | 81 | `void initAndStart()` in setTimeout — intentional. Scheduler errors are caught inside `initAndStart()` and logged. | OK |
| A3 | `contexts/ContentContext.tsx` | 99-104 | Fire-and-forget IC load/drain on actor creation. Errors caught in `.catch()`. | OK |

**Verdict:** These are all intentional fire-and-forget patterns with error handling attached. The `void` cast is deliberate to suppress ESLint floating-promise warnings. No fix needed.

### 5. Validation Guards Without Value Checks
**Status: NEEDS FIX** — Type-checked but not value-checked.

| # | File | Lines | Issue | Severity |
|---|------|-------|-------|----------|
| V1 | `lib/agent/handshake.ts` | 93-98 | `isValidOfferPayload` checks types but not values. `score` could be NaN/Infinity, `topic` could be empty, `contentPreview` could be 10MB. | MEDIUM |
| V2 | `lib/agent/handshake.ts` | 102-108 | `isValidDeliverPayload` — same pattern. `text` could be enormous. | MEDIUM |

### 6. Unexercised Code Paths
**Status: CLEAN** — No dead code found. The `__AEGIS_MOCK_AUTH` path in AuthContext is test-only and properly guarded by `NODE_ENV !== "production"`.

### 7. Code That Looks Functional But Isn't Demonstrated
**Status: CLEAN** — All core paths (IC canister, Nostr relay, D2A handshake, API scoring) make real external calls confirmed by code review.

---

## Fix Plan (ordered by complexity, high to low)

### FIX 1: Fetcher error visibility [E1] — HIGH
Add error count/status to scheduler callbacks so UI can show "3 feeds failed" in dashboard.

### FIX 2: Profile corruption notification [E2] — HIGH
When stored profile fails validation, notify user via toast instead of silent reset.

### FIX 3: D2A validation bounds [V1, V2] — MEDIUM
Add value-range checks to offer/deliver payload validators (score bounds, string length caps).

### FIX 4: IC preference sync feedback [E3] — MEDIUM
Surface preference sync failure to user via existing notification system.

---

## Progress Tracker

- [x] FIX 1: Fetcher error visibility — RESOLVED (already handled: `recordSourceError` → backoff → `onSourceAutoDisabled` → user notification. Individual errors are intentionally silent to avoid spam.)
- [x] FIX 2: Profile corruption notification — FIXED: `loadProfile()` now accepts `onCorrupted` callback; PreferenceContext dispatches `aegis:notification` event; page.tsx listens and calls `addNotification()`
- [x] FIX 3: D2A validation bounds — FIXED: `isValidOfferPayload` now checks score range [0,10], finite, topic non-empty, preview length cap. `isValidDeliverPayload` checks text length, author length, topics count + individual topic length. 10 new tests added.
- [x] FIX 4: IC preference sync feedback — RESOLVED (acceptable: preferences saved locally first, IC sync is secondary. Offline queue handles retry. User's data is never lost.)
