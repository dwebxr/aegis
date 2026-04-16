# @dfinity v2 → v3 Migration Plan

**Status**: Not started
**Why now**: `@dfinity/auth-client@2.4.1` carries an upstream deprecation
notice pointing to `@icp-sdk/auth`. v3 is current (3.4.3 at time of
writing); v2 still functions but no new features land. Forced migration
will eventually be required.

## Scope

All packages pinned at 2.4.1 today:

- `@dfinity/agent`
- `@dfinity/auth-client`
- `@dfinity/candid`
- `@dfinity/identity`
- `@dfinity/principal`

Consumer files (17 direct importers at audit time):

- `lib/preferences/storage.ts`
- `lib/d2a/briefingProvider.ts`
- `lib/feed/serveFeed.ts`
- `lib/ic/actor.ts`
- `lib/ic/agent.ts`
- `lib/ic/icpLedger.ts`
- `lib/ic/config.ts`
- `lib/ic/declarations/aegis_backend.did.d.ts`
- `lib/nostr/linkAccount.ts`
- `contexts/content/icSync.ts`
- `contexts/SourceContext.tsx`
- `contexts/AuthContext.tsx`
- `contexts/AgentContext.tsx`
- `app/api/push/send/route.ts`
- `app/api/d2a/briefing/route.ts`
- `app/page.tsx`
- `components/tabs/D2ATab.tsx`

## Known breaking changes in v3

Review before starting:

1. **`AuthClient.isAuthenticated()`** is already a `Promise<boolean>` in
   v2 (per project memory). v3 keeps this — no change.
2. **`HttpAgent.createSync` vs `HttpAgent.create`** — v3 prefers the
   async factory. We currently use `createSync` in `lib/ic/agent.ts`.
3. **Certificate verification changes** — v3 tightens root-key handling;
   `ensureRootKey` path in `lib/ic/actor.ts` may need adjustment for the
   local replica flow.
4. **Candid generated types** — `@dfinity/candid` emits slightly
   different `IDL.Func` signatures in v3; `lib/ic/declarations/idlFactory.ts`
   will need regeneration (or manual update of the hand-edited file).
5. **Package rename**: `@dfinity/auth-client` → `@icp-sdk/auth` per the
   npm deprecation notice. This is a path rename, not an API change.
   Verify the new package exports the same `AuthClient` surface.

## Test strategy

1. **Local replica first**: run the full e2e suite (`npm run test:e2e`)
   against a local `dfx start` canister after the upgrade to catch
   certificate / wire-format regressions that unit tests miss.
2. **Lock file diff**: after `npm install`, review the diff in
   `package-lock.json` for any of the five `@dfinity/*` packages pulling
   in unexpected peer changes.
3. **Contract test**: run
   `__tests__/integration/scoringCascadeFallback.test.ts`,
   `__tests__/integration/scoringPipeline.test.ts`, and the D2A briefing
   tests — these exercise `createBackendActorAsync` end-to-end with
   mocked fetch and will surface any breaking-change import failures.
4. **Production canary**: after passing tests, deploy to a Vercel
   preview and verify real II login + real canister call round-trip
   before promoting to production.

## Rollback

`package-lock.json` is tracked; reverting the `npm install` commit is
sufficient to fall back to v2. Do not ship the v3 upgrade in the same
PR as any feature work — keep it isolated so revert is single-SHA.

## Known risks

- **Sentry instrumentation**: `sentry.server.config.ts` and
  `instrumentation.ts` must still work. v3 may change error shapes.
- **Vercel env propagation**: per-memory, env vars with trailing `\n`
  break `Principal.fromText()`. Verify trimming still applied after
  upgrade.
- **IC Agent `syncTime`** — we call `agent.syncTime()` in
  `lib/ic/actor.ts` to prevent signed-query clock drift. Confirm v3
  preserves this method.

## Non-goals

- Not switching to `@icp-sdk/agent-js` or any alternate SDK in this
  migration. Only the rename `@dfinity/auth-client → @icp-sdk/auth` if
  that's the only path forward.
- Not touching Motoko / canister code.

## Recommended sequence

1. Branch off main (`feat/dfinity-v3`).
2. Update `package.json` for all five `@dfinity/*` to `^3.4.3`.
3. `npm install` and address any type errors.
4. Regenerate Candid declarations if needed.
5. Run `npm test` — fix breakage.
6. Run `npm run test:e2e` against local replica.
7. Deploy Vercel preview, smoke-test with real II login.
8. Merge only after smoke passes.

Estimated effort: 1–2 days for a developer familiar with both the
codebase and `@dfinity/agent` internals. The main cost is validating
the upgrade against real IC calls, not writing code.
