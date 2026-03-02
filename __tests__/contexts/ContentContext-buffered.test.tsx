/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, act, screen } from "@testing-library/react";
import type { ContentItem } from "@/lib/types/content";

// ─── Mocks ───────────────────────────────────────────────────────────
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: false,
    identity: null,
    principal: null,
    login: jest.fn(),
    logout: jest.fn(),
  }),
}));

jest.mock("@/contexts/NotificationContext", () => ({
  useNotify: () => ({
    addNotification: jest.fn(),
    notifications: [],
    removeNotification: jest.fn(),
  }),
}));

jest.mock("@/lib/ic/actor", () => ({
  createBackendActorAsync: jest.fn(),
}));

jest.mock("@/lib/offline/actionQueue", () => ({
  enqueueAction: jest.fn(),
  dequeueAll: jest.fn().mockResolvedValue([]),
  removeAction: jest.fn(),
  incrementRetries: jest.fn(),
}));

jest.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => true,
}));

jest.mock("@/lib/storage/idb", () => ({
  isIDBAvailable: () => false,
  idbGet: jest.fn().mockResolvedValue(undefined),
  idbPut: jest.fn().mockResolvedValue(undefined),
  STORE_CONTENT_CACHE: "content-cache",
}));

jest.mock("@/lib/scoring/cache", () => ({
  computeScoringCacheKey: jest.fn(),
  computeProfileHash: jest.fn(),
  lookupScoringCache: jest.fn().mockReturnValue(null),
  storeScoringCache: jest.fn(),
}));

jest.mock("@/lib/d2a/reputation", () => ({
  recordUseful: jest.fn(),
  recordSlop: jest.fn(),
}));

jest.mock("@/lib/reputation/publishGate", () => ({
  recordPublishValidation: jest.fn(),
  recordPublishFlag: jest.fn(),
}));

jest.mock("@/lib/apiKey/storage", () => ({
  getUserApiKey: jest.fn().mockReturnValue(null),
}));

jest.mock("@/lib/webllm/storage", () => ({
  isWebLLMEnabled: jest.fn().mockReturnValue(false),
}));

jest.mock("@/lib/ollama/storage", () => ({
  isOllamaEnabled: jest.fn().mockReturnValue(false),
}));

jest.mock("@/lib/briefing/sync", () => ({
  syncBriefingToCanister: jest.fn(),
}));

// ─── Import after mocks ─────────────────────────────────────────────
import { ContentProvider, useContent } from "@/contexts/ContentContext";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "item-" + Math.random().toString(36).slice(2, 8),
    owner: "",
    author: "author",
    avatar: "",
    text: "test content " + Math.random(),
    source: "rss" as const,
    scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
    verdict: "quality" as const,
    reason: "test",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "just now",
    ...overrides,
  };
}

// Harness component that exposes ContentContext values to tests
let testHarness: {
  content: ContentItem[];
  pendingCount: number;
  addContentBuffered: (item: ContentItem) => void;
  addContent: (item: ContentItem) => void;
  flushPendingItems: () => void;
};

function Harness() {
  const ctx = useContent();
  testHarness = {
    content: ctx.content,
    pendingCount: ctx.pendingCount,
    addContentBuffered: ctx.addContentBuffered,
    addContent: ctx.addContent,
    flushPendingItems: ctx.flushPendingItems,
  };
  return (
    <div>
      <span data-testid="count">{ctx.content.length}</span>
      <span data-testid="pending">{ctx.pendingCount}</span>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <ContentProvider>
      <Harness />
    </ContentProvider>,
  );
}

describe("ContentContext — buffered content (addContentBuffered / flushPendingItems)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("addContentBuffered increments pendingCount without changing visible content", () => {
    renderWithProvider();
    const item = makeItem();

    act(() => {
      testHarness.addContentBuffered(item);
    });

    expect(screen.getByTestId("pending").textContent).toBe("1");
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("flushPendingItems moves buffered items to visible content", () => {
    renderWithProvider();
    const item1 = makeItem({ id: "a1" });
    const item2 = makeItem({ id: "a2" });

    act(() => {
      testHarness.addContentBuffered(item1);
      testHarness.addContentBuffered(item2);
    });

    expect(screen.getByTestId("pending").textContent).toBe("2");
    expect(screen.getByTestId("count").textContent).toBe("0");

    act(() => {
      testHarness.flushPendingItems();
    });

    expect(screen.getByTestId("pending").textContent).toBe("0");
    expect(screen.getByTestId("count").textContent).toBe("2");
  });

  it("flushPendingItems is no-op when buffer is empty", () => {
    renderWithProvider();

    act(() => {
      testHarness.flushPendingItems();
    });

    expect(screen.getByTestId("pending").textContent).toBe("0");
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("deduplicates against visible content (by sourceUrl)", () => {
    renderWithProvider();
    const item = makeItem({ sourceUrl: "https://example.com/1" });

    // Add to visible content first
    act(() => {
      testHarness.addContent(item);
    });
    expect(screen.getByTestId("count").textContent).toBe("1");

    // Try to buffer the same item
    act(() => {
      testHarness.addContentBuffered(makeItem({ sourceUrl: "https://example.com/1" }));
    });

    // Should be rejected as duplicate
    expect(screen.getByTestId("pending").textContent).toBe("0");
  });

  it("deduplicates against pending buffer (by sourceUrl)", () => {
    renderWithProvider();
    const item1 = makeItem({ sourceUrl: "https://example.com/dup" });
    const item2 = makeItem({ sourceUrl: "https://example.com/dup" });

    act(() => {
      testHarness.addContentBuffered(item1);
      testHarness.addContentBuffered(item2);
    });

    // Second item should be rejected
    expect(screen.getByTestId("pending").textContent).toBe("1");
  });

  it("deduplicates against pending buffer (by text when no sourceUrl)", () => {
    renderWithProvider();
    const item1 = makeItem({ text: "same text content", sourceUrl: undefined });
    const item2 = makeItem({ text: "same text content", sourceUrl: undefined });

    act(() => {
      testHarness.addContentBuffered(item1);
      testHarness.addContentBuffered(item2);
    });

    expect(screen.getByTestId("pending").textContent).toBe("1");
  });

  it("auto-flushes at MAX_PENDING_BUFFER (100)", () => {
    renderWithProvider();

    act(() => {
      for (let i = 0; i < 100; i++) {
        testHarness.addContentBuffered(makeItem({ id: `auto-${i}`, text: `unique ${i}` }));
      }
    });

    // Buffer should have auto-flushed at 100
    expect(screen.getByTestId("pending").textContent).toBe("0");
    expect(screen.getByTestId("count").textContent).toBe("100");
  });

  it("addContent adds items immediately (not buffered)", () => {
    renderWithProvider();
    const item = makeItem();

    act(() => {
      testHarness.addContent(item);
    });

    expect(screen.getByTestId("count").textContent).toBe("1");
    expect(screen.getByTestId("pending").textContent).toBe("0");
  });
});
