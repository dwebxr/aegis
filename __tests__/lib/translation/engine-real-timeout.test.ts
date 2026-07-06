/**
 * @jest-environment jsdom
 *
 * Auto-cascade IC LLM timing — with the REAL withTimeout implementation.
 *
 * The main engine.test.ts mocks @/lib/utils/timeout as an identity function,
 * so it cannot detect an outer time budget being (re)introduced around the
 * auto-cascade ic-llm attempt. This file keeps the real helper: an outer 8s
 * budget used to include the concurrency-slot queue wait and killed queued
 * items systematically (field-observed 8013ms transport-errors). These tests
 * fail if anyone reintroduces such a budget, and prove the inner 30s callIC
 * bound is still live.
 */
import { TextEncoder as NodeTextEncoder } from "util";
import { webcrypto } from "crypto";
if (typeof globalThis.TextEncoder === "undefined") {
  globalThis.TextEncoder = NodeTextEncoder as unknown as typeof TextEncoder;
}
if (typeof globalThis.crypto?.subtle === "undefined") {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, writable: true });
}

let mockApiKey: string | null = null;

jest.mock("@/lib/ollama/storage", () => ({
  isOllamaEnabled: () => false,
  getOllamaConfig: () => ({ enabled: false, endpoint: "http://localhost:11434", model: "llama3.2" }),
}));
jest.mock("@/lib/webllm/storage", () => ({ isWebLLMEnabled: () => false }));
jest.mock("@/lib/webllm/engine", () => ({
  getOrCreateEngine: () => Promise.reject(new Error("not in this test")),
  isWebLLMLoaded: () => false,
}));
jest.mock("@/lib/mediapipe/storage", () => ({ isMediaPipeEnabled: () => false }));
jest.mock("@/lib/mediapipe/engine", () => ({
  getOrCreateInference: () => Promise.reject(new Error("not in this test")),
  isMediaPipeLoaded: () => false,
}));
jest.mock("@/lib/apiKey/storage", () => ({ getUserApiKey: () => mockApiKey }));
// NOTE: deliberately NO mock for @/lib/utils/timeout — that is the point.
jest.mock("@sentry/nextjs", () => ({
  startSpan: jest.fn(async (_opts: unknown, fn: (span: unknown) => unknown) =>
    fn({ setAttribute: () => {} })),
  captureException: jest.fn(),
}));

import { translateContent } from "@/lib/translation/engine";
import type { TranslationResult } from "@/lib/translation/types";
import { _resetIcLlmCircuit } from "@/lib/ic/icLlmCircuitBreaker";
import { _resetIcLlmConcurrency } from "@/lib/ic/icLlmConcurrency";

type ActorRef = React.MutableRefObject<import("@/lib/ic/declarations")._SERVICE | null>;

function makeActorRef(translateOnChain: jest.Mock): ActorRef {
  return { current: { translateOnChain } } as unknown as ActorRef;
}

/** The engine awaits real async boundaries (cache sha256 via crypto.subtle)
 *  BEFORE the IC call registers its timer — advancing fake timers earlier than
 *  that leaves the mock's timer unscheduled forever and the test hangs into
 *  jest's real-time limit. Advance in small steps until the mock has actually
 *  been invoked, then advance the remaining window. */
async function advanceUntilCallCount(mock: jest.Mock, count: number, thenAdvanceMs: number): Promise<void> {
  for (let i = 0; i < 200 && mock.mock.calls.length < count; i++) {
    await jest.advanceTimersByTimeAsync(10);
  }
  expect(mock.mock.calls.length).toBeGreaterThanOrEqual(count);
  await jest.advanceTimersByTimeAsync(thenAdvanceMs);
}

async function advanceUntilCalled(mock: jest.Mock, thenAdvanceMs: number): Promise<void> {
  await advanceUntilCallCount(mock, 1, thenAdvanceMs);
}

beforeEach(() => {
  localStorage.clear();
  mockApiKey = null;
  _resetIcLlmCircuit();
  _resetIcLlmConcurrency();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("auto-cascade ic-llm with the real timeout helper", () => {
  it("a 9s IC response succeeds — no outer budget kills queued/slow calls", async () => {
    const icMock = jest.fn().mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve({ ok: "遅いが成功した翻訳" }), 9_000)),
    );
    const pending = translateContent({
      text: "Slow IC response must not be killed by an outer budget",
      targetLanguage: "ja",
      backend: "auto",
      actorRef: makeActorRef(icMock),
      isAuthenticated: true,
    });
    await advanceUntilCalled(icMock, 9_100);
    const result = await pending;
    expect((result as TranslationResult).backend).toBe("ic-llm");
    expect((result as TranslationResult).translatedText).toBe("遅いが成功した翻訳");
  }, 15_000);

  it("the inner 30s callIC bound is still live — a 31s response fails, not hangs", async () => {
    const icMock = jest.fn().mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve({ ok: "遅すぎる" }), 31_000)),
    );
    const pending = translateContent({
      text: "A 31s response must hit the inner IC timeout",
      targetLanguage: "ja",
      backend: "auto",
      actorRef: makeActorRef(icMock),
      isAuthenticated: true,
    });
    // Cascade-exhausted app-level classification → skip, not a hang. The
    // inner timeout message is transport-shaped, so the cascade records a
    // failure and returns all-backends-failed.
    const settled = pending.then(
      r => ({ kind: "resolved" as const, r }),
      e => ({ kind: "rejected" as const, e }),
    );
    await advanceUntilCalled(icMock, 30_100);
    await advanceUntilCallCount(icMock, 2, 30_100);
    const outcome = await settled;
    if (outcome.kind === "resolved") {
      expect(outcome.r).toMatchObject({ status: "skip", reason: "all-backends-failed", attempted: 2 });
    } else {
      expect(String(outcome.e)).toMatch(/timeout/i);
    }
  }, 15_000);
});
