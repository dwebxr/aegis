/**
 * @jest-environment jsdom
 */
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}
import "@testing-library/jest-dom";

const mockTranslateContent = jest.fn();
jest.mock("@/lib/translation/engine", () => ({
  __esModule: true,
  translateContent: (...args: unknown[]) => mockTranslateContent(...args),
}));

let mockProfile: { translationPrefs?: import("@/lib/translation/types").TranslationPrefs } = {
  translationPrefs: { targetLanguage: "en", policy: "manual", backend: "auto", minScore: 6 },
};
let mockIsAuthenticated = false;
const mockAddNotification = jest.fn();

jest.mock("@/contexts/PreferenceContext", () => ({
  __esModule: true,
  usePreferences: () => ({ profile: mockProfile }),
}));
jest.mock("@/contexts/AuthContext", () => ({
  __esModule: true,
  useAuth: () => ({ isAuthenticated: mockIsAuthenticated }),
}));
jest.mock("@/contexts/NotificationContext", () => ({
  __esModule: true,
  useNotify: () => ({ addNotification: mockAddNotification }),
}));

import React, { useRef } from "react";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import { useTranslation } from "@/hooks/useTranslation";
import type { ContentItem } from "@/lib/types/content";
import type { ContentSyncStatus } from "@/contexts/content/types";
import {
  TranslationBackendUnavailableError,
  type TranslationBackend,
  type TranslationResult,
  type TranslationPolicy,
  type TranslationSkip,
} from "@/lib/translation/types";

function makeItem(id: string, composite = 7): ContentItem {
  return {
    id,
    owner: "o",
    author: "a",
    avatar: "A",
    text: `text-${id}`,
    source: "rss",
    scores: { originality: composite, insight: composite, credibility: composite, composite },
    verdict: "quality",
    reason: "reason",
    createdAt: 0,
    validated: false,
    flagged: false,
    timestamp: "now",
  };
}

function makeResult(over: Partial<TranslationResult> = {}): TranslationResult {
  return {
    translatedText: "translated",
    translatedReason: "translated reason",
    targetLanguage: "ja",
    backend: "ollama",
    generatedAt: Date.now(),
    ...over,
  };
}

function makeSkip(reason: TranslationSkip["reason"], attempted: number): TranslationSkip {
  return { status: "skip", reason, attempted };
}

function setPolicy(policy: TranslationPolicy, opts: Partial<{
  minScore: number;
  targetLanguage: import("@/lib/translation/types").TranslationLanguage;
  backend: TranslationBackend;
}> = {}) {
  mockProfile = {
    translationPrefs: {
      targetLanguage: opts.targetLanguage ?? "ja",
      policy,
      backend: opts.backend ?? "auto",
      minScore: opts.minScore ?? 6,
    },
  };
}

function harness(initialItems: ContentItem[], syncStatus: ContentSyncStatus = "idle") {
  // Default syncStatus is "idle" so existing tests behave as if the IC
  // actor is ready and the cold-start gate doesn't suppress translation.
  // Cold-start race tests pass an explicit "offline" override.
  const patchItem = jest.fn();
  const items = [...initialItems];
  const actorRef = { current: null } as React.MutableRefObject<unknown>;
  const wrapper = () =>
    useTranslation(items, patchItem, actorRef as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>, syncStatus);
  return { wrapper, patchItem, items };
}

