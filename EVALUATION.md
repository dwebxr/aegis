# Defensive Programming Audit

## Methodology

Surveyed every `try`/`catch`/`.catch()`/`.finally()` and `if (!x) return null` pattern in
non-test `.ts`/`.tsx` files (136 files). Classified each against the rules:

- **LEGIT-BOUNDARY** — at trust boundary (network I/O, localStorage/IDB, JSON.parse on external/persisted data, URL constructor, @dfinity IC calls, nostr relay calls).
- **LEGIT-CASCADE** — scoring/translation cascade where the fallback IS the feature.
- **LEGIT-API** — API route that returns a structured error response to the client.
- **LEGIT-RETHROW** — `catch(err) { log/notify; throw err }` that adds a user-visible side effect before surfacing (not pure noise).
- **DEFENSIVE-GARBAGE** — wraps code that cannot throw; safety-net `.catch()` after an inner handler that already catches everything awaited.
- **SILENT-SWALLOW** — `catch {}` or `catch (e) { /* nothing */ }` where the error carries real information that's being discarded.

## Summary

The Aegis codebase is notably disciplined. The overwhelming majority of catches sit at legitimate
boundaries: localStorage/sessionStorage (Safari private mode / quota / security errors),
IndexedDB (user storage policy), `JSON.parse` on persisted/external data, `new URL()` (legitimately
throws on malformed input), `fetch()` to external APIs and Next.js API routes, @dfinity/agent IC
canister calls, and `nostr-tools` relay calls. Silent-swallow patterns (`catch {}`) are used
deliberately for SSR guards (`typeof window === "undefined"` style branches) and for best-effort
writes (e.g. clearing a cache key) — all paired with a logged or user-visible signal elsewhere.

The scoring cascade in `contexts/content/scoring.ts` and the translation cascade in
`lib/translation/engine.ts` are the canonical fallback-chain features; each branch failure is
either funnelled into a circuit breaker (`recordIcLlmFailure()`) or logged with `errMsg(err)` so
the failure is visible.

### Count

- **Files with try/catch**: 136 (including tests)
- **HIGH-confidence defensive garbage found**: 1 (the safety-net `.catch` in `contexts/content/icSync.ts:139-142`)
- **Silent swallows found**: 0 that discard recoverable signal (the `catch {}` cases are either
  best-effort writes, SSR guards, or paired with user-visible state).

## HIGH-confidence findings (to fix)

### `contexts/content/icSync.ts:139-142` — DEFENSIVE-GARBAGE

```ts
promise.then(undefined, async (err) => {
  // ... try/catch around enqueueAction (the only awaited call) ...
}).catch((unexpectedErr) => {
  // Safety net: catch any unexpected error in the rejection handler itself
  console.error("[content] Unexpected error in syncToIC handler:", errMsg(unexpectedErr));
});
```

The inner `.then(undefined, handler)` already wraps every awaited call in its own `try/catch`. The
only remaining code paths that could throw are synchronous `setSyncStatus(...)` / `setPendingActions(...)`
/ `addNotification(...)` / `console.warn(...)` calls — none of which throw. The outer `.catch` is
a speculative safety net.

**Fix**: remove the outer `.catch`. If the inner handler ever throws something truly unexpected
(e.g. a state-setter bug), letting the error become an unhandled rejection will surface the bug
in Sentry where it belongs, rather than being quietly console.error'd.

## LEGITIMATE patterns kept (sample)

### Trust-boundary I/O (kept)

