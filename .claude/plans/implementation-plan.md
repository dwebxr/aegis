# Implementation Plan: 4 Improvements

## Plan 1: Sentry DSN Setup

### Goal
Enable production error tracking. Currently Sentry SDK is fully integrated (3 capture points, auth scrubbing, conditional source map upload) but no DSN is set in Vercel production — all error capture is silently no-op.

### Steps
1. Create Sentry project (if not already exists) at sentry.io
2. `vercel env add NEXT_PUBLIC_SENTRY_DSN production` — set DSN
3. (Optional) `vercel env add SENTRY_ORG production`, `vercel env add SENTRY_PROJECT production`, `vercel env add SENTRY_AUTH_TOKEN production` — enables source map upload for readable stack traces
4. Redeploy: `vercel --prod`
5. Verify: trigger a test error, confirm it appears in Sentry dashboard

### Code Changes
None. All code is already in place:
- `instrumentation-client.ts:5` — `if (dsn) { Sentry.init({...}) }`
- `sentry.server.config.ts:5` — same pattern
- `sentry.edge.config.ts:5` — same pattern
- `next.config.mjs:64` — `disableSourceMapUpload: !process.env.SENTRY_AUTH_TOKEN`

### Risk
Zero. Sentry init is gated by `if (dsn)` — no DSN = no-op. Adding DSN only enables capture.

### Estimated Effort
5 minutes (env var setup + redeploy).

---

## Plan 2: ContentContext.tsx Split

### Goal
Split the 831-line monolithic `ContentContext.tsx` into focused modules while preserving the exact same public API (`useContent()` hook). No consumer changes needed.

### Architecture

```
contexts/
  ContentContext.tsx          # Slim orchestrator (Provider + public hook, ~80 lines)
  content/
    useContentScoring.ts     # scoreText + scoring cascade (~100 lines)
    useICSync.ts             # loadFromIC + syncToIC + drainOfflineQueue + retry (~200 lines)
    useContentCache.ts       # load/save/truncate cache (~80 lines)
    useImageBackfill.ts      # backfillImageUrls (~50 lines)
    types.ts                 # ContentState interface + shared types (~30 lines)
```

### Data Flow

```
ContentContext.tsx (orchestrator)
  ├── useContentCache()       → { loadCache, saveCache, cacheChecked }
  │     reads: nothing
  │     writes: content (initial load)
  │
  ├── useContentScoring()     → { scoreText }
  │     reads: actorRef, isAuthenticated, identity
  │     writes: nothing (pure — returns result)
  │
  ├── useICSync()             → { loadFromIC, syncToIC, drainQueue, syncStatus, pendingActions }
  │     reads: actorRef, contentRef, isAuthenticated, principal
  │     writes: content (merge pages), syncStatus, pendingActions
  │     calls: addNotification
  │
  ├── useImageBackfill()      → { backfillImageUrls }
  │     reads: contentRef, actorRef, isAuthenticated, principal
  │     writes: content (imageUrl updates)
  │
  └── CRUD callbacks (inline) → { analyze, validateItem, flagItem, addContent, ... }
        reads: scoreText (from useContentScoring), syncToIC (from useICSync)
        writes: content, isAnalyzing
```

### Shared State Strategy

The key challenge is that all sub-hooks need access to `actorRef`, `contentRef`, and auth state. Two approaches:

**Option A: Parameter passing** — Each sub-hook receives refs/state as arguments:
```typescript
// useICSync.ts
export function useICSync(
  actorRef: MutableRefObject<_SERVICE | null>,
  contentRef: MutableRefObject<ContentItem[]>,
  isAuthenticated: boolean,
  principal: Principal | null,
  addNotification: (msg: string, type: string) => void,
) { ... }
```

**Option B: Internal context** — Create a private `ContentInternalsContext` that holds refs, passed to sub-hooks:
```typescript
// Too much indirection for this case. Option A is simpler.
```

**Decision: Option A.** The sub-hooks are internal implementation details — explicit parameters make dependencies visible and testable without context wrapping.

