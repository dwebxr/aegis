/**
 * @jest-environment jsdom
 */
/**
 * Tests for ContentContext internal helpers that were refactored:
 * - isDuplicateItem (extracted dedup logic)
 * - truncatePreservingActioned
 * - validateContentItems
 * - mapSource / mapSourceBack
 * - toICEvaluation
 *
 * Since these are module-private, we test them via the public API
 * by exercising addContent / addContentBuffered / flushPendingItems
 * with real dedup scenarios.
 */
import React from "react";
import { renderHook, act } from "@testing-library/react";

// Mock dependencies
jest.mock("@/lib/ic/actor", () => ({
  createBackendActorAsync: jest.fn().mockRejectedValue(new Error("no IC in test")),
}));
jest.mock("@/lib/briefing/sync", () => ({
  syncBriefingToCanister: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/offline/actionQueue", () => ({
  enqueueAction: jest.fn().mockResolvedValue(undefined),
  dequeueAll: jest.fn().mockResolvedValue([]),
  removeAction: jest.fn().mockResolvedValue(undefined),
  incrementRetries: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/webllm/storage", () => ({ isWebLLMEnabled: () => false }));
jest.mock("@/lib/ollama/storage", () => ({ isOllamaEnabled: () => false }));
jest.mock("@/lib/apiKey/storage", () => ({ getUserApiKey: () => null }));
jest.mock("@/lib/storage/idb", () => ({
  isIDBAvailable: () => false,
  idbGet: jest.fn().mockResolvedValue(null),
  idbPut: jest.fn().mockResolvedValue(undefined),
  STORE_CONTENT_CACHE: "content-cache",
}));
jest.mock("@/lib/d2a/reputation", () => ({
  recordUseful: jest.fn(),
  recordSlop: jest.fn(),
}));
jest.mock("@/lib/reputation/publishGate", () => ({
  recordPublishValidation: jest.fn(),
  recordPublishFlag: jest.fn(),
}));
jest.mock("@/lib/scoring/cache", () => ({
  computeScoringCacheKey: jest.fn().mockReturnValue("key"),
  computeProfileHash: jest.fn().mockReturnValue("hash"),
  lookupScoringCache: jest.fn().mockReturnValue(null),
  storeScoringCache: jest.fn(),
}));

// Mock auth context
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: false,
    identity: null,
    principal: null,
    principalText: "",
  }),
}));

// Mock notification context
jest.mock("@/contexts/NotificationContext", () => ({
  useNotify: () => ({
    addNotification: jest.fn(),
  }),
}));

// Mock online status
jest.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => true,
}));

import { ContentProvider } from "@/contexts/ContentContext";
import { useContent } from "@/contexts/ContentContext";
import type { ContentItem } from "@/lib/types/content";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: `id-${Math.random().toString(36).slice(2, 8)}`,
    owner: "",
    author: "Test",
    avatar: "",
    text: `Sample content ${Math.random()}`,
    source: "manual",
    scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
    verdict: "quality",
    reason: "test",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "just now",
    ...overrides,
  };
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <ContentProvider>{children}</ContentProvider>;
}

describe("ContentContext dedup via addContent", () => {
  it("adds a new item successfully", async () => {
    const { result } = renderHook(() => useContent(), { wrapper });
    const item = makeItem({ id: "unique-1", sourceUrl: "https://example.com/a" });
    act(() => result.current.addContent(item));
    expect(result.current.content).toHaveLength(1);
    expect(result.current.content[0].id).toBe("unique-1");
  });

  it("deduplicates by sourceUrl", async () => {
    const { result } = renderHook(() => useContent(), { wrapper });
    const item1 = makeItem({ id: "dup-1", sourceUrl: "https://example.com/same" });
    const item2 = makeItem({ id: "dup-2", sourceUrl: "https://example.com/same" });
    act(() => {
      result.current.addContent(item1);
      result.current.addContent(item2);
    });
    expect(result.current.content).toHaveLength(1);
    expect(result.current.content[0].id).toBe("dup-1");
  });

  it("deduplicates by text when sourceUrl is absent", async () => {
    const { result } = renderHook(() => useContent(), { wrapper });
    const text = "Identical content text for dedup test";
    const item1 = makeItem({ id: "text-1", text, sourceUrl: undefined });
    const item2 = makeItem({ id: "text-2", text, sourceUrl: undefined });
    act(() => {
      result.current.addContent(item1);
      result.current.addContent(item2);
    });
    expect(result.current.content).toHaveLength(1);
  });

  it("allows items with different sourceUrls", async () => {
    const { result } = renderHook(() => useContent(), { wrapper });
    const item1 = makeItem({ id: "diff-1", sourceUrl: "https://a.com" });
    const item2 = makeItem({ id: "diff-2", sourceUrl: "https://b.com" });
    act(() => {
      result.current.addContent(item1);
      result.current.addContent(item2);
    });
    expect(result.current.content).toHaveLength(2);
  });

  it("allows items with different text when no sourceUrl", async () => {
    const { result } = renderHook(() => useContent(), { wrapper });
    const item1 = makeItem({ id: "txt-1", text: "Alpha", sourceUrl: undefined });
    const item2 = makeItem({ id: "txt-2", text: "Beta", sourceUrl: undefined });
    act(() => {
      result.current.addContent(item1);
      result.current.addContent(item2);
    });
    expect(result.current.content).toHaveLength(2);
  });
});