beforeEach(() => {
  mockTranslateContent.mockReset();
  mockAddNotification.mockClear();
  mockIsAuthenticated = false;
  setPolicy("manual");
  jest.useRealTimers();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("useTranslation — public surface", () => {
  it("returns translateItem, requestAutoTranslate, and isItemTranslating functions", () => {
    const { wrapper } = harness([makeItem("a")]);
    const { result } = renderHook(wrapper);
    expect(typeof result.current.translateItem).toBe("function");
    expect(typeof result.current.requestAutoTranslate).toBe("function");
    expect(typeof result.current.isItemTranslating).toBe("function");
    expect(result.current.isItemTranslating("a")).toBe(false);
  });
});

describe("useTranslation — manual translateItem", () => {
  it("calls translateContent with item text/reason and patches result on success", async () => {
    setPolicy("manual");
    const item = makeItem("a");
    const result = makeResult({ translatedText: "テキスト" });
    mockTranslateContent.mockResolvedValueOnce(result);

    const { wrapper, patchItem } = harness([item]);
    const { result: hookResult } = renderHook(wrapper);

    await act(async () => {
      hookResult.current.translateItem("a");
    });
    await waitFor(() => expect(patchItem).toHaveBeenCalledTimes(1));

    expect(mockTranslateContent).toHaveBeenCalledTimes(1);
    const opts = mockTranslateContent.mock.calls[0][0];
    expect(opts.text).toBe("text-a");
    expect(opts.reason).toBe("reason");
    expect(opts.targetLanguage).toBe("ja");
    expect(opts.backend).toBe("auto");
    expect(opts.isAuthenticated).toBe(false);

    expect(patchItem).toHaveBeenCalledWith("a", { translation: result });
  });

  it("translateItem is a no-op for unknown id", async () => {
    setPolicy("manual");
    const { wrapper } = harness([makeItem("a")]);
    const { result } = renderHook(wrapper);
    await act(async () => {
      result.current.translateItem("missing");
    });
    expect(mockTranslateContent).not.toHaveBeenCalled();
  });

  it("translateItem skips items that already have a translation", async () => {
    setPolicy("manual");
    const item = makeItem("a");
    item.translation = makeResult();
    const { wrapper } = harness([item]);
    const { result } = renderHook(wrapper);
    await act(async () => {
      result.current.translateItem("a");
    });
    expect(mockTranslateContent).not.toHaveBeenCalled();
  });

  it("isItemTranslating returns true while translation is in flight", async () => {
    setPolicy("manual");
    let resolveFn: (value: TranslationResult | TranslationSkip) => void = () => {};
    mockTranslateContent.mockImplementationOnce(
      () => new Promise(resolve => { resolveFn = resolve; }),
    );

    const { wrapper } = harness([makeItem("a")]);
    const { result } = renderHook(wrapper);

    await act(async () => {
      result.current.translateItem("a");
    });
    await waitFor(() => expect(result.current.isItemTranslating("a")).toBe(true));

    await act(async () => {
      resolveFn(makeResult());
    });
    await waitFor(() => expect(result.current.isItemTranslating("a")).toBe(false));
  });
});

describe("useTranslation — outcome handling", () => {
  it("structured skip outcome adds id to skip set so it is not retried", async () => {
    setPolicy("all");
    const item = makeItem("a");
    mockTranslateContent.mockResolvedValueOnce(makeSkip("already-in-target", 1));

    const { wrapper, patchItem } = harness([item]);
    const { result, rerender } = renderHook(wrapper);
    await act(async () => {
      result.current.requestAutoTranslate("a");
    });
    await waitFor(() => expect(mockTranslateContent).toHaveBeenCalledTimes(1));

    // Re-render and duplicate request — should NOT re-attempt because id is in skip set
    rerender();
    await act(async () => {
      result.current.requestAutoTranslate("a");
    });
    await new Promise(r => setTimeout(r, 20));
    expect(mockTranslateContent).toHaveBeenCalledTimes(1);
    expect(patchItem).not.toHaveBeenCalled();
  });

  it("translateContent throw notifies user once per language with diagnostic message", async () => {
    setPolicy("all", { targetLanguage: "ja" });
    mockTranslateContent.mockRejectedValue(
      new Error("All 2 translation backends failed — ic-llm: timeout | claude-server: HTTP 502"),
    );

    const items = [makeItem("a"), makeItem("b")];
    const { wrapper } = harness(items);
    const { result } = renderHook(wrapper);
    await act(async () => {
      result.current.requestAutoTranslate("a");
      result.current.requestAutoTranslate("b");
    });

    await waitFor(() => expect(mockTranslateContent.mock.calls.length).toBeGreaterThanOrEqual(1));
    await new Promise(r => setTimeout(r, 20));

    const errCalls = mockAddNotification.mock.calls.filter(c => c[1] === "error");
    // Once per target language, regardless of how many items failed
    expect(errCalls.length).toBe(1);
    expect(errCalls[0][0]).toMatch(/Translation failed.*All 2 translation backends failed/);
  });

  it("manual translateContent throw DOES notify (a silent manual failure is the bug class being fixed)", async () => {
    // Pre-change behavior notified thrown failures for every caller kind —
    // that must survive: a manual Translate tap that dies with no feedback is
    // indistinguishable from "translation is broken".
    setPolicy("manual");
    mockTranslateContent.mockRejectedValueOnce(new Error("network gone"));
    const { wrapper } = harness([makeItem("a")]);
    const { result } = renderHook(wrapper);

    await act(async () => {
      result.current.translateItem("a");
    });
    await waitFor(() => expect(mockTranslateContent).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockAddNotification).toHaveBeenCalledTimes(1));
    expect(mockAddNotification.mock.calls[0][0]).toMatch(/Translation failed.*network gone/);
    expect(mockAddNotification.mock.calls[0][1]).toBe("error");
  });

  it("manual backend-unavailable errors notify with the backend-specific message", async () => {
    setPolicy("manual", { backend: "ic" });
    mockTranslateContent.mockRejectedValueOnce(
      new TranslationBackendUnavailableError("ic", "IC requires authentication"),
    );
    const { wrapper } = harness([makeItem("a")]);
    const { result } = renderHook(wrapper);

    await act(async () => {
      result.current.translateItem("a");
    });
    await waitFor(() => expect(mockTranslateContent).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockAddNotification).toHaveBeenCalledTimes(1));
    expect(mockAddNotification.mock.calls[0][0]).toContain("IC LLM");
    expect(mockAddNotification.mock.calls[0][1]).toBe("error");
  });

  it("manual no-backend skip notifies too (a tap with no visible result is the same invisible failure)", async () => {
    setPolicy("manual", { backend: "auto" });
    mockTranslateContent.mockResolvedValueOnce(makeSkip("no-backend", 0));
    const { wrapper } = harness([makeItem("a")]);
    const { result } = renderHook(wrapper);

    await act(async () => {
      result.current.translateItem("a");
    });
    await waitFor(() => expect(mockTranslateContent).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockAddNotification).toHaveBeenCalledTimes(1));
    expect(mockAddNotification.mock.calls[0][0]).toContain("自動翻訳のバックエンドがありません");
  });

  it("manual already-in-target skip stays silent (correct behavior, not a failure)", async () => {
    setPolicy("manual", { backend: "auto" });
    mockTranslateContent.mockResolvedValueOnce(makeSkip("already-in-target", 1));
    const { wrapper } = harness([makeItem("a")]);
    const { result } = renderHook(wrapper);

    await act(async () => {
      result.current.translateItem("a");
    });
    await waitFor(() => expect(mockTranslateContent).toHaveBeenCalledTimes(1));
    await new Promise(r => setTimeout(r, 20));
    expect(mockAddNotification).not.toHaveBeenCalled();
  });

  it("auto no-backend skip with auto backend notifies exactly once per session", async () => {
    setPolicy("all", { backend: "auto" });
    mockTranslateContent.mockResolvedValue(makeSkip("no-backend", 0));
    const { wrapper } = harness([makeItem("a"), makeItem("b")]);
    const { result } = renderHook(wrapper);
    await act(async () => {
      result.current.requestAutoTranslate("a");
      result.current.requestAutoTranslate("b");
    });

    await waitFor(() => expect(mockTranslateContent).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(mockAddNotification).toHaveBeenCalledWith(
        "自動翻訳のバックエンドがありません — Internet Identityでログインする、Settings→FeedsでローカルLLMを有効化、またはAPIキーを設定してください",
        "error",
      );
    });
    const errCalls = mockAddNotification.mock.calls.filter(c => c[1] === "error");
    expect(errCalls).toHaveLength(1);
  });

  it("auto explicit-backend unavailable error uses backend-specific message once per session", async () => {
    setPolicy("all", { backend: "cloud" });
    mockTranslateContent.mockRejectedValue(
      new TranslationBackendUnavailableError("cloud", "Claude requires an API key"),
    );
    const { wrapper } = harness([makeItem("a"), makeItem("b")]);
    const { result } = renderHook(wrapper);
    await act(async () => {
      result.current.requestAutoTranslate("a");
      result.current.requestAutoTranslate("b");
    });

    await waitFor(() => expect(mockTranslateContent.mock.calls.length).toBeGreaterThanOrEqual(1));
    await waitFor(() => {
      expect(mockAddNotification).toHaveBeenCalledWith(
        "選択した翻訳バックエンド(Cloud)が利用できません — Settings→Translationで変更してください",
        "error",
      );
    });
    const errCalls = mockAddNotification.mock.calls.filter(c => c[1] === "error");
    expect(errCalls).toHaveLength(1);
  });

  it("auto all-backends-failed skips aggregate into one info notification per session", async () => {
    setPolicy("all");
    mockTranslateContent.mockResolvedValue(makeSkip("all-backends-failed", 1));
    const { wrapper } = harness([makeItem("a"), makeItem("b")]);
    const { result } = renderHook(wrapper);
    await act(async () => {
      result.current.requestAutoTranslate("a");
      result.current.requestAutoTranslate("b");
    });

    await waitFor(() => expect(mockTranslateContent).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(mockAddNotification).toHaveBeenCalledWith(
        "一部の記事を翻訳できませんでした(IC LLMが不安定な場合があります)。未翻訳の記事は展開してTranslateで再試行できます",
        "info",
      );
    });
    const infoCalls = mockAddNotification.mock.calls.filter(c => c[1] === "info");
    expect(infoCalls).toHaveLength(1);
  });

  it("auto already-in-target skip does not notify", async () => {
    setPolicy("all");
    mockTranslateContent.mockResolvedValueOnce(makeSkip("already-in-target", 1));
    const { wrapper } = harness([makeItem("a")]);
    const { result } = renderHook(wrapper);
    await act(async () => {
      result.current.requestAutoTranslate("a");
    });

    await waitFor(() => expect(mockTranslateContent).toHaveBeenCalledTimes(1));
    await new Promise(r => setTimeout(r, 20));
    expect(mockAddNotification).not.toHaveBeenCalled();
  });
});

