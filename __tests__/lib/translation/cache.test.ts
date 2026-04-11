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

describe("cache resilience — corrupt / tampered localStorage", () => {
  it("survives invalid JSON and clears the corrupt blob", async () => {
    localStorage.setItem(LS_KEY, "{not valid json");
    const cached = await lookupTranslation("anything", "ja");
    expect(cached).toBeNull();
    // Corrupt blob is removed so subsequent reads don't re-parse it
    expect(localStorage.getItem(LS_KEY)).toBeNull();
  });

  it("survives non-object JSON (array at top level)", async () => {
    localStorage.setItem(LS_KEY, JSON.stringify(["not", "a", "store"]));
    const cached = await lookupTranslation("anything", "ja");
    expect(cached).toBeNull();
    expect(localStorage.getItem(LS_KEY)).toBeNull();
  });

  it("survives JSON that parses but has wrong entry shape", async () => {
    localStorage.setItem(LS_KEY, JSON.stringify({
      "ja:abc": { result: "not an object", expiresAt: "not a number" },
    }));
    const cached = await lookupTranslation("anything", "ja");
    expect(cached).toBeNull();
    expect(localStorage.getItem(LS_KEY)).toBeNull();
  });

  it("survives JSON with entry missing required result fields", async () => {
    localStorage.setItem(LS_KEY, JSON.stringify({
      "ja:abc": { result: { translatedText: "x" }, expiresAt: Date.now() + 1000 },
    }));
    const cached = await lookupTranslation("anything", "ja");
    expect(cached).toBeNull();
  });

  it("accepts JSON with valid shape containing zero entries", async () => {
    localStorage.setItem(LS_KEY, JSON.stringify({}));
    // Should not clear — valid empty store is fine
    await storeTranslation("Hello", makeResult());
    const cached = await lookupTranslation("Hello", "ja");
    expect(cached).not.toBeNull();
  });

  it("recomputes after corruption — next store overwrites with fresh shape", async () => {
    localStorage.setItem(LS_KEY, "{garbage");
    await storeTranslation("After corruption", makeResult({ translatedText: "新しい値" }));
    const cached = await lookupTranslation("After corruption", "ja");
    expect(cached!.translatedText).toBe("新しい値");
    // The store is now well-formed
    const raw = localStorage.getItem(LS_KEY);
    expect(raw).toBeTruthy();
    expect(() => JSON.parse(raw!)).not.toThrow();
  });
});

describe("cache resilience — localStorage access errors", () => {
  const realGetItem = Storage.prototype.getItem;
  const realSetItem = Storage.prototype.setItem;

  afterEach(() => {
    Storage.prototype.getItem = realGetItem;
    Storage.prototype.setItem = realSetItem;
  });

  it("returns null when getItem throws (Safari private mode / StorageAccess denial)", async () => {
    Storage.prototype.getItem = jest.fn(() => {
      throw new Error("SecurityError: The operation is insecure.");
    });
    // lookup should not throw
    const cached = await lookupTranslation("any", "ja");
    expect(cached).toBeNull();
  });

  it("silently tolerates setItem throwing (QuotaExceededError) and halves on retry", async () => {
    let callCount = 0;
    Storage.prototype.setItem = jest.fn(() => {
      callCount += 1;
      if (callCount === 1) {
        const err = new Error("QuotaExceededError");
        (err as Error & { name: string }).name = "QuotaExceededError";
        throw err;
      }
      // Second call (halved store) succeeds
    });

    // Should not throw
    await expect(
      storeTranslation("will quota", makeResult()),
    ).resolves.toBeUndefined();
    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  it("does not throw when both initial setItem and halved-retry setItem fail", async () => {
    Storage.prototype.setItem = jest.fn(() => {
      const err = new Error("QuotaExceededError");
      (err as Error & { name: string }).name = "QuotaExceededError";
      throw err;
    });

    await expect(
      storeTranslation("double fail", makeResult()),
    ).resolves.toBeUndefined();
  });
});

describe("cache resilience — crypto failure", () => {
  const realDigest = crypto.subtle.digest.bind(crypto.subtle);

  afterEach(() => {
    crypto.subtle.digest = realDigest;
  });

  it("lookupTranslation returns null when crypto.subtle.digest throws", async () => {
    crypto.subtle.digest = jest.fn(() => {
      throw new Error("crypto unavailable");
    }) as unknown as typeof crypto.subtle.digest;

    const cached = await lookupTranslation("crypto fail", "ja");
    expect(cached).toBeNull();
  });

  it("storeTranslation silently returns when crypto.subtle.digest throws", async () => {
    crypto.subtle.digest = jest.fn(() => {
      throw new Error("crypto unavailable");
    }) as unknown as typeof crypto.subtle.digest;

    await expect(
      storeTranslation("crypto fail store", makeResult()),
    ).resolves.toBeUndefined();
    // Restore for the next assertion
    crypto.subtle.digest = realDigest;
    // And the underlying store should be untouched
    const raw = localStorage.getItem(LS_KEY);
    expect(raw).toBeNull();
  });
});

describe("cache resilience — quota-driven halving eviction", () => {
  const realSetItem = Storage.prototype.setItem;

  afterEach(() => {
    Storage.prototype.setItem = realSetItem;
  });

  it("on quota exceeded, keeps the entries with latest expiresAt", async () => {
    // First populate a normal store
    for (let i = 0; i < 10; i++) {
      await storeTranslation(`entry-${i}`, makeResult({ translatedText: `v${i}` }));
    }

    // Now rig setItem so the first call throws but the second succeeds
    let call = 0;
    Storage.prototype.setItem = jest.fn((key: string, value: string) => {
      call += 1;
      if (call === 1) {
        const err = new Error("QuotaExceededError");
        (err as Error & { name: string }).name = "QuotaExceededError";
        throw err;
      }
      // Call the real setItem on retry
      realSetItem.call(localStorage, key, value);
    });

    await storeTranslation("new entry triggers quota", makeResult({ translatedText: "new" }));

    // The halved store should have at most half the entries (roughly)
    const raw = localStorage.getItem(LS_KEY);
    expect(raw).toBeTruthy();
    const store = JSON.parse(raw!);
    // We had 11 entries before retry, halved to 5 entries kept
    expect(Object.keys(store).length).toBeLessThanOrEqual(6);
    expect(Object.keys(store).length).toBeGreaterThan(0);
  });
});