### File-by-File Changes

#### `contexts/content/types.ts` (NEW)
- Move `ContentState` interface (currently lines 175-197)
- Move `AnalyzeResponse` re-export
- Move `UserContext` re-export

#### `contexts/content/useContentCache.ts` (NEW)
- Move `loadCachedContentAsync()` (lines 101-119)
- Move `saveCachedContent()` (lines 132-149)
- Move `truncatePreservingActioned()` (lines 151-173)
- Move module-level `saveTimer`, `useIDB` (lines 129-130)
- Export: `{ loadCache, saveCache, cacheChecked }`

#### `contexts/content/useContentScoring.ts` (NEW)
- Move `callAnalyzeAPI()` (lines 33-59)
- Move `tryOllama`, `tryWebLLM`, `tryBYOK` wrappers (lines 62-78)
- Move `scoreText` callback (lines 437-518)
- Export: `{ scoreText }`

#### `contexts/content/useICSync.ts` (NEW)
- Move `syncToIC()` (lines 301-314)
- Move `drainOfflineQueue()` (lines 349-386)
- Move `loadFromIC()` (lines 691-805) including `evalToContentItem` and `mergePageIntoContent`
- Move retry refs: `syncRetryRef`, `syncRetryTimerRef`
- Move actor creation effect (lines 316-347)
- Export: `{ loadFromIC, syncToIC, syncStatus, pendingActions, actorRef }`

#### `contexts/content/useImageBackfill.ts` (NEW)
- Move `backfillImageUrls()` (lines 651-689)
- Move cleanup refs: `backfillCleanupRef`, `backfillFnRef`
- Export: `{ backfillImageUrls, backfillCleanupRef }`

#### `contexts/ContentContext.tsx` (MODIFY — shrink to ~80 lines)
- Import all sub-hooks
- Keep: state declarations, CRUD callbacks (analyze/validate/flag/add), `useMemo` value, Provider JSX
- Keep: `syncBriefing` (8 lines, not worth extracting)
- Remove: everything moved to sub-hooks

### Edge Cases & Risks

1. **Circular ref updates**: `loadFromIC` calls `backfillImageUrls` on completion. After split, `useICSync` needs a ref to `backfillImageUrls`. Pass as parameter or via ref.
2. **Actor creation timing**: `actorRef` is created in `useICSync` but read by `useContentScoring` and CRUD callbacks. The orchestrator must pass the ref down.
3. **Test updates**: `__tests__/contexts/ContentContext-sync.test.tsx` and `__tests__/contexts/ContentContext-dedup.test.tsx` render the full `<ContentProvider>` — they should continue to work without changes since the public API is unchanged.

### Verification
- All 4718 tests must pass (no public API changes)
- `ContentContext.tsx` shrinks from 831 → ~80 lines
- Each sub-hook can be unit-tested in isolation (future improvement)

### Estimated Effort
2-3 hours. Mechanical refactoring — no logic changes.

---

## Plan 3: E2E Test CI Enhancement

### Current State
E2E CI **already exists** in `.github/workflows/ci.yml` (lines 52-80):
- Runs after `lint-and-test` passes
- Installs Chromium, runs `desktop-chrome` + `mobile-chrome` projects
- Auto-starts dev server via Playwright `webServer` config
- Uploads playwright-report artifact (14-day retention)

### What's Missing
The CI E2E runs against `npm run dev` (dev server) with no `ANTHROPIC_API_KEY`. This means:
1. All API routes that need the key fail → tests only cover UI routing and mock scenarios
2. No preview deploy testing (tests run on the source, not the deployed artifact)

### Proposed Enhancements

#### Enhancement A: Build + Start instead of Dev Server
Change Playwright webServer from dev to production build for realistic testing:

```typescript
// playwright.config.ts — webServer section
webServer: {
  command: process.env.CI ? "npm run build && npm run start" : "npm run dev",
  url: "http://localhost:3000",
  reuseExistingServer: !process.env.CI,
  timeout: 180_000,
},
```