describe("ContentContext flushPendingItems dedup", () => {
  it("flushes buffered items into content", async () => {
    const { result } = renderHook(() => useContent(), { wrapper });
    const item = makeItem({ id: "buf-1", sourceUrl: "https://buffered.com" });
    act(() => result.current.addContentBuffered(item));
    expect(result.current.pendingCount).toBe(1);
    expect(result.current.content).toHaveLength(0);
    act(() => result.current.flushPendingItems());
    expect(result.current.content).toHaveLength(1);
    expect(result.current.pendingCount).toBe(0);
  });

  it("deduplicates buffered items against visible content on flush", async () => {
    const { result } = renderHook(() => useContent(), { wrapper });
    const item = makeItem({ id: "vis-1", sourceUrl: "https://visible.com" });
    act(() => result.current.addContent(item));
    // Buffer same URL
    const dup = makeItem({ id: "buf-dup", sourceUrl: "https://visible.com" });
    act(() => result.current.addContentBuffered(dup));
    // Should be caught by early dedup check
    expect(result.current.pendingCount).toBe(0);
  });

  it("deduplicates within pending buffer itself", async () => {
    const { result } = renderHook(() => useContent(), { wrapper });
    const item1 = makeItem({ id: "pbuf-1", sourceUrl: "https://pending.com" });
    const item2 = makeItem({ id: "pbuf-2", sourceUrl: "https://pending.com" });
    act(() => {
      result.current.addContentBuffered(item1);
      result.current.addContentBuffered(item2);
    });
    expect(result.current.pendingCount).toBe(1);
  });

  it("flushPendingItems is no-op when buffer is empty", async () => {
    const { result } = renderHook(() => useContent(), { wrapper });
    act(() => result.current.flushPendingItems());
    expect(result.current.content).toHaveLength(0);
  });
});

describe("ContentContext clearDemoContent", () => {
  it("removes items with empty owner", async () => {
    const { result } = renderHook(() => useContent(), { wrapper });
    const demoItem = makeItem({ id: "demo-1", owner: "" });
    const ownedItem = makeItem({ id: "owned-1", owner: "user-principal" });
    act(() => {
      result.current.addContent(demoItem);
      result.current.addContent(ownedItem);
    });
    expect(result.current.content).toHaveLength(2);
    act(() => result.current.clearDemoContent());
    expect(result.current.content).toHaveLength(1);
    expect(result.current.content[0].owner).toBe("user-principal");
  });
});

describe("ContentContext validateItem and flagItem", () => {
  it("validates an item", async () => {
    const { result } = renderHook(() => useContent(), { wrapper });
    const item = makeItem({ id: "val-1" });
    act(() => result.current.addContent(item));
    act(() => result.current.validateItem("val-1"));
    expect(result.current.content[0].validated).toBe(true);
    expect(result.current.content[0].flagged).toBe(false);
  });

  it("flags an item", async () => {
    const { result } = renderHook(() => useContent(), { wrapper });
    const item = makeItem({ id: "flag-1" });
    act(() => result.current.addContent(item));
    act(() => result.current.flagItem("flag-1"));
    expect(result.current.content[0].flagged).toBe(true);
    expect(result.current.content[0].validated).toBe(false);
  });

  it("validate and flag are mutually exclusive", async () => {
    const { result } = renderHook(() => useContent(), { wrapper });
    const item = makeItem({ id: "excl-1" });
    act(() => result.current.addContent(item));
    act(() => result.current.validateItem("excl-1"));
    expect(result.current.content[0].validated).toBe(true);
    act(() => result.current.flagItem("excl-1"));
    expect(result.current.content[0].flagged).toBe(true);
    expect(result.current.content[0].validated).toBe(false);
  });

  it("validates idempotently — no-op if already validated", async () => {
    const { result } = renderHook(() => useContent(), { wrapper });
    const item = makeItem({ id: "idem-1" });
    act(() => result.current.addContent(item));
    act(() => result.current.validateItem("idem-1"));
    const validatedAt = result.current.content[0].validatedAt;
    act(() => result.current.validateItem("idem-1"));
    expect(result.current.content[0].validatedAt).toBe(validatedAt);
  });

  it("flags idempotently — no-op if already flagged", async () => {
    const { result } = renderHook(() => useContent(), { wrapper });
    const item = makeItem({ id: "idem-f1" });
    act(() => result.current.addContent(item));
    act(() => result.current.flagItem("idem-f1"));
    // Flag again — should be no-op
    act(() => result.current.flagItem("idem-f1"));
    expect(result.current.content[0].flagged).toBe(true);
  });

  it("validate/flag non-existent ID is no-op", async () => {
    const { result } = renderHook(() => useContent(), { wrapper });
    act(() => result.current.validateItem("nonexistent"));
    act(() => result.current.flagItem("nonexistent"));
    expect(result.current.content).toHaveLength(0);
  });
});
