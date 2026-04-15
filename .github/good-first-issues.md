# Good first issue catalog

These ten issues are curated as starting points for new contributors. Each is small, scoped, and self-contained — none requires understanding the full Aegis architecture to ship.

To create them on the GitHub repo, run `scripts/create-good-first-issues.sh` from the repo root (requires `gh` CLI authenticated to `dwebxr/aegis`). The script is idempotent: it skips tickets whose title already exists as an open issue.

Each ticket below mirrors the structure of `.github/ISSUE_TEMPLATE/good_first_issue.md`. When the script creates them, it labels each with `good first issue` (label exists in the repo as of 2026-04-15).

---

## 1. Add `LICENSE` file (MIT)

**Context.** The repo has no `LICENSE` file at root. Without one, the code is technically "all rights reserved" by default and downstream contributors cannot legally redistribute. The Aegis project has decided on MIT (Decision 3 in `.claude/plans/growth-suite.md`).

**Affected files**
- `LICENSE` (new) — full MIT license text with copyright line
- `package.json` — set `"license": "MIT"` field

**Acceptance**
- `LICENSE` exists at repo root, contains canonical MIT text
- `package.json` `license` field equals `"MIT"`
- `npx tsc --noEmit` and `npm test` pass

**Out of scope.** Adding LICENSE files to per-package SDK directories — that's part of the SDK feature.

**Hints.** Standard MIT text from <https://opensource.org/license/mit>. Copyright line: `Copyright (c) 2026 dwebxr` (or whatever the maintainers prefer).

---

## 2. Deduplicate Anthropic API call across 3 routes