**Impact**: CI tests run against production build (catches build-only issues like missing env vars, SSG errors).

**Risk**: Build step adds ~2 minutes to CI time. The `build` job already runs separately, so this is partially redundant — but the E2E tests verify the built app actually serves correctly.

#### Enhancement B: Add ANTHROPIC_API_KEY secret for full pipeline E2E
```yaml
# ci.yml — e2e job
env:
  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY_TEST }}
```

**Risk**: API costs on every PR. Mitigate with a test-only key with low budget, or skip API-dependent tests in CI (tag them).

**Decision**: Skip this for now — current E2E tests already mock API responses via `e2e/fixtures/api-mocks.ts`. Real API testing is better done manually pre-release.

#### Enhancement C: Vercel Preview Deploy E2E
Run E2E against Vercel preview URLs on PRs:

```yaml
e2e-preview:
  runs-on: ubuntu-latest
  needs: [lint-and-test]
  if: github.event_name == 'pull_request'
  steps:
    - uses: actions/checkout@v4
    - run: npm ci
    - run: npx playwright install --with-deps chromium
    - name: Wait for Vercel preview
      uses: patrickedqvist/wait-for-vercel-preview@v1.3.2
      id: vercel
      with:
        token: ${{ secrets.GITHUB_TOKEN }}
        max_timeout: 300
    - name: Run E2E against preview
      run: npm run test:e2e -- --project=desktop-chrome
      env:
        BASE_URL: ${{ steps.vercel.outputs.url }}
```

**Requires**: Playwright config to read `BASE_URL` env var:
```typescript
use: {
  baseURL: process.env.BASE_URL || "http://localhost:3000",
}
```

**Risk**: Depends on `wait-for-vercel-preview` action reliability. Vercel sometimes takes >5 minutes for first deploy.

**Decision**: Enhancement A (build+start) is low-risk, high-value. Enhancement C (preview deploy) is medium-risk, medium-value — implement after A is stable.

### File Changes

| File | Change |
|------|--------|
| `playwright.config.ts` | Change webServer command for CI; read `BASE_URL` env var |
| `.github/workflows/ci.yml` | No change for Enhancement A (Playwright auto-handles build+start) |

### Estimated Effort
Enhancement A: 30 minutes. Enhancement C: 1 hour.

---

## Plan 4: Next.js 15 Migration

### Goal
Upgrade from Next.js 14.2.35 to Next.js 15.x to resolve 4 high-severity npm audit findings and access Turbopack, React 19, and modern APIs.

### Dependency Upgrade Map

| Package | Current | Target | Notes |
|---------|---------|--------|-------|
| `next` | 14.2.35 | 15.x (latest) | Core upgrade |
| `react` | 18.3.1 | 19.x | Required by Next.js 15 |
| `react-dom` | 18.3.1 | 19.x | Must match React |
| `@types/react` | 18.3.28 | 19.x | Type definitions |
| `@types/react-dom` | 18.3.7 | 19.x | Type definitions |
| `@sentry/nextjs` | 10.39.0 | 9.x+ (Next 15 support) | CRITICAL — 10.39.0 does NOT support Next.js 15 |
| `eslint-config-next` | 14.2.35 | 15.x | Must match Next.js |
| `eslint` | 8.57.1 | 9.x (if Next.js 15 requires) | Check compatibility |
| `@serwist/next` | 9.5.6 | Verify | Check Next.js 15 support |
| `@x402/next` | 2.3.0 | Verify | Unknown compatibility |
| `@testing-library/react` | 16.3.2 | Verify React 19 compat | May need update |

### Code Changes Required

#### 1. `next.config.mjs` (LIKELY CHANGE)

```javascript
// Current (Next.js 14):
experimental: {
  serverComponentsExternalPackages: ["ws"],
}

// Next.js 15: this key moved out of experimental
serverExternalPackages: ["ws"],
```

**Also**: Remove CVE security note comments (lines 4-10) since the vulns are resolved in Next.js 15.

