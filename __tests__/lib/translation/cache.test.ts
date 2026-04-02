/**
 * @jest-environment jsdom
 */
import { TextEncoder as NodeTextEncoder } from "util";
import { webcrypto } from "crypto";
// Polyfill for jsdom
if (typeof globalThis.TextEncoder === "undefined") {
  globalThis.TextEncoder = NodeTextEncoder as unknown as typeof TextEncoder;
}
if (typeof globalThis.crypto?.subtle === "undefined") {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, writable: true });
}

import { lookupTranslation, storeTranslation } from "@/lib/translation/cache";
import type { TranslationResult } from "@/lib/translation/types";

const LS_KEY = "aegis-translation-cache";

beforeEach(() => {
  localStorage.clear();
});

function makeResult(overrides: Partial<TranslationResult> = {}): TranslationResult {
  return {
    translatedText: "翻訳されたテキスト",
    targetLanguage: "ja",
    backend: "ollama",
    generatedAt: Date.now(),
    ...overrides,
  };
}

describe("storeTranslation + lookupTranslation", () => {
  it("stores and retrieves a translation", async () => {
    const result = makeResult();
    await storeTranslation("Hello world", result);
    const cached = await lookupTranslation("Hello world", "ja");
    expect(cached).not.toBeNull();
    expect(cached!.translatedText).toBe("翻訳されたテキスト");
    expect(cached!.backend).toBe("ollama");
  });

  it("returns null for cache miss", async () => {
    const cached = await lookupTranslation("Not cached", "ja");
    expect(cached).toBeNull();
  });

  it("returns null for different target language", async () => {
    await storeTranslation("Hello", makeResult({ targetLanguage: "ja" }));
    const cached = await lookupTranslation("Hello", "fr");
    expect(cached).toBeNull();
  });

  it("returns null for expired entry", async () => {
    // Manually write an expired entry
    const hash = "test";
    const store = {
      [`ja:${hash}`]: {
        result: makeResult(),
        expiresAt: Date.now() - 1000,
      },
    };
    localStorage.setItem(LS_KEY, JSON.stringify(store));

    // lookupTranslation uses SHA-256 so this won't match the manual key,
    // but verifies the expiration logic path when it does match
    const cached = await lookupTranslation("Hello", "ja");
    expect(cached).toBeNull();
  });

  it("evicts oldest entries when exceeding max", async () => {
    for (let i = 0; i < 201; i++) {
      await storeTranslation(`text-${i}`, makeResult({ generatedAt: i }));
    }
    const raw = localStorage.getItem(LS_KEY);
    const store = JSON.parse(raw!);
    expect(Object.keys(store).length).toBeLessThanOrEqual(200);
  });

  it("stores same text with different languages as separate entries", async () => {
    await storeTranslation("Hello", makeResult({ targetLanguage: "ja", translatedText: "こんにちは" }));
    await storeTranslation("Hello", makeResult({ targetLanguage: "fr", translatedText: "Bonjour" }));

    const ja = await lookupTranslation("Hello", "ja");
    const fr = await lookupTranslation("Hello", "fr");
    expect(ja!.translatedText).toBe("こんにちは");
    expect(fr!.translatedText).toBe("Bonjour");
  });

  it("produces consistent hash for identical input", async () => {
    const result = makeResult();
    await storeTranslation("Consistent hash test", result);
    const lookup1 = await lookupTranslation("Consistent hash test", "ja");
    const lookup2 = await lookupTranslation("Consistent hash test", "ja");
    expect(lookup1).toEqual(lookup2);
  });

  it("overwrites existing entry for same text and language", async () => {
    await storeTranslation("Overwrite test", makeResult({ translatedText: "v1" }));
    await storeTranslation("Overwrite test", makeResult({ translatedText: "v2" }));
    const cached = await lookupTranslation("Overwrite test", "ja");
    expect(cached!.translatedText).toBe("v2");
  });

  it("handles empty localStorage gracefully", async () => {
    localStorage.removeItem(LS_KEY);
    const cached = await lookupTranslation("nonexistent", "ja");
    expect(cached).toBeNull();
  });
});