describe("useTranslation — auto policies", () => {
  it("policy=off does not auto-translate anything", async () => {
    setPolicy("off");
    const items = [makeItem("a"), makeItem("b")];
    const { wrapper } = harness(items);
    const { result } = renderHook(wrapper);
    await act(async () => {
      result.current.requestAutoTranslate("a");
      result.current.requestAutoTranslate("b");
    });
    await new Promise(r => setTimeout(r, 30));
    expect(mockTranslateContent).not.toHaveBeenCalled();
  });

  it("policy=manual does not auto-translate", async () => {
    setPolicy("manual");
    const items = [makeItem("a"), makeItem("b")];
    const { wrapper } = harness(items);
    const { result } = renderHook(wrapper);
    await act(async () => {
      result.current.requestAutoTranslate("a");
      result.current.requestAutoTranslate("b");
    });
    await new Promise(r => setTimeout(r, 30));
    expect(mockTranslateContent).not.toHaveBeenCalled();
  });

  it("policy=all auto queue runs 4 immediately and pumps the rest after completions", async () => {
    setPolicy("all");
    const deferred = Array.from({ length: 6 }, () => {
      let resolve!: (value: TranslationResult) => void;
      const promise = new Promise<TranslationResult>(r => { resolve = r; });
      return { promise, resolve };
    });
    let callIndex = 0;
    mockTranslateContent.mockImplementation(() => deferred[callIndex++].promise);
    const items = [
      makeItem("a"), makeItem("b"), makeItem("c"), makeItem("d"), makeItem("e"), makeItem("f"),
    ];
    const { wrapper } = harness(items);
    const { result } = renderHook(wrapper);
    await act(async () => {
      for (const item of items) result.current.requestAutoTranslate(item.id);
    });
    await waitFor(() => expect(mockTranslateContent.mock.calls.length).toBe(4));

    await act(async () => {
      deferred[0].resolve(makeResult());
    });
    await waitFor(() => expect(mockTranslateContent.mock.calls.length).toBe(5));

    await act(async () => {
      deferred[1].resolve(makeResult());
    });
    await waitFor(() => expect(mockTranslateContent.mock.calls.length).toBe(6));
  });

  it("deduplicates duplicate requestAutoTranslate calls while an id is queued", async () => {
    setPolicy("all");
    const deferred = Array.from({ length: 5 }, () => {
      let resolve!: (value: TranslationResult) => void;
      const promise = new Promise<TranslationResult>(r => { resolve = r; });
      return { promise, resolve };
    });
    let callIndex = 0;
    mockTranslateContent.mockImplementation(() => deferred[callIndex++].promise);
    const items = [makeItem("a"), makeItem("b"), makeItem("c"), makeItem("d"), makeItem("e")];
    const { wrapper } = harness(items);
    const { result } = renderHook(wrapper);

    await act(async () => {
      for (const item of items) result.current.requestAutoTranslate(item.id);
      result.current.requestAutoTranslate("e");
      result.current.requestAutoTranslate("e");
    });
    expect(mockTranslateContent.mock.calls.length).toBe(4);

    await act(async () => {
      deferred[0].resolve(makeResult());
    });
    await waitFor(() => expect(mockTranslateContent.mock.calls.length).toBe(5));
    const translatedTexts = mockTranslateContent.mock.calls.map(c => c[0].text);
    expect(translatedTexts.filter(text => text === "text-e")).toHaveLength(1);
  });

  it("drops queued auto work after policy switches to manual", async () => {
    setPolicy("all");
    const deferred = Array.from({ length: 4 }, () => {
      let resolve!: (value: TranslationResult) => void;
      const promise = new Promise<TranslationResult>(r => { resolve = r; });
      return { promise, resolve };
    });
    let callIndex = 0;
    mockTranslateContent.mockImplementation(() => deferred[callIndex++]?.promise ?? Promise.resolve(makeResult()));
    const items = [makeItem("a"), makeItem("b"), makeItem("c"), makeItem("d"), makeItem("e"), makeItem("f")];
    const { wrapper } = harness(items);
    const { result, rerender } = renderHook(wrapper);

    await act(async () => {
      for (const item of items) result.current.requestAutoTranslate(item.id);
    });
    await waitFor(() => expect(mockTranslateContent).toHaveBeenCalledTimes(4));

    setPolicy("manual");
    rerender();
    await act(async () => {
      for (const d of deferred) d.resolve(makeResult());
    });
    await new Promise(r => setTimeout(r, 20));
    expect(mockTranslateContent).toHaveBeenCalledTimes(4);
  });

  it("manual translateItem runs immediately even when the auto queue is full", async () => {
    setPolicy("all");
    mockTranslateContent.mockImplementation(() => new Promise(() => {}));
    const items = [makeItem("a"), makeItem("b"), makeItem("c"), makeItem("d"), makeItem("e"), makeItem("manual")];
    const { wrapper } = harness(items);
    const { result } = renderHook(wrapper);

    await act(async () => {
      for (const id of ["a", "b", "c", "d", "e"]) result.current.requestAutoTranslate(id);
      result.current.translateItem("manual");
    });
    expect(mockTranslateContent).toHaveBeenCalledTimes(5);
    expect(mockTranslateContent.mock.calls[4][0].text).toBe("text-manual");
  });

  it("manual completions pump the auto queue (manual-only burst can't strand queued items — Codex P2)", async () => {
    setPolicy("all");
    const resolvers: Array<(v: unknown) => void> = [];
    mockTranslateContent.mockImplementation(
      () => new Promise(resolve => { resolvers.push(resolve); }),
    );
    const items = ["m1", "m2", "m3", "m4", "auto1"].map(id => makeItem(id));
    const { wrapper } = harness(items);
    const { result } = renderHook(wrapper);

    await act(async () => {
      // Four manual taps fill every activeIds slot…
      for (const id of ["m1", "m2", "m3", "m4"]) result.current.translateItem(id);
      // …then a rendered card requests auto translation: must queue, not run.
      result.current.requestAutoTranslate("auto1");
    });
    expect(mockTranslateContent).toHaveBeenCalledTimes(4);

    // A MANUAL completion frees a slot — the queue must pump without any
    // content/prefs change.
    await act(async () => {
      resolvers[0]({ translatedText: "翻訳", targetLanguage: "ja", backend: "ic-llm", generatedAt: 1 });
      await Promise.resolve();
    });
    expect(mockTranslateContent).toHaveBeenCalledTimes(5);
    expect(mockTranslateContent.mock.calls[4][0].text).toBe("text-auto1");
  });

  it("re-enqueues failed auto-requested items after the 60s clear, but not manual-only failures", async () => {
    jest.useFakeTimers();
    setPolicy("all");
    mockTranslateContent
      .mockRejectedValueOnce(new Error("auto failed"))
      .mockRejectedValueOnce(new Error("manual failed"))
      .mockResolvedValueOnce(makeResult());

    const { wrapper } = harness([makeItem("auto"), makeItem("manual")]);
    const { result } = renderHook(wrapper);

    await act(async () => {
      result.current.requestAutoTranslate("auto");
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      result.current.translateItem("manual");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockTranslateContent).toHaveBeenCalledTimes(2);

    await act(async () => {
      jest.advanceTimersByTime(60_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockTranslateContent).toHaveBeenCalledTimes(3);
    expect(mockTranslateContent.mock.calls[2][0].text).toBe("text-auto");
  });

  it("policy=high_quality only translates items meeting minScore", async () => {
    setPolicy("high_quality", { minScore: 7 });
    mockTranslateContent.mockResolvedValue(makeResult());
    const items = [makeItem("low", 5), makeItem("mid", 6), makeItem("high", 8)];
    const { wrapper } = harness(items);
    const { result } = renderHook(wrapper);
    await act(async () => {
      for (const item of items) result.current.requestAutoTranslate(item.id);
    });
    await waitFor(() => expect(mockTranslateContent).toHaveBeenCalled());
    await new Promise(r => setTimeout(r, 30));

    const translatedTexts = mockTranslateContent.mock.calls.map(c => c[0].text);
    expect(translatedTexts).toContain("text-high");
    expect(translatedTexts).not.toContain("text-low");
    expect(translatedTexts).not.toContain("text-mid");
  });
});

describe("useTranslation — language change resets attempted set", () => {
  it("changing targetLanguage clears the failed/skip set so previously failed items can retry", async () => {
    setPolicy("all", { targetLanguage: "ja" });
    mockTranslateContent.mockRejectedValueOnce(new Error("ic-llm: timeout"));
    const items = [makeItem("a")];
    const { wrapper } = harness(items);
    const { result, rerender } = renderHook(wrapper);
    await act(async () => {
      result.current.requestAutoTranslate("a");
    });
    await waitFor(() => expect(mockTranslateContent).toHaveBeenCalledTimes(1));
    await new Promise(r => setTimeout(r, 10));

    setPolicy("all", { targetLanguage: "fr" });
    mockTranslateContent.mockResolvedValueOnce(makeResult({ targetLanguage: "fr" }));
    rerender();
    await act(async () => {
      result.current.requestAutoTranslate("a");
    });
    await waitFor(() => expect(mockTranslateContent).toHaveBeenCalledTimes(2));
  });
});

describe("useTranslation — isReady gate (cold-start race protection)", () => {
  it("does NOT auto-translate when authenticated and syncStatus is 'offline'", async () => {
    setPolicy("all", { targetLanguage: "ja" });
    mockIsAuthenticated = true;

    const patchItem = jest.fn();
    const items = [makeItem("a"), makeItem("b")];
    const actorRef = { current: null } as React.MutableRefObject<unknown>;
    const wrapperFn = () =>
      useTranslation(
        items,
        patchItem,
        actorRef as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>,
        "offline",
      );
    const { result } = renderHook(wrapperFn);
    await act(async () => {
      result.current.requestAutoTranslate("a");
      result.current.requestAutoTranslate("b");
    });
    await new Promise(r => setTimeout(r, 30));
    expect(mockTranslateContent).not.toHaveBeenCalled();
  });

  it("starts translating when syncStatus transitions out of 'offline'", async () => {
    setPolicy("all", { targetLanguage: "ja" });
    mockIsAuthenticated = true;
    mockTranslateContent.mockResolvedValue(makeResult({ targetLanguage: "ja" }));

    const patchItem = jest.fn();
    const items = [makeItem("a")];
    const actorRef = { current: null } as React.MutableRefObject<unknown>;
    let currentSyncStatus: ContentSyncStatus = "offline";
    const wrapperFn = () =>
      useTranslation(
        items,
        patchItem,
        actorRef as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>,
        currentSyncStatus,
      );
    const { rerender, result } = renderHook(wrapperFn);
    await act(async () => {
      result.current.requestAutoTranslate("a");
    });

    // Initially nothing fires
    await new Promise(r => setTimeout(r, 20));
    expect(mockTranslateContent).not.toHaveBeenCalled();

    // syncStatus → idle (actor ready) — effect should now run
    currentSyncStatus = "idle";
    rerender();
    await waitFor(() => expect(mockTranslateContent).toHaveBeenCalledTimes(1));
  });

  it("auto-translates immediately for anonymous users (no actor expected)", async () => {
    setPolicy("all", { targetLanguage: "ja" });
    mockIsAuthenticated = false;
    mockTranslateContent.mockResolvedValue(makeResult({ targetLanguage: "ja" }));

    const patchItem = jest.fn();
    const items = [makeItem("a")];
    const actorRef = { current: null } as React.MutableRefObject<unknown>;
    const wrapperFn = () =>
      useTranslation(
        items,
        patchItem,
        actorRef as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>,
        "offline",
      );
    const { result } = renderHook(wrapperFn);
    await act(async () => {
      result.current.requestAutoTranslate("a");
    });
    await waitFor(() => expect(mockTranslateContent).toHaveBeenCalledTimes(1));
  });

  it("falls back to ready=true after the actor-ready timeout if syncStatus stays offline", async () => {
    jest.useFakeTimers();
    setPolicy("all", { targetLanguage: "ja" });
    mockIsAuthenticated = true;
    mockTranslateContent.mockResolvedValue(makeResult({ targetLanguage: "ja" }));

    const patchItem = jest.fn();
    const items = [makeItem("a")];
    const actorRef = { current: null } as React.MutableRefObject<unknown>;
    const wrapperFn = () =>
      useTranslation(
        items,
        patchItem,
        actorRef as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>,
        "offline",
      );
    const { result } = renderHook(wrapperFn);
    await act(async () => {
      result.current.requestAutoTranslate("a");
    });

    // Before the timeout, no translation
    expect(mockTranslateContent).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });
    await waitFor(() => expect(mockTranslateContent).toHaveBeenCalled());
  });

  it("clears BOTH failed and skip sets when transitioning out of offline", async () => {
    setPolicy("all", { targetLanguage: "ja" });
    mockIsAuthenticated = true;
    // First call: skip outcome (could happen via smart-model exception
    // during a manual click before isReady).
    mockTranslateContent.mockResolvedValueOnce(makeSkip("no-backend", 0));

    const patchItem = jest.fn();
    const items = [makeItem("a")];
    const actorRef = { current: null } as React.MutableRefObject<unknown>;
    let currentSyncStatus: ContentSyncStatus = "offline";
    const wrapperFn = () =>
      useTranslation(
        items,
        patchItem,
        actorRef as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>,
        currentSyncStatus,
      );
    const { rerender, result } = renderHook(wrapperFn);

    await act(async () => {
      result.current.requestAutoTranslate("a");
    });

    // Manual translate while offline — pollutes the skip set
    await act(async () => {
      result.current.translateItem("a");
    });
    await waitFor(() => expect(mockTranslateContent).toHaveBeenCalledTimes(1));

    // Actor ready — should clear skip set and re-attempt the item
    mockTranslateContent.mockResolvedValueOnce(makeResult({ targetLanguage: "ja" }));
    currentSyncStatus = "idle";
    rerender();
    await waitFor(() => expect(mockTranslateContent).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(patchItem).toHaveBeenCalled());
  });
});

describe("useTranslation — auth wiring", () => {
  it("forwards isAuthenticated to translateContent options", async () => {
    setPolicy("manual");
    mockIsAuthenticated = true;
    mockTranslateContent.mockResolvedValueOnce(makeResult());

    const { wrapper } = harness([makeItem("a")]);
    const { result } = renderHook(wrapper);

    await act(async () => {
      result.current.translateItem("a");
    });
    await waitFor(() => expect(mockTranslateContent).toHaveBeenCalled());
    expect(mockTranslateContent.mock.calls[0][0].isAuthenticated).toBe(true);
  });
});