- `contexts/ThemeContext.tsx`, `contexts/DemoContext.tsx`, `contexts/FilterModeContext.tsx`,
  `components/settings/GeneralSection.tsx`, `components/tabs/DashboardTab.tsx`,
  `components/tabs/BriefingTab.tsx`, `app/page.tsx`, `lib/reputation/publishGate.ts`,
  `lib/wot/cache.ts`, `lib/scoring/cache.ts`, `lib/apiKey/storage.ts`, `lib/ollama/storage.ts`,
  `lib/mediapipe/storage.ts`, `lib/audio/storage.ts`, `lib/preferences/storage.ts`,
  `lib/sources/storage.ts`, `lib/sources/discovery.ts`, `lib/d2a/*`, `lib/ingestion/sourceState.ts`,
  `lib/ingestion/dedup.ts`, `lib/onboarding/state.ts`, `lib/translation/debugLog.ts`,
  `lib/translation/cache.ts`, `lib/storage/migrate.ts`, `lib/filtering/costTracker.ts`,
  `lib/nostr/linkAccount.ts`, `lib/nostr/profile.ts`, `hooks/useAutoReveal.ts`: all localStorage /
  sessionStorage / IndexedDB reads & writes. Throw on Safari private mode, quota exceeded, and
  security errors. **KEEP.**

- `lib/utils/url.ts`, `contexts/content/dedup.ts`, `lib/d2a/cors.ts`, `lib/ingestion/fetchers.ts`,
  `components/tabs/BriefingTab.tsx`, `components/tabs/D2ATab.tsx`, `app/b/[naddr]/page.tsx`,
  `app/api/fetch/farcaster/route.ts`, `instrumentation-client.ts`: `new URL()` legitimately throws
  on malformed input. **KEEP.**

- `app/api/analyze/route.ts`, `app/api/fetch/{rss,url,discover-feed,briefing,twitter,nostr,ogimage}/route.ts`,
  `app/api/upload/image/route.ts`, `app/api/translate/route.ts`, `app/api/push/{token,send}/route.ts`,
  `app/api/d2a/{briefing,briefing/changes,health}/route.ts`, `app/api/briefing/digest/route.ts`,
  `app/api/health/route.ts`: API-route error handling that returns structured error responses.
  **KEEP.**

- `lib/ic/actor.ts:13-17` (`syncTime`), `lib/ic/icpLedger.ts:100-104` (`ledger syncTime`),
  `contexts/content/icSync.ts` (IC calls), `lib/preferences/storage.ts` (IC calls),
  `lib/nostr/linkAccount.ts` (IC calls), `contexts/AgentContext.tsx` (IC calls, ledger, recordD2AMatch),
  `lib/agent/manager.ts` (all relay/network calls): @dfinity IC canister & nostr relay calls.
  **KEEP.**

### Cascade / circuit-breaker logic (kept)

- `contexts/content/scoring.ts` — scoring cascade (Ollama → WebLLM → MediaPipe → BYOK → IC → Server → Heuristic).
  Every branch funnels into a circuit breaker or logs `errMsg(err)`. **KEEP.**

- `lib/translation/engine.ts` — translation cascade + retry logic with IC LLM circuit breaker.
  **KEEP.**

- `app/page.tsx:458-462` — `catch(err) { console.error; addNotification; throw err; }` —
  the `addNotification` side effect is the reason the catch exists; re-throws the error for the
  caller to see. **KEEP (LEGIT-RETHROW).**

- `lib/nostr/linkAccount.ts:82-85` — normalizes decode errors into a user-friendly message. **KEEP.**

### Intentional unhandled-rejection prevention

- `lib/utils/timeout.ts:13` — `promise.catch(() => {});` — prevents a late rejection from the
  wrapped promise becoming an unhandled rejection after `Promise.race` has already settled via
  the timeout branch. Documented intent. **KEEP.**

### Fire-and-forget with logged-warning tail

Many places use `.then(...).catch(err => console.warn(...))` for fire-and-forget IC syncs. These
all (a) call a real network/IC endpoint that can throw, (b) surface the failure via a warn log
paired with some user-visible state change. **KEEP.**

### React state-setter / DOM interactions

- `components/ui/ShareBriefingModal.tsx`, `components/ui/AgentProfileEditModal.tsx`,
  `components/ui/NostrAccountLink.tsx`, `components/ui/SignalComposer.tsx`,
  `components/ui/NotificationToggle.tsx`: each catch maps the error into a user-facing error state
  (`setErrorMsg`, `setPhase("error")`, `setError`). **KEEP (LEGIT-BOUNDARY).**

## Items deferred

None. The single HIGH-confidence finding is fixed in this pass.
