# LARP Audit #3 — D2A Peer Discovery Changes — 2026-03-07

## Overall Verdict

**Not a LARP.** The D2A peer discovery changes (threshold alignment, expiry window,
diagnostic logging) are genuine fixes addressing real peer connectivity issues.
Production code uses shared constants from `protocol.ts`, Jaccard similarity is
correctly implemented, and relay interactions use real `SimplePool` calls.

---

## Findings by Category

### 1. Stub Functions / Hardcoded Values
**Status: CLEAN** — No stubs. All constants moved to `protocol.ts` and shared.

### 2. Tests with Stale/Hardcoded Assertions
**Status: FIXED**

| # | File | Lines | Issue | Severity | Status |
|---|------|-------|-------|----------|--------|
| T1 | `discovery-dedup.test.ts` | 128 | Comment said "RESONANCE_THRESHOLD (0.3)" — actual value is 0.15 | MEDIUM | FIXED |
| T2 | `discovery-dedup.test.ts` | 139 | Asserted `toBeGreaterThanOrEqual(0.3)` — should be 0.15 | MEDIUM | FIXED |
| T3 | All agent test files | various | Tests use magic numbers (0.2, 0.19, 0.15) instead of importing `INTEREST_BROADCAST_THRESHOLD`/`RESONANCE_THRESHOLD` | LOW | ACCEPTED — test files intentionally pin values to detect accidental constant changes |

### 3. Tests Mocking Real Logic
**Status: ACCEPTABLE** — `discovery-dedup.test.ts` mocks `SimplePool` (external dep) but
exercises real `discoverPeers` logic: dedup, tag parsing, resonance filtering, sorting.
This is correct integration testing practice.

### 4. Silent Error Handling
**Status: ACCEPTABLE**

| # | File | Lines | Issue | Severity | Status |
|---|------|-------|-------|----------|--------|
| E1 | `discovery.ts` | 102-107 | Relay query failure returns `[]` with console.error | LOW | ACCEPTED — background polling system; manager handles empty arrays gracefully; error is logged |

### 5. Async Code Not Awaited
**Status: CLEAN** — All async paths are properly awaited.

### 6. Validation
**Status: CLEAN** — Payload validation (handshake.ts) was hardened in LARP Audit #2.

### 7. Unexercised Code Paths
**Status: CLEAN** — Diagnostic logging exercises both branches (peers found / no peers).

---

## Additional Fixes Applied

### FIX 1: Pool resource leak on broadcast error — LOW
`broadcastPresence` now wraps `pool.publish()` + assertions in try/finally to
guarantee `pool.destroy()` even on synchronous throw.

### FIX 2: Verbose diagnostic log output — LOW
Discovery log capped at 5 peer details and shortened format to prevent excessive
console output during frequent polling cycles.

---

## Progress Tracker (264 tests, 19 suites — all passing)

- [x] T1: Stale comment "0.3" in discovery-dedup.test.ts:128 — FIXED
- [x] T2: Stale assertion `0.3` in discovery-dedup.test.ts:139 — FIXED to 0.15
- [x] T3: Magic numbers in tests — ACCEPTED (intentional pinning)
- [x] E1: Silent relay error — ACCEPTED (logged, background system)
- [x] FIX 1: Pool leak in broadcastPresence — FIXED (try/finally)
- [x] FIX 2: Verbose log output — FIXED (capped at 5 details, shorter format)
