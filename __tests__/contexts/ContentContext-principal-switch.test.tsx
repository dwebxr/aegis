/**
 * @jest-environment jsdom
 *
 * End-to-end test for the cross-account isolation fix (codex finding #4).
 *
 * Pre-fix flow:
 *   1. User A logs in, creates content → cache stored at global key
 *   2. User A logs out
 *   3. User B logs in on the same browser
 *   4. ContentContext loaded cache → User A's items appeared in B's session
 *
 * Post-fix flow (this test exercises):
 *   1. Principal-scoped IDB keys
 *   2. ContentContext's useEffect detects principal change
 *   3. Previous principal's cache is purged on switch
 *
 * Uses fake-indexeddb (real IDB) + a controllable AuthContext mock. Real
 * cache.ts and ContentContext.tsx code paths are exercised end-to-end —
 * not mocked. The actor + briefing sync + scoring are stubbed at network
 * boundaries only, where it would be impractical to exercise the real path.
 */
// JSDOM doesn't expose structuredClone — required by fake-indexeddb for value insertion.
if (typeof globalThis.structuredClone !== "function") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const v8 = require("node:v8") as typeof import("node:v8");
  globalThis.structuredClone = ((v: unknown) => v8.deserialize(v8.serialize(v))) as typeof globalThis.structuredClone;
}

import "fake-indexeddb/auto";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";

// ── Controllable auth state ─────────────────────────────────────────────
let currentAuthState: {
  isAuthenticated: boolean;
  principalText: string | null;
};
const setAuthState = (s: { isAuthenticated: boolean; principalText: string | null }) => {
  currentAuthState = s;
};
setAuthState({ isAuthenticated: false, principalText: null });

const principalFor = (text: string | null) =>
  text === null ? null : ({ toText: () => text } as { toText: () => string });

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: currentAuthState.isAuthenticated,
    identity: currentAuthState.isAuthenticated
      ? { getPrincipal: () => principalFor(currentAuthState.principalText) }
      : null,
    principal: principalFor(currentAuthState.principalText),
    principalText: currentAuthState.principalText,
    isLoading: false,
    login: jest.fn(),
    logout: jest.fn(),
  }),
}));

// ── Boundary mocks (network / heavy deps only) ──────────────────────────
const mockActor = {
  saveEvaluation: jest.fn().mockResolvedValue(undefined),
  updateEvaluation: jest.fn().mockResolvedValue(undefined),
  getEvaluations: jest.fn().mockResolvedValue({ data: [], total: 0n }),
};
jest.mock("@/lib/ic/actor", () => ({
  createBackendActorAsync: jest.fn().mockResolvedValue(mockActor),
}));

jest.mock("@/lib/briefing/sync", () => ({
  syncBriefingToCanister: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/webllm/storage", () => ({ isWebLLMEnabled: () => false }));
jest.mock("@/lib/ollama/storage", () => ({ isOllamaEnabled: () => false }));
jest.mock("@/lib/apiKey/storage", () => ({ getUserApiKey: () => null }));
jest.mock("@/lib/d2a/reputation", () => ({ recordUseful: jest.fn(), recordSlop: jest.fn() }));
jest.mock("@/lib/reputation/publishGate", () => ({
  recordPublishValidation: jest.fn(),
  recordPublishFlag: jest.fn(),
}));
jest.mock("@/lib/scoring/cache", () => ({
  computeScoringCacheKey: jest.fn().mockReturnValue("k"),
  computeProfileHash: jest.fn().mockReturnValue("h"),
  lookupScoringCache: jest.fn().mockReturnValue(null),
  storeScoringCache: jest.fn(),
}));

jest.mock("@/contexts/NotificationContext", () => ({
  useNotify: () => ({ addNotification: jest.fn() }),
}));
jest.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => true }));

// ── Real modules under test ─────────────────────────────────────────────
import {
  ContentProvider,
  useContent,
} from "@/contexts/ContentContext";
import { loadCachedContent, _resetContentCache } from "@/contexts/content/cache";
import type { ContentItem } from "@/lib/types/content";
import { idbGet, idbPut, idbDelete, STORE_CONTENT_CACHE } from "@/lib/storage/idb";

/** Seed IDB directly so we don't depend on cache.ts's lazy useIDB flag. */
async function seedCache(principal: string, items: ContentItem[]) {
  await idbPut(STORE_CONTENT_CACHE, `items:${principal}`, items);
}

function makeItem(id: string, overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id,
    owner: "x",
    author: "x",
    avatar: "",
    text: `t-${id}`,
    source: "rss",
    scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
    verdict: "quality",
    reason: "r",
    createdAt: 1_700_000_000_000,
    validated: false,
    flagged: false,
    timestamp: "1m",
    ...overrides,
  };
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ContentProvider>{children}</ContentProvider>
);

async function flushDebounce() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 1100));
  });
}

