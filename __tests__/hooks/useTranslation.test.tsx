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
import type { TranslationResult, TranslationPolicy } from "@/lib/translation/types";

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

function setPolicy(policy: TranslationPolicy, opts: Partial<{ minScore: number; targetLanguage: import("@/lib/translation/types").TranslationLanguage }> = {}) {
  mockProfile = {
    translationPrefs: {
      targetLanguage: opts.targetLanguage ?? "ja",
      policy,
      backend: "auto",
      minScore: opts.minScore ?? 6,
    },
  };
}

function harness(initialItems: ContentItem[]) {
  const patchItem = jest.fn();
  const items = [...initialItems];
  const actorRef = { current: null } as React.MutableRefObject<unknown>;
  const wrapper = () =>
    useTranslation(items, patchItem, actorRef as React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>);
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
  it("returns translateItem and isItemTranslating functions", () => {
    const { wrapper } = harness([makeItem("a")]);
    const { result } = renderHook(wrapper);
    expect(typeof result.current.translateItem).toBe("function");
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
    let resolveFn: (value: TranslationResult | "failed" | "skip") => void = () => {};
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
  it('"skip" outcome adds id to skip set so it is not retried', async () => {
    setPolicy("all");
    const item = makeItem("a");
    mockTranslateContent.mockResolvedValueOnce("skip");

    const { wrapper, patchItem } = harness([item]);
    const { rerender } = renderHook(wrapper);
    await waitFor(() => expect(mockTranslateContent).toHaveBeenCalledTimes(1));

    // Re-render — should NOT re-attempt because id is in skip set
    rerender();
    await new Promise(r => setTimeout(r, 20));
    expect(mockTranslateContent).toHaveBeenCalledTimes(1);
    expect(patchItem).not.toHaveBeenCalled();
  });

  it('"failed" outcome notifies user once per language and adds id to failed set', async () => {
    setPolicy("all", { targetLanguage: "ja" });
    mockTranslateContent.mockResolvedValue("failed");

    const items = [makeItem("a"), makeItem("b")];
    const { wrapper } = harness(items);
    renderHook(wrapper);

    await waitFor(() => expect(mockTranslateContent.mock.calls.length).toBeGreaterThanOrEqual(1));
    await new Promise(r => setTimeout(r, 20));

    const errCalls = mockAddNotification.mock.calls.filter(c => c[1] === "error");
    expect(errCalls.length).toBe(1);
    expect(errCalls[0][0]).toMatch(/Auto-translate/);
  });

  it("notifies user on synchronous translateContent throw", async () => {
    setPolicy("manual");
    mockTranslateContent.mockRejectedValueOnce(new Error("network gone"));
    const { wrapper } = harness([makeItem("a")]);
    const { result } = renderHook(wrapper);

    await act(async () => {
      result.current.translateItem("a");
    });
    await waitFor(() => {
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.stringMatching(/Translation failed/),
        "error",
      );
    });
  });

  it("does NOT also fire the auto-translate fallback notification when translateContent threw", async () => {
    setPolicy("manual");
    mockTranslateContent.mockRejectedValueOnce(new Error("IC LLM unavailable (retried once)"));
    const { wrapper } = harness([makeItem("a")]);
    const { result } = renderHook(wrapper);

    await act(async () => {
      result.current.translateItem("a");
    });
    await waitFor(() => {
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.stringMatching(/Translation failed: IC LLM unavailable/),
        "error",
      );
    });
    // The "no translation backend available" message must NOT fire — that
    // one only makes sense after the auto cascade exhausted every option.
    expect(mockAddNotification).not.toHaveBeenCalledWith(
      expect.stringMatching(/no translation backend available/),
      "error",
    );
  });
});

describe("useTranslation — auto policies", () => {
  it("policy=off does not auto-translate anything", async () => {
    setPolicy("off");
    const items = [makeItem("a"), makeItem("b")];
    const { wrapper } = harness(items);
    renderHook(wrapper);
    await new Promise(r => setTimeout(r, 30));
    expect(mockTranslateContent).not.toHaveBeenCalled();
  });

  it("policy=manual does not auto-translate", async () => {
    setPolicy("manual");
    const items = [makeItem("a"), makeItem("b")];
    const { wrapper } = harness(items);
    renderHook(wrapper);
    await new Promise(r => setTimeout(r, 30));
    expect(mockTranslateContent).not.toHaveBeenCalled();
  });

  it("policy=all auto-translates pending items respecting concurrency limit (3)", async () => {
    setPolicy("all");
    mockTranslateContent.mockImplementation(() => new Promise(() => {})); // never resolves
    const items = [makeItem("a"), makeItem("b"), makeItem("c"), makeItem("d"), makeItem("e")];
    const { wrapper } = harness(items);
    renderHook(wrapper);
    await waitFor(() => expect(mockTranslateContent.mock.calls.length).toBe(3));
    // Wait a tick — should still be 3, not more
    await new Promise(r => setTimeout(r, 20));
    expect(mockTranslateContent.mock.calls.length).toBe(3);
  });

  it("policy=high_quality only translates items meeting minScore", async () => {
    setPolicy("high_quality", { minScore: 7 });
    mockTranslateContent.mockResolvedValue(makeResult());
    const items = [makeItem("low", 5), makeItem("mid", 6), makeItem("high", 8)];
    const { wrapper } = harness(items);
    renderHook(wrapper);
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
    mockTranslateContent.mockResolvedValueOnce("failed");
    const items = [makeItem("a")];
    const { wrapper } = harness(items);
    const { rerender } = renderHook(wrapper);
    await waitFor(() => expect(mockTranslateContent).toHaveBeenCalledTimes(1));
    await new Promise(r => setTimeout(r, 10));

    setPolicy("all", { targetLanguage: "fr" });
    mockTranslateContent.mockResolvedValueOnce(makeResult({ targetLanguage: "fr" }));
    rerender();
    await waitFor(() => expect(mockTranslateContent).toHaveBeenCalledTimes(2));
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