**Context.** Three API routes — `app/api/analyze/route.ts`, `app/api/briefing/digest/route.ts`, `app/api/translate/route.ts` — each construct their own `fetch("https://api.anthropic.com/v1/messages", ...)` call with similar headers, body shape, and error handling. The deferred DRY analysis in `.claude/evaluations/01-dry-dedup.md` (item #2) flagged this as a real consolidation opportunity, with the caveat that **per-route error semantics differ** (heuristic fallback, 502 passthrough, BYOK rejection) and must be preserved.

**Affected files**
- `lib/api/anthropic.ts` (new) — `callAnthropic({ model, maxTokens, messages, apiKey, signal })` returning the raw response and a typed parsed body
- `app/api/analyze/route.ts`, `app/api/briefing/digest/route.ts`, `app/api/translate/route.ts` — replace inline `fetch` with the helper
- `__tests__/lib/api/anthropic.test.ts` (new) — direct tests for the helper

**Acceptance**
- All three routes use `callAnthropic` for the API call
- Each route still produces its current error-response shape (verify with existing route tests — they must still pass unchanged)
- New helper has its own test coverage for the happy path, 401, 429, 5xx, and abort
- `npx tsc --noEmit` and `npm test` pass

**Out of scope.** Changing the cascade order in `lib/translation/engine.ts` or `contexts/content/scoring.ts`.

**Hints.** See the existing patterns in each route to identify the truly shared surface (URL, version header, content-type) versus per-route concerns (which model, which max_tokens, how errors map to the response).

---

## 3. Extract shared BYOK header parser

**Context.** Three API routes accept a user-provided Anthropic key via the `x-user-api-key` request header. Each route does its own `request.headers.get("x-user-api-key")`, validates the `sk-ant-` prefix, and chooses between the user's key and the server's key. The deferred DRY analysis (`.claude/evaluations/01-dry-dedup.md` item #3) flagged this with the same caveat as #2 — rejection rules differ slightly per route.

**Affected files**
- `lib/api/byok.ts` (new) — `parseByokApiKey(request: NextRequest, serverKey: string | undefined): { key: string; isUser: boolean }`
- `app/api/analyze/route.ts`, `app/api/briefing/digest/route.ts`, `app/api/translate/route.ts` — use the helper

**Acceptance**
- All three routes call `parseByokApiKey`
- The translate route still rejects anonymous calls with 401 (per BYOK-only translation policy)
- Test coverage for missing header, wrong-prefix header, valid user key, missing user key with valid server key, missing both
- `npx tsc --noEmit` and `npm test` pass

**Out of scope.** Changing the BYOK semantics. Pre-existing tests pin the current behaviour and must continue to pass.

---

## 4. Consolidate `ThemeMode` literal union to use shared type

**Context.** The test file `__tests__/contexts/themeContext.test.tsx` redefines `type ThemeMode = "light" | "dark" | "system"` locally instead of importing the shared definition. The deferred type-consolidation pass (`.claude/evaluations/02-type-consolidation.md`) flagged this as a low-risk cleanup.

**Affected files**
- `__tests__/contexts/themeContext.test.tsx` — replace local type with import from the shared location

**Acceptance**
- Local `ThemeMode` definition removed from the test file; imported instead
- All theme tests still pass
- `npx tsc --noEmit` passes

**Hints.** Find the canonical `ThemeMode` definition with `grep -rn "type ThemeMode" lib/ contexts/ components/`.

---

## 5. Drop unused `export` from social icon components

**Context.** `components/icons/index.tsx` exports `DiscordIcon`, `MediumIcon`, and `XIcon`, but they are only consumed internally via the `socialIconMap` lookup in the same module. The deferred unused-code pass (`.claude/evaluations/03-unused-code.md`) flagged these as removable `export` keywords.

**Affected files**
- `components/icons/index.tsx` — drop `export` keyword from the three components

**Acceptance**
- The three named exports are no longer reachable from outside the module
- `socialIconMap` still resolves them correctly
- All icon-related tests still pass
- `npx tsc --noEmit` and `npm test` pass

**Out of scope.** Reorganizing the file or moving the components to separate files.

---

## 6. Fix or remove the stale `S4 Cross-Valid` placeholder in IncineratorTab

**Context.** `components/tabs/IncineratorTab.tsx:24-27` declares four scoring stages (`S1` Heuristic, `S2` Structural, `S3` LLM Score, `S4` Cross-Valid). The first three have `activatable: true`; `S4` has `activatable: false` and is perpetually `IDLE` in the UI. There is no implemented cross-validation stage today. Either tie the stage to a real signal or remove it.

**Affected files**
- `components/tabs/IncineratorTab.tsx` — modify the `STAGES` array
- `__tests__/components/tabs/IncineratorTab.test.tsx` (if exists) — update assertions

**Acceptance**
- `STAGES` no longer contains a perpetually-IDLE stage
- If kept, S4 reflects a real signal (e.g., "did multiple scoring engines agree on the verdict?")
- If removed, the layout still looks reasonable with three columns
- `npx tsc --noEmit` and `npm test` pass

**Hints.** The visual layout uses CSS grid columns; removing one stage may need `grid-cols-4 → grid-cols-3` adjustment.

---

## 7. Document `swSrc` in `next.config.mjs`

**Context.** `next.config.mjs:54` sets `swSrc: "app/sw.ts"` for the Serwist PWA build. Static analysis tools like `knip` flag `app/sw.ts` as unused because the reference is via a config string, not an `import` statement. A one-line JSDoc comment would explain why and prevent future deletion.

**Affected files**
- `next.config.mjs` — one-line comment above the `swSrc` field

**Acceptance**
- A short JSDoc-style comment immediately above `swSrc` explains: "Service worker source file; resolved by Serwist at build time. knip cannot follow string references — keep this comment to prevent accidental deletion of `app/sw.ts`."
- Build still succeeds (`npm run build`)
- `npx tsc --noEmit` passes

---

## 8. Add `validatedLocalStorage` helper and migrate one consumer

**Context.** Eight or more modules (`lib/audio/storage.ts`, `lib/scoring/cache.ts`, `lib/translation/cache.ts`, `lib/preferences/storage.ts`, etc.) each implement near-identical localStorage validation: `JSON.parse` the stored string, run a per-module `isValid` predicate, fall back to a default on shape mismatch or quota error. The deferred DRY analysis (`.claude/evaluations/01-dry-dedup.md` item #4) noted this as real repetition that should ship as a small helper. This ticket extracts the helper and migrates ONE consumer; later tickets will migrate the rest.

**Affected files**
- `lib/utils/validatedLocalStorage.ts` (new) — `getValidated<T>(key, guard, fallback)`, `setValidated<T>(key, value)`
- `lib/audio/storage.ts` — migrate to use the helper
- `__tests__/lib/utils/validatedLocalStorage.test.ts` (new)

**Acceptance**
- Helper handles: missing key, malformed JSON, shape-failure, Safari private-mode quota error (preserves current "halve and retry" pattern from `lib/translation/cache.ts`)
- `lib/audio/storage.ts` uses the helper; existing audio storage tests still pass
- New helper has 90%+ test coverage including the quota path
- Other modules NOT migrated in this PR — that's a follow-up

**Out of scope.** Migrating any other consumer. Migrating IndexedDB-backed storage.

---

## 9. Replace `as any` test mocks with typed factories

**Context.** Three test files use `as any` to construct partial mocks of complex types: `__tests__/lib/agent/manager-comment-fee.test.ts`, `__tests__/lib/briefing/sync*.test.ts`, `__tests__/lib/ic/agent-config.test.ts`. The deferred weak-type pass (`.claude/evaluations/05-weak-types.md`) noted this as a legitimate test idiom but addressable via small typed mock factories.

**Affected files**
- `__tests__/__helpers__/mocks.ts` (new or extended) — typed mock factories returning `Partial<T>` cast to the full type at construction
- The three test files — replace `as any` with the factory

**Acceptance**
- Zero `as any` in the three named test files
- All three test suites still pass
- The new mock factories live in one place, not duplicated per test file

**Hints.** Look at how the existing `__tests__/__helpers__/` files are structured (if any) and follow the same convention.

---

## 10. Add `SECURITY.md` policy file

**Context.** The repo's vulnerability reporting flow currently lives only in `CONTRIBUTING.md`. GitHub specifically looks for `SECURITY.md` at repo root and surfaces it in the "Security" tab. Adding it improves discoverability without duplicating policy.

**Affected files**
- `SECURITY.md` (new) — short policy with private-disclosure URL, response timeline, scope, safe-harbor

**Acceptance**
- `SECURITY.md` exists at repo root
- Includes: link to <https://github.com/dwebxr/aegis/security/advisories/new>, 72-hour acknowledgement target, 14-day fix target for high-severity, scope and out-of-scope statements (matching `CONTRIBUTING.md`)
- GitHub's "Security" tab on the repo surfaces the file (visible after merge)
- `CONTRIBUTING.md` cross-references it instead of restating the policy

**Hints.** Mirror the structure used by other open-source projects (e.g. <https://github.com/microsoft/vscode/blob/main/SECURITY.md>) but keep it short — Aegis is not VS Code.
