/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, act, screen, cleanup } from "@testing-library/react";
import type { ContentItem } from "@/lib/types/content";
import { Principal } from "@dfinity/principal";

// ─── Mocks ───────────────────────────────────────────────────────────
const mockGetUserEvaluations = jest.fn();
const mockCreateActor = jest.fn();

const mockAddNotification = jest.fn();
jest.mock("@/contexts/NotificationContext", () => ({
  useNotify: () => ({
    addNotification: mockAddNotification,
    notifications: [],
    removeNotification: jest.fn(),
  }),
}));

const mockIdentity = { getPrincipal: () => Principal.anonymous() };
const mockPrincipal = Principal.anonymous();
const mockLogin = jest.fn();
const mockLogout = jest.fn();
jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    identity: mockIdentity,
    principal: mockPrincipal,
    login: mockLogin,
    logout: mockLogout,
  }),
}));

jest.mock("@/lib/ic/actor", () => ({
  createBackendActorAsync: (...args: unknown[]) => mockCreateActor(...args),
}));

jest.mock("@/lib/offline/actionQueue", () => ({
  enqueueAction: jest.fn(),
  dequeueAll: jest.fn().mockResolvedValue([]),
  removeAction: jest.fn(),
  incrementRetries: jest.fn(),
}));

jest.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => true }));

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

jest.mock("@/lib/d2a/reputation", () => ({ recordUseful: jest.fn(), recordSlop: jest.fn() }));
jest.mock("@/lib/reputation/publishGate", () => ({ recordPublishValidation: jest.fn(), recordPublishFlag: jest.fn() }));
jest.mock("@/lib/apiKey/storage", () => ({ getUserApiKey: jest.fn().mockReturnValue(null) }));
jest.mock("@/lib/webllm/storage", () => ({ isWebLLMEnabled: jest.fn().mockReturnValue(false) }));
jest.mock("@/lib/ollama/storage", () => ({ isOllamaEnabled: jest.fn().mockReturnValue(false) }));
jest.mock("@/lib/briefing/sync", () => ({ syncBriefingToCanister: jest.fn() }));

// ─── Import after mocks ─────────────────────────────────────────────
import { ContentProvider, useContent } from "@/contexts/ContentContext";

function makeICEval(id: string, text = "content") {
  return {
    id,
    owner: Principal.anonymous(),
    author: "author",
    avatar: "",
    text,
    source: { rss: null },
    sourceUrl: [] as string[],
    imageUrl: [] as string[],
    scores: { originality: 7, insight: 7, credibility: 7, compositeScore: 7 },
    verdict: { quality: null },
    reason: "test reason",
    createdAt: BigInt(Date.now()) * BigInt(1_000_000),
    validated: false,
    flagged: false,
    validatedAt: [] as bigint[],
  };
}

/** Flush microtask queue to let async chains resolve. */
async function flush(n = 20) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

// Test harness — captures context value
let ctx: ReturnType<typeof useContent>;

function Harness() {
  ctx = useContent();
  return (
    <div>
      <span data-testid="count">{ctx.content.length}</span>
      <span data-testid="sync">{ctx.syncStatus}</span>
      <span data-testid="cache">{ctx.cacheChecked ? "yes" : "no"}</span>
    </div>
  );
}

/** Render the provider, wait for initial mount + auto-loadFromIC to settle. */
async function renderAndSettle() {
  render(
    <ContentProvider>
      <Harness />
    </ContentProvider>,
  );
  // Settle: cache load + actor creation + auto-loadFromIC (empty array → synced)
  await act(async () => {
    await flush(30);
    jest.advanceTimersByTime(200);
    await flush(30);
  });
}

