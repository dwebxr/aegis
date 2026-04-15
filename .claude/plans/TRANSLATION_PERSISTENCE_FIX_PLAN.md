# Translation Persistence + Intermittent Failure — Fix Plan

**Status**: Draft for review (no code written yet)
**Date**: 2026-04-11
**Reported by**: User in production after Phase 1 + Hotfix 1 + Hotfix 2 deploys
**Author**: Pre-implementation investigation

---

## 1. The bug as user experiences it

> 新しくロードされたコンテンツカードはちゃんと翻訳されたと思ったが、リロードしたら翻訳されない状態になった。まだ Auto-translate: no translation backend available. Check Settings → Translation Engine. が出たり不安定。

Decoded:
1. **Symptom A**: Newly loaded content cards display translations correctly the first time
2. **Symptom B**: After page reload, the translations are gone
3. **Symptom C**: The "Auto-translate: no translation backend available" notification still fires intermittently

---

## 2. Root cause (confirmed by code reading)

### Bug #1 — `mergePageIntoContent` drops the `translation` field

**File**: `contexts/content/icSync.ts:80-101`

```ts
export function mergePageIntoContent(
  pageItems: ContentItem[],
  prev: ContentItem[],
): ContentItem[] {
  const cachedById = new Map(prev.map(c => [c.id, c]));
  const merged = pageItems.map(l => {
    const cached = cachedById.get(l.id);
    if (!cached) return l;
    return {
      ...l,                                       // ← spreads IC version
      topics: l.topics ?? cached.topics,          // ← preserved
      vSignal: l.vSignal ?? cached.vSignal,       // ← preserved
      cContext: l.cContext ?? cached.cContext,    // ← preserved
      lSlop: l.lSlop ?? cached.lSlop,             // ← preserved
      imageUrl: l.imageUrl ?? cached.imageUrl,    // ← preserved
      platform: l.platform ?? cached.platform,    // ← preserved
      // ↓↓↓ MISSING ↓↓↓
      // translation: l.translation ?? cached.translation,
      // nostrPubkey: l.nostrPubkey ?? cached.nostrPubkey,
    };
  });
  ...
}
```

`evalToContentItem` (icSync.ts:49-78) creates ContentItem from the IC `getUserEvaluations` response. The IC canister stores **only the ContentEvaluation fields** — it does NOT store `translation` or `nostrPubkey`. So `l.translation` is always `undefined` after `evalToContentItem`. The merge then `...l` spreads `undefined` over the cached `translation` field, **losing it**.

The local fields list in the merge is incomplete.

### Bug #2 — Intermittent "no backend available" is a downstream effect of Bug #1

The data flow on every reload for an authenticated user:

```
t=0    page loads
t=0+   useEffect [] → loadCachedContent() → setContent(cached items WITH translation)
       → user sees translated cards ✓ (Symptom A)

t=0.5  useEffect [isAuthenticated, identity] → createBackendActorAsync()
t=1.0  actor ready → loadFromICRef.current() → loadFromICCanister
t=1.5  first IC page returns → setContent(prev => mergePageIntoContent(pageItems, prev))
       → translation field WIPED on merged items
       → user sees untranslated cards ✗ (Symptom B)

t=1.5  setContent triggers useEffect [content] in ContentContext → saveCachedContent
       → IDB write debounced 1000 ms (timer reset on every page page = thrashing)

t=1.5  setContent also triggers useTranslation auto-translate effect
       → items.filter(item => !item.translation) → all merged items pass
       → MAX_CONCURRENT=3 items dispatched to runTranslation
       → translateContent → lookupTranslation(text, lang)
         → cache HIT for items < 200 (translation cache TTL=7 days)
         → cache MISS for evicted items, items with non-matching hash, etc.

       For cache HIT: translation re-attached transparently. Fast.
       For cache MISS: real LLM call → may hit transient failure
                       → translateContent throws or returns "failed"
                       → "Translation failed: ..." OR (with hotfix 2)
                          "[backend] returned an unusable response..."
                       → If many items fail, the second notification fires
                       → User sees "Auto-translate: no translation backend
                          available" ✗ (Symptom C — intermittent because it
                          depends on which items are cached vs evicted)

t=2.0  next IC page returns → merge again → wipe again → effect re-runs
t=2.5  ... (loop until all pages loaded, can be 10+ pages for power users)
```

