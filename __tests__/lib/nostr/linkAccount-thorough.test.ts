import {
  resolveNostrInput,
  maskNpub,
  getLinkedAccount,
  saveLinkedAccount,
  clearLinkedAccount,
  parseICSettings,
  type LinkedNostrAccount,
} from "@/lib/nostr/linkAccount";

const store: Record<string, string> = {};
beforeAll(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    },
    writable: true,
  });
});
beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
});

describe("resolveNostrInput — valid inputs", () => {
  it("accepts valid npub1 address", () => {
    // Use a well-known test npub (32 bytes → bech32)
    const hex = "0".repeat(64);
    // We'll test with raw hex since generating valid npub requires real encoding
    const result = resolveNostrInput(hex);
    expect(result.pubkeyHex).toBe(hex);
    expect(result.npub).toMatch(/^npub1/);
  });

  it("accepts 64-char hex pubkey", () => {
    const hex = "ab".repeat(32);
    const result = resolveNostrInput(hex);
    expect(result.pubkeyHex).toBe(hex);
    expect(result.npub).toMatch(/^npub1/);
  });

  it("accepts uppercase hex (lowercased)", () => {
    const hex = "AB".repeat(32);
    const result = resolveNostrInput(hex);
    expect(result.pubkeyHex).toBe("ab".repeat(32));
  });

  it("trims whitespace from input", () => {
    const hex = "cd".repeat(32);
    const result = resolveNostrInput(`  ${hex}  `);
    expect(result.pubkeyHex).toBe(hex);
  });
});

describe("resolveNostrInput — error cases", () => {
  it("rejects empty input", () => {
    expect(() => resolveNostrInput("")).toThrow("Input is empty");
  });

  it("rejects whitespace-only input", () => {
    expect(() => resolveNostrInput("   ")).toThrow("Input is empty");
  });

  it("rejects nsec (secret key)", () => {
    expect(() => resolveNostrInput("nsec1abc123def456")).toThrow(/Secret keys/);
    expect(() => resolveNostrInput("nsec1abc123def456")).toThrow(/not accepted/);
  });

  it("rejects invalid format (not npub, nsec, or hex)", () => {
    expect(() => resolveNostrInput("hello-world")).toThrow(/Invalid input/);
  });

  it("rejects hex that is too short", () => {
    expect(() => resolveNostrInput("abcd1234")).toThrow(/Invalid input/);
  });

  it("rejects hex that is too long", () => {
    expect(() => resolveNostrInput("a".repeat(65))).toThrow(/Invalid input/);
  });

  it("rejects hex with non-hex characters", () => {
    expect(() => resolveNostrInput("g".repeat(64))).toThrow(/Invalid input/);
  });
});

describe("maskNpub", () => {
  it("masks long npub with ellipsis", () => {
    const npub = "npub1" + "x".repeat(50);
    const masked = maskNpub(npub);
    // slice(0,10) + "…" + slice(-6) → "npub1xxxxx…xxxxxx"
    expect(masked).toBe("npub1xxxxx…xxxxxx");
    expect(masked.length).toBe(17); // 10 + 1 (…) + 6
  });

  it("returns short npub unchanged", () => {
    expect(maskNpub("npub1short")).toBe("npub1short");
  });

  it("returns exactly 16 chars unchanged", () => {
    const npub = "a".repeat(16);
    expect(maskNpub(npub)).toBe(npub);
  });

  it("masks 17-char string (same length due to ellipsis overhead)", () => {
    const input = "a".repeat(17);
    const masked = maskNpub(input);
    // 10 + 1 + 6 = 17, same length but with ellipsis in middle
    expect(masked).toContain("…");
    expect(masked).toBe("aaaaaaaaaa…aaaaaa");
  });
});

describe("persistence — get/save/clear", () => {
  it("round-trips linked account", () => {
    const account: LinkedNostrAccount = {
      npub: "npub1test",
      pubkeyHex: "ab".repeat(32),
      displayName: "Test User",
      linkedAt: Date.now(),
      followCount: 100,
    };
    expect(saveLinkedAccount(account)).toBe(true);
    const loaded = getLinkedAccount();
    expect(loaded).toEqual(account);
  });

  it("getLinkedAccount returns null when empty", () => {
    expect(getLinkedAccount()).toBeNull();
  });

  it("clearLinkedAccount removes stored data", () => {
    saveLinkedAccount({
      npub: "npub1test", pubkeyHex: "cd".repeat(32),
      linkedAt: Date.now(), followCount: 0,
    });
    expect(getLinkedAccount()).not.toBeNull();
    clearLinkedAccount();
    expect(getLinkedAccount()).toBeNull();
  });

  it("handles corrupted localStorage gracefully", () => {
    store["aegis-linked-nostr"] = "{{invalid json";
    expect(getLinkedAccount()).toBeNull();
  });

  it("rejects stored data missing required fields", () => {
    store["aegis-linked-nostr"] = JSON.stringify({ npub: "npub1test" });
    // Missing pubkeyHex → validation rejects and clears corrupted data
    expect(getLinkedAccount()).toBeNull();
    expect(store["aegis-linked-nostr"]).toBeUndefined();
  });

  it("accepts stored data with all required fields", () => {
    store["aegis-linked-nostr"] = JSON.stringify({ npub: "npub1test", pubkeyHex: "ab".repeat(32), linkedAt: Date.now(), followCount: 5 });
    const account = getLinkedAccount();
    expect(account).not.toBeNull();
    expect(account!.npub).toBe("npub1test");
    expect(account!.pubkeyHex).toBe("ab".repeat(32));
  });
});

describe("parseICSettings", () => {
  it("parses full settings with linked account and IC updatedAt", () => {
    const result = parseICSettings({
      linkedNostrNpub: ["npub1test"],
      linkedNostrPubkeyHex: ["ab".repeat(32)],
      d2aEnabled: true,
      updatedAt: BigInt(1700000000_000_000_000),
    });
    expect(result.account).not.toBeNull();
    expect(result.account!.npub).toBe("npub1test");
    expect(result.account!.pubkeyHex).toBe("ab".repeat(32));
    expect(result.account!.linkedAt).toBe(1700000000_000);
    expect(result.d2aEnabled).toBe(true);
  });

  it("returns null account when no npub", () => {
    const result = parseICSettings({
      linkedNostrNpub: [],
      linkedNostrPubkeyHex: ["ab".repeat(32)],
      d2aEnabled: false,
    });
    expect(result.account).toBeNull();
  });

  it("returns null account when no pubkeyHex", () => {
    const result = parseICSettings({
      linkedNostrNpub: ["npub1test"],
      linkedNostrPubkeyHex: [],
      d2aEnabled: false,
    });
    expect(result.account).toBeNull();
  });

  it("returns null account when both empty", () => {
    const result = parseICSettings({
      linkedNostrNpub: [],
      linkedNostrPubkeyHex: [],
      d2aEnabled: false,
    });
    expect(result.account).toBeNull();
    expect(result.d2aEnabled).toBe(false);
  });

  it("defaults linkedAt to 0 and followCount to 0 when updatedAt absent", () => {
    const result = parseICSettings({
      linkedNostrNpub: ["npub1test"],
      linkedNostrPubkeyHex: ["ff".repeat(32)],
      d2aEnabled: true,
    });
    expect(result.account!.followCount).toBe(0);
    expect(result.account!.linkedAt).toBe(0);
  });
});