#### 2. `package.json` (CHANGE)

Update all versions listed in the upgrade map above.

#### 3. `app/layout.tsx` (VERIFY)

Next.js 15 changed `params` and `searchParams` to be async in page/layout components. Check if `layout.tsx` or `page.tsx` destructure these.

#### 4. React 19 Considerations

**No breaking changes found in the codebase:**
- 0 `forwardRef` usages (deprecated in React 19)
- 0 `"use server"` directives (Server Actions)
- 39 `React.FC` usages — still work in React 19, optional modernization
- `useContext` throughout — still works, `use()` is additive

**One consideration**: React 19 changes `ref` handling — `ref` is now a regular prop, not a special one. Since this project has 0 `forwardRef`, no impact.

#### 5. `@sentry/nextjs` Upgrade (CRITICAL)

Version 10.39.0 only supports Next.js 13-14. Must upgrade to a version that supports Next.js 15.

**Check**: `@sentry/nextjs` changelog for the first version supporting Next.js 15. The init patterns in `sentry.server.config.ts`, `sentry.edge.config.ts`, and `instrumentation-client.ts` are modern and likely require no code changes — just a version bump.

**Potential breaking change**: Sentry v9 → v10 was a major bump. Going to a newer major may require API changes. Research needed at implementation time.

#### 6. `@serwist/next` (VERIFY)

Serwist docs claim Next.js 15 support. Verify 9.5.6 works or upgrade if needed.

#### 7. `@x402/next` (VERIFY)

No published compatibility info. Test post-upgrade. If incompatible, may need to vendor or patch.

### Migration Sequence (ORDER MATTERS)

```
1. Create branch: git checkout -b next15-migration
2. Update package.json (all versions)
3. npm install (regenerate lockfile)
4. Fix next.config.mjs (serverExternalPackages)
5. npm run build — fix any compilation errors
6. npm test — fix any test failures
7. npm run test:e2e — fix any E2E failures
8. npm audit — verify high-severity issues resolved
9. Manual smoke test on localhost
10. PR → review → merge
```

### Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| `@sentry/nextjs` incompatible | HIGH | Research compatible version before starting. Worst case: temporarily remove Sentry wrapper |
| `@serwist/next` incompatible | MEDIUM | Check docs. If broken, temporarily disable PWA (`disable: true`) |
| `@x402/next` incompatible | MEDIUM | Test. If broken, vendor the middleware or use raw x402 core |
| React 19 type changes | LOW | `@types/react` 19.x may have stricter types — fix as they appear |
| Turbopack dev server issues | LOW | Optional. Can keep webpack in dev if Turbopack has issues |

### Unknowns

1. Does `@sentry/nextjs` have a version supporting both Next.js 15 AND the current instrumentation pattern?
2. Does `@x402/next@2.3.0` work with Next.js 15? (No docs available)
3. Does `@mlc-ai/web-llm@0.2.80` work with React 19? (Browser-side, likely fine)
4. Does `cmdk@1.1.1` (command palette) work with React 19?

### Pre-Implementation Research Needed

Before writing any code, verify:
```bash
npm info @sentry/nextjs versions --json | jq '.[-5:]'  # Latest Sentry versions
npm info @serwist/next peerDependencies                  # Serwist Next.js requirement
npm info @x402/next peerDependencies                     # x402 Next.js requirement
```

### Estimated Effort
4-8 hours. Primarily dependency resolution + testing. Code changes are minimal.

---

## Priority Order

| # | Plan | Effort | Impact | Dependencies |
|---|------|--------|--------|-------------|
| 1 | Sentry DSN | 5 min | High (error visibility) | None |
| 2 | ContentContext split | 2-3 hrs | Medium (maintainability) | None |
| 3 | E2E CI enhancement | 30 min | Medium (CI quality) | None |
| 4 | Next.js 15 migration | 4-8 hrs | High (security + perf) | Research phase first |

Plans 1-3 are independent and can be executed in parallel. Plan 4 should be done on a separate branch after 1-3 are merged.