describe("ContentContext — IC sync, cacheChecked, field mapping", () => {
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const originalConsoleInfo = console.info;

  beforeEach(() => {
    jest.useFakeTimers();
    mockGetUserEvaluations.mockReset();
    mockGetUserEvaluations.mockResolvedValue([]);
    mockCreateActor.mockReset();
    mockCreateActor.mockResolvedValue({
      getUserEvaluations: mockGetUserEvaluations,
      saveEvaluation: jest.fn().mockResolvedValue(undefined),
      updateEvaluation: jest.fn().mockResolvedValue(undefined),
    });
    mockAddNotification.mockClear();
    console.error = jest.fn();
    console.warn = jest.fn();
    console.info = jest.fn();
  });

  afterEach(() => {
    cleanup();
    jest.clearAllTimers();
    jest.useRealTimers();
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    console.info = originalConsoleInfo;
  });

  it("cacheChecked becomes true after cache load completes", async () => {
    render(
      <ContentProvider>
        <Harness />
      </ContentProvider>,
    );
    expect(screen.getByTestId("cache").textContent).toBe("no");

    await act(async () => { await flush(); });

    expect(screen.getByTestId("cache").textContent).toBe("yes");
  });

  it("loadFromIC maps items and sets synced status", async () => {
    await renderAndSettle();
    expect(screen.getByTestId("sync").textContent).toBe("synced");
    expect(Number(screen.getByTestId("count").textContent)).toBe(0);

    // Set up mock for the next loadFromIC call
    const items = [makeICEval("item-a"), makeICEval("item-b")];
    mockGetUserEvaluations.mockResolvedValueOnce(items);

    await act(async () => {
      await ctx.loadFromIC();
      await flush(10);
    });

    expect(Number(screen.getByTestId("count").textContent)).toBe(2);
    expect(screen.getByTestId("sync").textContent).toBe("synced");
  });

  it("first loadFromIC failure does not immediately set offline (retry scheduled)", async () => {
    await renderAndSettle();

    mockGetUserEvaluations.mockRejectedValueOnce(new Error("network error"));

    await act(async () => {
      await ctx.loadFromIC();
    });

    // After first failure, retry is scheduled — status is "idle", not "offline"
    expect(screen.getByTestId("sync").textContent).toBe("idle");
  });

  it("second consecutive loadFromIC failure sets offline", async () => {
    await renderAndSettle();

    // First failure → sets retry flag
    mockGetUserEvaluations.mockRejectedValueOnce(new Error("error 1"));
    await act(async () => { await ctx.loadFromIC(); });
    expect(screen.getByTestId("sync").textContent).toBe("idle");

    // Second failure → exceeds retry limit → offline
    mockGetUserEvaluations.mockRejectedValueOnce(new Error("error 2"));
    await act(async () => { await ctx.loadFromIC(); });
    expect(screen.getByTestId("sync").textContent).toBe("offline");
  });

  it("successful loadFromIC after failure resets retry counter", async () => {
    await renderAndSettle();

    // First failure
    mockGetUserEvaluations.mockRejectedValueOnce(new Error("transient"));
    await act(async () => { await ctx.loadFromIC(); });
    expect(screen.getByTestId("sync").textContent).toBe("idle");

    // Success → resets counter
    const items = [makeICEval("recovered")];
    mockGetUserEvaluations.mockResolvedValueOnce(items);
    await act(async () => { await ctx.loadFromIC(); });
    expect(screen.getByTestId("sync").textContent).toBe("synced");
    expect(Number(screen.getByTestId("count").textContent)).toBe(1);

    // Another failure → would be first failure again (counter was reset)
    mockGetUserEvaluations.mockRejectedValueOnce(new Error("transient again"));
    await act(async () => { await ctx.loadFromIC(); });
    expect(screen.getByTestId("sync").textContent).toBe("idle"); // not "offline"
  });

  it("evalToContentItem correctly maps IC evaluation fields", async () => {
    await renderAndSettle();

    const eval1 = makeICEval("map-test", "hello world");
    mockGetUserEvaluations.mockResolvedValueOnce([eval1]);

    await act(async () => {
      await ctx.loadFromIC();
      await flush(10);
    });

    expect(ctx.content.length).toBe(1);
    expect(ctx.content[0].id).toBe("map-test");
    expect(ctx.content[0].text).toBe("hello world");
    expect(ctx.content[0].verdict).toBe("quality");
    expect(ctx.content[0].source).toBe("rss");
  });

  it("mergePageIntoContent preserves locally-enriched fields from cache", async () => {
    await renderAndSettle();

    const cachedItem: ContentItem = {
      id: "merge-test",
      owner: "",
      author: "author",
      avatar: "",
      text: "cached",
      source: "rss",
      scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
      verdict: "quality",
      reason: "cached reason",
      createdAt: Date.now(),
      validated: false,
      flagged: false,
      timestamp: "1h ago",
      topics: ["crypto", "defi"],
      imageUrl: "https://example.com/img.jpg",
    };

    // Pre-populate with cached item
    await act(async () => {
      ctx.addContent(cachedItem);
      await flush();
    });
    expect(ctx.content[0].topics).toEqual(["crypto", "defi"]);

    // IC returns same item but without topics/imageUrl
    const icEval = makeICEval("merge-test", "cached");
    mockGetUserEvaluations.mockResolvedValueOnce([icEval]);

    await act(async () => {
      await ctx.loadFromIC();
      await flush();
    });

    const merged = ctx.content.find(c => c.id === "merge-test");
    expect(merged).toBeDefined();
    expect(merged!.topics).toEqual(["crypto", "defi"]);
  });
});