**Why "intermittent"**: It depends on which items in the user's content set fall into a cache hit vs miss. The translation cache has a 200-entry cap with eviction. Power users with > 200 items see misses on the older items. Each miss is a re-translation that may hit a transient LLM failure.

**Why the second notification fires**: With Hotfix 2, explicit-backend validation rejection now throws with a named reason (caught by useTranslation as "Translation failed: ..."). This sets `alreadyNotified = true` for THAT runTranslation call. But OTHER parallel runTranslation calls have their own `alreadyNotified` local state. The first one to fail with `outcome === "failed"` (not throw) fires the second notification. Since the cascade still falls through to "failed" when all backends are exhausted (rare but possible), the second notification can still fire.

### Bug #3 (related, lower priority) — IDB save is debounced 1000 ms

**File**: `contexts/content/cache.ts:85-110`

```ts
export function saveCachedContent(items: ContentItem[]): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    ...
  }, SAVE_DEBOUNCE_MS);
}
```

The debounce is necessary to avoid hammering IDB on every state change, but on `loadFromIC` the save timer is **continuously reset** as each IC page arrives. If the user closes the tab DURING the page-streaming window (worst case ~5-10 seconds for a power user), the latest content state is never persisted. This is a separate latent bug not directly responsible for the user's symptom but worth noting.

---

## 3. Fix scope

### Primary fix (closes Bugs #1 and #2)

Add `translation` and `nostrPubkey` to the merge preservation list:

```ts
return {
  ...l,
  topics: l.topics ?? cached.topics,
  vSignal: l.vSignal ?? cached.vSignal,
  cContext: l.cContext ?? cached.cContext,
  lSlop: l.lSlop ?? cached.lSlop,
  imageUrl: l.imageUrl ?? cached.imageUrl,
  platform: l.platform ?? cached.platform,
  translation: l.translation ?? cached.translation,    // ← NEW
  nostrPubkey: l.nostrPubkey ?? cached.nostrPubkey,    // ← NEW
};
```

Once translation is preserved, the auto-translate effect never re-runs for these items, so the cascade-failure-while-retrying scenario disappears entirely. Both Symptoms B and C resolve from this single fix.

### Secondary improvement (defensive, optional)

Audit ALL fields in `ContentItem` and decide for EACH which side wins on merge:

| Field | Source | Currently | Should be |
|---|---|---|---|
| id, owner, author, avatar, text, source, sourceUrl, scores, verdict, reason, createdAt, validated, flagged, validatedAt, timestamp | IC | IC wins | IC wins ✓ |
| imageUrl | IC + local backfill | preserve cached if IC null | same ✓ |
| topics | IC (encoded in reason) | preserve cached if IC null | same ✓ |
| vSignal, cContext, lSlop | local heuristic | preserve cached if IC null | same ✓ |
| platform | local | preserve cached if IC null | same ✓ |
| scoredByAI, scoringEngine | IC reason decode | IC wins | should preserve cached if IC null/heuristic |
| nostrPubkey | local (nostr source) | **WIPED** | preserve cached |
| translation | local (translation engine) | **WIPED** | preserve cached |

The two bold rows are the bugs. The `scoredByAI` / `scoringEngine` row is a minor oversight — IC may compute "heuristic" for legacy items even though local cache has the real engine. Lower priority but worth fixing in the same pass.

### Tertiary improvement (lower priority)

The translation cache (lib/translation/cache.ts) has only 200 entries and a 16-character SHA-256 hash. For a power user with > 200 cards in the briefing, the cache evicts older translations. If those items also lose their `translation` field via the merge bug, they're permanently re-translated on every load.

