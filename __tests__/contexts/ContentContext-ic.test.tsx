/**
 * @jest-environment jsdom
 */
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockSaveEvaluation = jest.fn().mockResolvedValue(undefined);
const mockUpdateEvaluation = jest.fn().mockResolvedValue(undefined);
const mockGetEvaluations = jest.fn().mockResolvedValue({ data: [], total: 0n });
const mockActor = {
  saveEvaluation: mockSaveEvaluation,
  updateEvaluation: mockUpdateEvaluation,
  getEvaluations: mockGetEvaluations,
};

const mockPrincipal = { toText: () => "test-principal-id" };
jest.mock("@/lib/ic/actor", () => ({
  createBackendActorAsync: jest.fn().mockResolvedValue(mockActor),
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
  STORE_SCORE_CACHE: "score-cache",
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

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    identity: { getPrincipal: () => mockPrincipal },
    principal: mockPrincipal,
    principalText: "test-principal-id",
    isLoading: false,
    login: jest.fn(),
    logout: jest.fn(),
  }),
}));

const mockAddNotification = jest.fn();
jest.mock("@/contexts/NotificationContext", () => ({
  useNotify: () => ({ addNotification: mockAddNotification }),
}));

jest.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => true,
}));

const mockSyncToIC = jest.fn();
const mockDrainOfflineQueue = jest.fn().mockResolvedValue(undefined);
const mockLoadFromICCanister = jest.fn().mockResolvedValue(undefined);
const mockToICEvaluation = jest.fn().mockImplementation((item) => ({
  id: item.id,
  owner: "test-principal-id",
  text: item.text,
  source: item.source,
  scores: item.scores,
  verdict: item.verdict,
  reason: item.reason,
  createdAt: BigInt(item.createdAt),
  validated: item.validated,
  flagged: item.flagged,
}));

jest.mock("@/contexts/content/icSync", () => ({
  toICEvaluation: (...args: unknown[]) => mockToICEvaluation(...args),
  syncToIC: (...args: unknown[]) => mockSyncToIC(...args),
  drainOfflineQueue: (...args: unknown[]) => mockDrainOfflineQueue(...args),
  loadFromICCanister: (...args: unknown[]) => mockLoadFromICCanister(...args),
}));

import { ContentProvider, useContent } from "@/contexts/ContentContext";
import type { ContentItem } from "@/lib/types/content";
import { createBackendActorAsync } from "@/lib/ic/actor";

function wrapper({ children }: { children: React.ReactNode }) {
  return <ContentProvider>{children}</ContentProvider>;
}

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: `item-${Math.random().toString(36).slice(2, 8)}`,
    owner: "",
    author: "Test",
    avatar: "",
    text: `Content ${Math.random()}`,
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

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
});

describe("ContentContext IC integration", () => {
  it("creates actor on mount when authenticated", async () => {
    renderHook(() => useContent(), { wrapper });
    await waitFor(() => {
      expect(createBackendActorAsync).toHaveBeenCalled();
    });
  });

  it("addContent calls syncToIC when authenticated", async () => {
    const { result } = renderHook(() => useContent(), { wrapper });

    // Wait for actor to be created
    await waitFor(() => expect(createBackendActorAsync).toHaveBeenCalled());
    // Small delay for actor ref to be set
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    const item = makeItem({ id: "ic-test-1" });
    act(() => result.current.addContent(item));

    expect(mockSyncToIC).toHaveBeenCalledWith(
      expect.anything(),
      "saveEvaluation",
      expect.objectContaining({ itemId: expect.any(String) }),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
    );
  });

  it("validateItem calls syncToIC with updateEvaluation when authenticated", async () => {
    const { result } = renderHook(() => useContent(), { wrapper });
    await waitFor(() => expect(createBackendActorAsync).toHaveBeenCalled());
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    const item = makeItem({ id: "val-ic-1" });
    act(() => result.current.addContent(item));

    mockSyncToIC.mockClear();
    act(() => result.current.validateItem("val-ic-1"));

    expect(mockSyncToIC).toHaveBeenCalledWith(
      expect.anything(),
      "updateEvaluation",
      expect.objectContaining({ id: "val-ic-1", validated: true, flagged: false }),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
    );
  });

  it("flagItem calls syncToIC with updateEvaluation when authenticated", async () => {
    const { result } = renderHook(() => useContent(), { wrapper });
    await waitFor(() => expect(createBackendActorAsync).toHaveBeenCalled());
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    const item = makeItem({ id: "flag-ic-1" });
    act(() => result.current.addContent(item));

    mockSyncToIC.mockClear();
    act(() => result.current.flagItem("flag-ic-1"));

    expect(mockSyncToIC).toHaveBeenCalledWith(
      expect.anything(),
      "updateEvaluation",
      expect.objectContaining({ id: "flag-ic-1", validated: false, flagged: true }),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
    );
  });

  it("sets owner to principal when adding content while authenticated", async () => {
    const { result } = renderHook(() => useContent(), { wrapper });
    await waitFor(() => expect(createBackendActorAsync).toHaveBeenCalled());
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    const item = makeItem({ id: "owner-1", owner: "" });
    act(() => result.current.addContent(item));

    expect(result.current.content[0].owner).toBe("test-principal-id");
  });
});