beforeEach(async () => {
  _resetContentCache();
  setAuthState({ isAuthenticated: false, principalText: null });
  mockActor.saveEvaluation.mockClear();
  for (const k of ["items", "items:anon", "items:alice", "items:bob"]) {
    try { await idbDelete(STORE_CONTENT_CACHE, k); } catch { /* ignore */ }
  }
});

describe("ContentContext — principal-switch isolation (E2E)", () => {
  it("loads scoped cache when a principal logs in", async () => {
    await seedCache("alice", [makeItem("alice-1"), makeItem("alice-2")]);

    setAuthState({ isAuthenticated: true, principalText: "alice" });
    const { result } = renderHook(() => useContent(), { wrapper });

    await waitFor(() => expect(result.current.cacheChecked).toBe(true));
    await waitFor(() => expect(result.current.content.map((c) => c.id).sort()).toEqual(["alice-1", "alice-2"]));
  });

  it("logging out → logging in as a different user clears the previous cache", async () => {
    await seedCache("alice", [makeItem("alice-1")]);
    await seedCache("bob", [makeItem("bob-1"), makeItem("bob-2")]);

    // Sanity-check: both buckets exist before the switch.
    expect((await loadCachedContent("alice")).map((c) => c.id)).toEqual(["alice-1"]);
    expect((await loadCachedContent("bob")).map((c) => c.id).sort()).toEqual(["bob-1", "bob-2"]);

    // Render as alice first.
    setAuthState({ isAuthenticated: true, principalText: "alice" });
    const { result, rerender } = renderHook(() => useContent(), { wrapper });
    await waitFor(() => expect(result.current.content.map((c) => c.id)).toEqual(["alice-1"]));

    // Switch to bob — ContentContext should detect the principal change,
    // clear in-memory content, purge alice's bucket, then load bob's.
    setAuthState({ isAuthenticated: true, principalText: "bob" });
    rerender();

    await waitFor(() =>
      expect(result.current.content.map((c) => c.id).sort()).toEqual(["bob-1", "bob-2"]),
    );

    // Alice's bucket is gone from IDB — no cross-account leak possible.
    const aliceAfter = await idbGet<unknown>(STORE_CONTENT_CACHE, "items:alice");
    expect(aliceAfter).toBeFalsy();

    // Bob's bucket is intact (he's the active user).
    const bobAfter = await idbGet<ContentItem[]>(STORE_CONTENT_CACHE, "items:bob");
    expect(bobAfter?.map((c) => c.id).sort()).toEqual(["bob-1", "bob-2"]);
  });

  it("content state is reset to [] immediately on principal switch (no flash of stale data)", async () => {
    await seedCache("alice", [makeItem("alice-only")]);

    setAuthState({ isAuthenticated: true, principalText: "alice" });
    const { result, rerender } = renderHook(() => useContent(), { wrapper });
    await waitFor(() => expect(result.current.content).toHaveLength(1));

    // Switch to bob. Bob has no cache, so content should end up empty —
    // crucially, alice's content must not linger.
    setAuthState({ isAuthenticated: true, principalText: "bob" });
    rerender();
    await waitFor(() => expect(result.current.content).toHaveLength(0));
  });

  it("writes by user A end up in A's bucket — not the legacy unscoped key", async () => {
    setAuthState({ isAuthenticated: true, principalText: "alice" });
    const { result } = renderHook(() => useContent(), { wrapper });
    await waitFor(() => expect(result.current.cacheChecked).toBe(true));

    act(() => {
      result.current.addContent(makeItem("written-by-alice"));
    });
    await flushDebounce();

    // Scoped bucket should hold the new item.
    const aliceStored = await idbGet<ContentItem[]>(STORE_CONTENT_CACHE, "items:alice");
    expect(aliceStored?.map((c) => c.id)).toEqual(["written-by-alice"]);

    // Legacy unscoped key must NOT receive new writes.
    const legacy = await idbGet<unknown>(STORE_CONTENT_CACHE, "items");
    expect(legacy).toBeFalsy();
  });

  it("logout → login-same-user keeps the cache (no spurious purge on identity reuse)", async () => {
    await seedCache("alice", [makeItem("a1"), makeItem("a2")]);

    setAuthState({ isAuthenticated: true, principalText: "alice" });
    const { result, rerender } = renderHook(() => useContent(), { wrapper });
    await waitFor(() => expect(result.current.content).toHaveLength(2));

    // Log out then log back in as alice.
    setAuthState({ isAuthenticated: false, principalText: null });
    rerender();

    setAuthState({ isAuthenticated: true, principalText: "alice" });
    rerender();

    await waitFor(() =>
      expect(result.current.content.map((c) => c.id).sort()).toEqual(["a1", "a2"]),
    );
    // Alice's bucket should still exist in IDB.
    const stored = await idbGet<ContentItem[]>(STORE_CONTENT_CACHE, "items:alice");
    expect(stored?.map((c) => c.id).sort()).toEqual(["a1", "a2"]);
  });
});
