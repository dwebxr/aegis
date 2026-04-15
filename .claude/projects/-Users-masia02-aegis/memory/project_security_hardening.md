---
name: Canister Security Hardening (2026-03-27)
description: Security improvements applied to main.mo canister based on ICP skills analysis
type: project
---

Applied canister security hardening based on ICP skills analysis:

1. **Controller capture** — `shared(initMsg) persistent actor` captures deployer as `controller`
2. **requireAuthenticated()** — Replaced boolean `requireAuth()` + assert with trap-based guard across all 22 endpoints
3. **Anonymous principal rejection** — Added to previously unprotected: `put_offer`, `delete_offer`, `submit_receipt`, `getTreasuryBalance`
4. **Controller authorization** — `sweepProtocolFees`, `topUpCycles`, `removePushSubscriptions` now require controller
5. **CallerGuard reentrancy prevention** — Applied to all async functions with inter-canister calls: `publishWithStake`, `validateSignal`, `flagSignal`, `recordD2AMatch`
6. **SELF constant** — Deduplicated `Principal.fromActor(AegisBackend)` across 6 call sites
7. **getCyclesBalance()** — Added query function for cycle monitoring
8. **AuthContext** — Anonymous principal check after login + init, improved error notifications

**Why:** canister-security.md skill identified critical missing access control and TOCTOU vulnerabilities

**How to apply:** When adding new canister endpoints, always include `requireAuthenticated(caller)`, and use `acquireGuard`/`releaseGuard` for any function with `await`

**Deferred:** mo:base → mo:core migration (large refactor, ~100+ API changes, needs local dfx testing)