**Option**: bump cache size to 1000 entries (~ 200 KB localStorage budget at avg 200 bytes/translation). Or migrate to IDB for unlimited capacity.

This is independent of the merge bug fix and not strictly required to address the user's report. Keep as a follow-up.

---

## 4. Constraints

### Hard constraints
- **No canister change** (this is a frontend-only bug)
- **No breaking change to ContentItem shape** — `translation` is already an optional field
- **Backwards compatible with existing IDB cached content** — old items without `translation` continue to work
- **Auto-translate effect must not re-fire** for items that recovered their translation via merge

### Soft constraints
- **Avoid silent data loss elsewhere** — the merge function should be defensive about local-only fields in general
- **Don't introduce new test pollution** — full suite must stay green

### Edge cases I have to handle

1. **Cached item has translation, IC item lacks it (normal case)** — the fix preserves cached translation
2. **Both have translation (impossible today since IC doesn't store it, but defensive)** — IC wins (l.translation, which would be undefined → falls through to cached). Actually this wants `cached.translation ?? l.translation` for IC to override. But IC NEVER has translation, so the fix `l.translation ?? cached.translation` is equivalent to `cached.translation` and is correct.
3. **Cached item has STALE translation (different language than current pref)** — translation is stored with `targetLanguage` so the UI can compare. The auto-translate effect already filters items where `item.translation` is set REGARDLESS of language. This is a pre-existing behavior bug worth noting but out of scope.
4. **User changed translation language between sessions** — the persisted translation is in the OLD language. After reload it appears as if the translation succeeded but the wrong language is shown. Auto-translate effect skips it (item.translation is set). User sees stale translation. This is a separate bug.
5. **User has 1000+ items** — translation cache eviction. Items > 200 lose their cache entry, get re-translated. With Bug #1 fixed, this still happens but at least the FIRST translation persists in the IDB content cache, so reload works.
6. **Race: IC page returns BEFORE the cached content load completes** — `loadCachedContent` runs in a useEffect with [] deps, `loadFromIC` runs in a useEffect with [isAuthenticated, identity] deps. The actor effect waits for actor creation (~500ms). The cache load is immediate (~10ms). Cache load almost always wins. But if cache load fails or is slow, IC pages set content first, and cache load comes after with stale data → but `if (items.length > 0) setContent(items)` overwrites the IC-loaded state. **This is another latent bug** but not the one the user is reporting. Out of scope.
7. **Translation in flight when merge fires** — runTranslation is mid-flight, item is in translatingIds set. Merge wipes translation. runTranslation completes, calls patchItem(id, { translation: result }). Now the item is re-translated. No data loss, just a wasted cycle.

---

## 5. Dependencies

### Code dependencies
- `contexts/content/icSync.ts` — `mergePageIntoContent` (the bug site)
- `__tests__/contexts/content/icSync.test.ts` — `describe("mergePageIntoContent")` (existing tests don't cover translation)
- `lib/types/content.ts` — ContentItem fields (no change needed)

### Build/deploy dependencies
- Vercel deploy (frontend only, no canister)
- No env var changes
- No migration needed (new behavior is more permissive)

### External dependencies
- None (pure code fix)

---

## 6. Architecture / data flow after fix

```
Page load
  │
  ├─ useEffect [] → loadCachedContent() → IDB → setContent(cached items WITH translation)
  │     │
  │     ▼
  │   Items render with translations ✓
  │
  ├─ useEffect [auth] → createBackendActorAsync() → loadFromICCanister()
  │     │
  │     ▼ pages stream in
  │   mergePageIntoContent(page, prev)
  │     │  for each item:
  │     │   if cached: { ...l, topics: l.topics ?? cached.topics, ..., translation: l.translation ?? cached.translation }
  │     │             ← translation is preserved ✓
  │     │   if not cached: l (no translation, may auto-translate)
  │     ▼
  │   setContent(merged) — translations remain on existing items, new items get auto-translated
  │
  └─ useTranslation auto-translate effect
        │
        ▼ items.filter(!item.translation) → only NEW items (no false positives)
      runTranslation only fires for items that genuinely lack a translation
      No more "Auto-translate: no backend" cascade-failure noise
```

---

## 7. Tests

### New tests to add (in `__tests__/contexts/content/icSync.test.ts`)

Inside `describe("mergePageIntoContent", ...)`:

```ts
it("preserves cached translation field when IC page lacks it", () => {
  const translation = {
    translatedText: "アップルが新製品を発表しました。",
    targetLanguage: "ja",
    backend: "ic-llm",
    generatedAt: 1700000000000,
  };
  const existing = [makeItem({ id: "shared", translation })];
  const page = [makeItem({ id: "shared" })]; // IC version has no translation
  const result = mergePageIntoContent(page, existing);
  expect(result[0].translation).toEqual(translation);
});

it("preserves cached nostrPubkey when IC page lacks it", () => {
  const existing = [makeItem({ id: "shared", nostrPubkey: "npub-abc" })];
  const page = [makeItem({ id: "shared" })];
  const result = mergePageIntoContent(page, existing);
  expect(result[0].nostrPubkey).toBe("npub-abc");
});

it("does NOT lose translation across multiple page merges (sequential pages)", () => {
  const translation = { translatedText: "翻訳", targetLanguage: "ja", backend: "ic-llm", generatedAt: 1 };
  let state: ContentItem[] = [makeItem({ id: "a", translation })];
  // Simulate three IC pages each containing the same item (re-syncing)
  for (let i = 0; i < 3; i++) {
    const page = [makeItem({ id: "a" })];
    state = mergePageIntoContent(page, state);
  }
  expect(state[0].translation).toEqual(translation);
});

it("preserves translation when IC page contains a different item too", () => {
  const translation = { translatedText: "翻訳", targetLanguage: "ja", backend: "ic-llm", generatedAt: 1 };
  const existing = [makeItem({ id: "a", translation }), makeItem({ id: "b" })];
  const page = [makeItem({ id: "a" }), makeItem({ id: "c" })];
  const result = mergePageIntoContent(page, existing);
  const aResult = result.find(r => r.id === "a");
  expect(aResult?.translation).toEqual(translation);
});
```

### Existing test verification

Existing `mergePageIntoContent` tests must continue to pass:
- "adds new items from page"
- "overwrites existing items with IC data, preserving local fields" (vSignal, topics, imageUrl)
- "prefers IC data when both have values"
- "handles empty page"
- "handles empty existing"

### Integration test (optional)

A test in ContentContext-ic.test.tsx or a new file simulating the full flow:
1. setContent(items with translation)
2. Trigger loadFromIC
3. Verify translation is still on items after IC pages merge

This is more useful for catching regressions but more complex to set up. Leave as optional follow-up.

---

## 8. Unknowns + risks

### Unknowns
1. **How many users are affected?** Without Sentry, can't quantify. The user report is one data point. The bug affects every authenticated user on every reload, so the impact is broad even if only one user reported it.
2. **Is `nostrPubkey` actually being set anywhere on local items?** The field is in the type but I haven't traced who writes it. If nothing writes it locally, the preservation is moot but still defensive.
3. **Do other code paths also wipe translation?** I should grep for any setContent that creates ContentItems from external sources (RSS fetchers, Nostr fetchers, addContent path, etc.). If those drop translation on import, the bug is wider than just the merge.

### Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Adding fields to merge preserves "stale" cached data when IC truly has updates (e.g. user re-translated to a different language on another device → IC doesn't know, cached has old) | LOW | Translation is local-only currently. Until/unless we sync translations to IC, this is impossible. |
| R2 | Test for "preserves nostrPubkey" passes accidentally because nothing populates nostrPubkey on the IC side | MEDIUM | The test covers the merge function in isolation. It's correct regardless of who populates the fields. |
| R3 | A future field is added to ContentItem and forgotten in the merge | HIGH | Add an exhaustive check / type-level constraint OR rewrite mergePageIntoContent as `{ ...cached, ...nonNullFromIC }`. The latter inverts the merge to default to cached and let IC override only non-null fields. Cleaner but may have unintended consequences (validated state etc.). |
| R4 | Phase 1 / Hotfix 1 / Hotfix 2 introduced something that interacts poorly with the merge | LOW | The merge function hasn't changed since Phase 1. The new validator and retry logic operate downstream. Investigation confirms they don't touch the merge. |

### The bigger fix (R3 mitigation)

A cleaner long-term fix is to invert the merge:

```ts
const merged = pageItems.map(l => {
  const cached = cachedById.get(l.id);
  if (!cached) return l;
  // Start from cached, override with NON-NULL IC fields. This way any
  // local-only field automatically survives without an explicit allow-list.
  return {
    ...cached,
    ...Object.fromEntries(
      Object.entries(l).filter(([_, v]) => v !== undefined && v !== null),
    ),
  };
});
```

But this changes semantics: IC currently WINS on `validated`, `flagged`, `scores`, etc. (always non-null in the IC version). The inversion would let IC override these because they're non-null. So actually it ends up equivalent for those fields.

The risk: IC `validated: false` would override cached `validated: true` if the IC reload runs before the user's local validation has been pushed to IC. This is the existing behavior anyway (the explicit `...l` does the same).

I think the inversion is cleaner and lower-risk than maintaining an explicit allow-list. **But for this bug fix, the targeted addition of `translation` and `nostrPubkey` is faster and safer.** The structural cleanup can be a follow-up.

---

## 9. Implementation steps (proposed order)

1. Add 4 tests in `__tests__/contexts/content/icSync.test.ts` for the preservation properties (red, then green)
2. Update `mergePageIntoContent` in `contexts/content/icSync.ts` to add `translation` and `nostrPubkey` to the preservation list
3. (Optional) audit `addContent` and content fetcher paths for similar issues
4. Run the full test suite + lint + build
5. Commit with explicit explanation
6. Push + deploy
7. Verify production with `/api/health` and ask user to retest

**Estimated effort**: 30-60 minutes for the targeted fix. The "bigger fix" inversion would be 2-3 hours including test rewrites.

---

## 10. Open questions for user

1. **Is this fix scope OK?** Targeted addition of `translation` + `nostrPubkey` to the merge preservation list, plus tests. NO refactor of merge semantics, NO change to translation cache size, NO new auto-translate logic.
2. **Should I also fix `scoredByAI` / `scoringEngine` preservation in the same pass?** These are minor display fields. Low impact.
3. **Should the auto-translate effect notify per-item** (suppress the "no backend" message when only some items failed)? Currently the second notification fires once per language. This is independent of the merge bug.
4. **Translation cache size** — bump from 200 entries to 1000? This is a follow-up but worth deciding now if we want to avoid the same user reporting "old translations re-fetch" later.

---

## 11. Phase relationship

This is **not** Phase 2 of the IC LLM Translation Quality plan. Phase 2 (Qwen3_32B switch + chat API) is still pending and unaffected.

This is **Hotfix 3** of the Phase 1 deployment, fixing a pre-existing latent bug that became user-visible because:
- Phase 1 increased the rate of successful translations (more items get translated → more items lose their translation on reload → user noticed)
- Hotfix 1 (retry) and Hotfix 2 (meta-prefix strip + named errors) reduced the noise so the residual "translation disappeared" symptom became clearer

The merge bug existed since the initial implementation of `mergePageIntoContent`. It would have manifested for any user who relied on local-only fields (translation, nostrPubkey) and reloaded after IC sync. Phase 1 just made it noticeable.

---

## 12. Awaiting approval

**No code is written yet.** I need user OK on:
- The fix scope (targeted preservation, not full merge inversion)
- Whether to include `scoredByAI` / `scoringEngine` in the same pass
- Whether to bump translation cache size as a follow-up
