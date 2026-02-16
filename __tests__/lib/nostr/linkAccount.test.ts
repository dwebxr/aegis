/**
 * @jest-environment jsdom
 */
jest.mock("nostr-tools/nip19", () => ({
  decode: jest.fn(),
  npubEncode: jest.fn(),
}));

jest.mock("nostr-tools/pool", () => ({
  SimplePool: jest.fn().mockImplementation(() => ({
    querySync: jest.fn().mockResolvedValue([]),
    destroy: jest.fn(),
  })),
}));

jest.mock("@/lib/wot/cache", () => ({
  clearWoTCache: jest.fn(),
}));

const mockSaveUserSettings = jest.fn().mockResolvedValue(true);
const mockGetUserSettings = jest.fn().mockResolvedValue([]);
jest.mock("@/lib/ic/actor", () => ({
  createBackendActorAsync: jest.fn().mockResolvedValue({
    saveUserSettings: (...args: unknown[]) => mockSaveUserSettings(...args),
    getUserSettings: (...args: unknown[]) => mockGetUserSettings(...args),
  }),
}));

import {
  resolveNostrInput,
  getLinkedAccount,
  saveLinkedAccount,
  clearLinkedAccount,
  maskNpub,
  fetchNostrProfile,
  linkNostrAccount,
  syncLinkedAccountToIC,
  loadSettingsFromIC,
  parseICSettings,
} from "@/lib/nostr/linkAccount";
import type { LinkedNostrAccount } from "@/lib/nostr/linkAccount";
import { decode, npubEncode } from "nostr-tools/nip19";
import { SimplePool } from "nostr-tools/pool";
import { clearWoTCache } from "@/lib/wot/cache";

const mockDecode = decode as jest.MockedFunction<typeof decode>;
const mockNpubEncode = npubEncode as jest.MockedFunction<typeof npubEncode>;

const FAKE_HEX = "a".repeat(64);
const FAKE_NPUB = "npub1testfakenpubvalue123456789";

const fakeIdentity = {} as import("@dfinity/agent").Identity;

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  mockSaveUserSettings.mockResolvedValue(true);
  mockGetUserSettings.mockResolvedValue([]);
});

describe("resolveNostrInput", () => {
  it("resolves valid npub bech32 to hex + npub", () => {
    mockDecode.mockReturnValue({ type: "npub", data: FAKE_HEX } as ReturnType<typeof decode>);
    const result = resolveNostrInput(FAKE_NPUB);
    expect(result.pubkeyHex).toBe(FAKE_HEX);
    expect(result.npub).toBe(FAKE_NPUB);
    expect(mockDecode).toHaveBeenCalledWith(FAKE_NPUB);
  });

  it("resolves valid 64-char hex to hex + npub", () => {
    mockNpubEncode.mockReturnValue(FAKE_NPUB);
    const result = resolveNostrInput(FAKE_HEX);
    expect(result.pubkeyHex).toBe(FAKE_HEX);
    expect(result.npub).toBe(FAKE_NPUB);
    expect(mockNpubEncode).toHaveBeenCalledWith(FAKE_HEX);
  });

  it("throws on invalid input", () => {
    expect(() => resolveNostrInput("not-valid")).toThrow("Invalid input:");
  });

  it("throws on too-short hex", () => {
    expect(() => resolveNostrInput("abcdef1234")).toThrow("Invalid input:");
  });

  it("throws on nsec input", () => {
    expect(() => resolveNostrInput("nsec1secretkey123")).toThrow("Secret keys (nsec) are not accepted");
  });

  it("throws on empty input", () => {
    expect(() => resolveNostrInput("")).toThrow("Input is empty");
  });

  it("trims whitespace before processing", () => {
    mockDecode.mockReturnValue({ type: "npub", data: FAKE_HEX } as ReturnType<typeof decode>);
    const result = resolveNostrInput("  " + FAKE_NPUB + "  \n");
    expect(result.pubkeyHex).toBe(FAKE_HEX);
    expect(mockDecode).toHaveBeenCalledWith(FAKE_NPUB);
  });

  it("normalizes uppercase hex to lowercase", () => {
    const upperHex = "A".repeat(64);
    mockNpubEncode.mockReturnValue(FAKE_NPUB);
    const result = resolveNostrInput(upperHex);
    expect(result.pubkeyHex).toBe("a".repeat(64));
    expect(mockNpubEncode).toHaveBeenCalledWith("a".repeat(64));
  });

  it("throws when decoded type is not npub", () => {
    mockDecode.mockReturnValue({ type: "nprofile", data: { pubkey: FAKE_HEX, relays: [] } } as unknown as ReturnType<typeof decode>);
    expect(() => resolveNostrInput("npub1invalid")).toThrow("Expected npub");
  });

  it("throws 'Invalid npub format' when decode throws generic error", () => {
    mockDecode.mockImplementation(() => { throw new Error("checksum mismatch"); });
    expect(() => resolveNostrInput("npub1badchecksum")).toThrow("Invalid npub format");
  });

  it("re-throws errors that mention 'npub'", () => {
    mockDecode.mockImplementation(() => { throw new Error("Expected npub, got nsec"); });
    expect(() => resolveNostrInput("npub1thing")).toThrow("Expected npub");
  });

  it("throws on whitespace-only input", () => {
    expect(() => resolveNostrInput("   ")).toThrow("Input is empty");
  });

  it("throws on 63-char hex (boundary)", () => {
    expect(() => resolveNostrInput("a".repeat(63))).toThrow("Invalid input:");
  });

  it("throws on 65-char hex (boundary)", () => {
    expect(() => resolveNostrInput("a".repeat(65))).toThrow("Invalid input:");
  });
});

describe("storage", () => {
  const account: LinkedNostrAccount = {
    npub: FAKE_NPUB,
    pubkeyHex: FAKE_HEX,
    displayName: "Alice",
    linkedAt: 1700000000000,
    followCount: 42,
  };

  it("getLinkedAccount returns null when nothing stored", () => {
    expect(getLinkedAccount()).toBeNull();
  });

  it("round-trips saveLinkedAccount / getLinkedAccount", () => {
    saveLinkedAccount(account);
    const loaded = getLinkedAccount();
    expect(loaded).toEqual(account);
  });

  it("clearLinkedAccount removes from storage", () => {
    saveLinkedAccount(account);
    clearLinkedAccount();
    expect(getLinkedAccount()).toBeNull();
  });

  it("getLinkedAccount reflects link state", () => {
    expect(getLinkedAccount()).toBeNull();
    saveLinkedAccount(account);
    expect(getLinkedAccount()).not.toBeNull();
  });

  it("getLinkedAccount returns null on corrupted JSON in storage", () => {
    localStorage.setItem("aegis-linked-nostr", "{invalid json!!!");
    expect(getLinkedAccount()).toBeNull();
  });

  it("clearLinkedAccount is safe to call when nothing stored", () => {
    expect(() => clearLinkedAccount()).not.toThrow();
    expect(getLinkedAccount()).toBeNull();
  });

  it("saveLinkedAccount overwrites previous account", () => {
    saveLinkedAccount(account);
    const newAccount: LinkedNostrAccount = {
      npub: "npub1other",
      pubkeyHex: "b".repeat(64),
      displayName: "Bob",
      linkedAt: 1800000000000,
      followCount: 100,
    };
    saveLinkedAccount(newAccount);
    expect(getLinkedAccount()).toEqual(newAccount);
  });

  it("preserves all fields including optional displayName", () => {
    const noName: LinkedNostrAccount = {
      npub: FAKE_NPUB,
      pubkeyHex: FAKE_HEX,
      linkedAt: 1700000000000,
      followCount: 0,
    };
    saveLinkedAccount(noName);
    const loaded = getLinkedAccount();
    expect(loaded?.displayName).toBeUndefined();
    expect(loaded?.followCount).toBe(0);
    expect(loaded?.linkedAt).toBe(1700000000000);
  });
});

describe("maskNpub", () => {
  it("masks long npub with ellipsis", () => {
    const masked = maskNpub(FAKE_NPUB);
    expect(masked).toContain("…");
    expect(masked.length).toBeLessThan(FAKE_NPUB.length);
  });

  it("returns short npub unchanged", () => {
    expect(maskNpub("npub1short")).toBe("npub1short");
  });

  it("returns 16-char string unchanged (boundary)", () => {
    const s = "npub1abcdefghijk"; // exactly 16 chars
    expect(s).toHaveLength(16);
    expect(maskNpub(s)).toBe(s);
  });

  it("masks 17-char string (boundary)", () => {
    const s = "npub1abcdefghijkl"; // 17 chars
    expect(s).toHaveLength(17);
    const masked = maskNpub(s);
    expect(masked).toContain("…");
    expect(masked.startsWith("npub1abcde")).toBe(true);
    expect(masked.endsWith("hijkl")).toBe(true);
  });

  it("preserves first 10 and last 6 characters", () => {
    const npub = "npub1" + "x".repeat(40);
    const masked = maskNpub(npub);
    expect(masked.slice(0, 10)).toBe(npub.slice(0, 10));
    expect(masked.slice(-6)).toBe(npub.slice(-6));
    expect(masked).toBe(npub.slice(0, 10) + "…" + npub.slice(-6));
  });
});

describe("fetchNostrProfile", () => {
  it("extracts displayName from kind:0 metadata", async () => {
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([
        { kind: 0, content: JSON.stringify({ display_name: "Bob", name: "bob" }), tags: [] },
      ]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const profile = await fetchNostrProfile(FAKE_HEX);
    expect(profile.displayName).toBe("Bob");
  });

  it("counts follows from kind:3 p-tags", async () => {
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([
        { kind: 3, content: "", tags: [["p", "a"], ["p", "b"], ["p", "c"], ["e", "ignored"]] },
      ]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const profile = await fetchNostrProfile(FAKE_HEX);
    expect(profile.followCount).toBe(3);
  });

  it("returns followCount 0 when no kind:3", async () => {
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const profile = await fetchNostrProfile(FAKE_HEX);
    expect(profile.followCount).toBe(0);
  });

  it("prefers display_name over name in kind:0", async () => {
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([
        { kind: 0, content: JSON.stringify({ display_name: "DisplayBob", name: "bob_handle" }), tags: [] },
      ]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const profile = await fetchNostrProfile(FAKE_HEX);
    expect(profile.displayName).toBe("DisplayBob");
  });

  it("falls back to name when display_name is missing", async () => {
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([
        { kind: 0, content: JSON.stringify({ name: "bob_handle" }), tags: [] },
      ]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const profile = await fetchNostrProfile(FAKE_HEX);
    expect(profile.displayName).toBe("bob_handle");
  });

  it("returns undefined displayName when kind:0 has no name fields", async () => {
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([
        { kind: 0, content: JSON.stringify({ about: "just a bio" }), tags: [] },
      ]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const profile = await fetchNostrProfile(FAKE_HEX);
    expect(profile.displayName).toBeUndefined();
  });

  it("handles invalid JSON in kind:0 content gracefully", async () => {
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([
        { kind: 0, content: "not json at all {{{", tags: [] },
        { kind: 3, content: "", tags: [["p", "x"]] },
      ]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const profile = await fetchNostrProfile(FAKE_HEX);
    expect(profile.displayName).toBeUndefined();
    expect(profile.followCount).toBe(1);
  });

  it("processes both kind:0 and kind:3 from same response", async () => {
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([
        { kind: 0, content: JSON.stringify({ name: "Combined" }), tags: [] },
        { kind: 3, content: "", tags: [["p", "a"], ["p", "b"], ["p", "c"], ["p", "d"], ["p", "e"]] },
      ]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const profile = await fetchNostrProfile(FAKE_HEX);
    expect(profile.displayName).toBe("Combined");
    expect(profile.followCount).toBe(5);
  });

  it("ignores non-p tags in kind:3 follow count", async () => {
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([
        { kind: 3, content: "", tags: [["p", "a"], ["e", "event1"], ["t", "topic"], ["p", "b"], ["r", "relay"]] },
      ]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const profile = await fetchNostrProfile(FAKE_HEX);
    expect(profile.followCount).toBe(2);
  });

  it("calls pool.destroy() even when querySync rejects", async () => {
    const destroyFn = jest.fn();
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockRejectedValue(new Error("relay failure")),
      destroy: destroyFn,
    }) as unknown as SimplePool);

    await expect(fetchNostrProfile(FAKE_HEX)).rejects.toThrow("relay failure");
    expect(destroyFn).toHaveBeenCalled();
  });

  it("returns undefined displayName when display_name is empty string", async () => {
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([
        { kind: 0, content: JSON.stringify({ display_name: "", name: "" }), tags: [] },
      ]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const profile = await fetchNostrProfile(FAKE_HEX);
    expect(profile.displayName).toBeUndefined();
  });
});

describe("linkNostrAccount", () => {
  beforeEach(() => {
    mockDecode.mockReturnValue({ type: "npub", data: FAKE_HEX } as ReturnType<typeof decode>);
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([
        { kind: 0, content: JSON.stringify({ name: "TestUser" }), tags: [] },
        { kind: 3, content: "", tags: [["p", "x"], ["p", "y"]] },
      ]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);
  });

  it("resolves input, fetches profile, and saves", async () => {
    const result = await linkNostrAccount(FAKE_NPUB);
    expect(result.pubkeyHex).toBe(FAKE_HEX);
    expect(result.displayName).toBe("TestUser");
    expect(result.followCount).toBe(2);
    expect(getLinkedAccount()).toEqual(result);
  });

  it("calls clearWoTCache to force graph rebuild", async () => {
    await linkNostrAccount(FAKE_NPUB);
    expect(clearWoTCache).toHaveBeenCalled();
  });

  it("calls onProgress callback", async () => {
    const onProgress = jest.fn();
    await linkNostrAccount(FAKE_NPUB, onProgress);
    expect(onProgress).toHaveBeenCalledWith("Fetching profile…");
  });

  it("throws on relay failure", async () => {
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockRejectedValue(new Error("Connection refused")),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    await expect(linkNostrAccount(FAKE_NPUB)).rejects.toThrow("Connection refused");
  });

  it("does not call onProgress when callback is omitted", async () => {
    // Should not throw when onProgress is undefined
    const result = await linkNostrAccount(FAKE_NPUB);
    expect(result.pubkeyHex).toBe(FAKE_HEX);
  });

  it("stores a valid linkedAt timestamp", async () => {
    const before = Date.now();
    const result = await linkNostrAccount(FAKE_NPUB);
    const after = Date.now();
    expect(result.linkedAt).toBeGreaterThanOrEqual(before);
    expect(result.linkedAt).toBeLessThanOrEqual(after);
  });

  it("persists to localStorage so getLinkedAccount returns same data", async () => {
    const result = await linkNostrAccount(FAKE_NPUB);
    const stored = getLinkedAccount();
    expect(stored).not.toBeNull();
    expect(stored!.npub).toBe(result.npub);
    expect(stored!.pubkeyHex).toBe(result.pubkeyHex);
    expect(stored!.displayName).toBe(result.displayName);
    expect(stored!.followCount).toBe(result.followCount);
    expect(stored!.linkedAt).toBe(result.linkedAt);
  });

  it("works with 0 follows (edge case)", async () => {
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockResolvedValue([
        { kind: 0, content: JSON.stringify({ name: "NewUser" }), tags: [] },
      ]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const result = await linkNostrAccount(FAKE_NPUB);
    expect(result.followCount).toBe(0);
    expect(result.displayName).toBe("NewUser");
  });

  it("does not save to localStorage on relay failure", async () => {
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockRejectedValue(new Error("timeout")),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    await expect(linkNostrAccount(FAKE_NPUB)).rejects.toThrow("timeout");
    expect(getLinkedAccount()).toBeNull();
  });

  it("does not call clearWoTCache on relay failure", async () => {
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      querySync: jest.fn().mockRejectedValue(new Error("fail")),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    await expect(linkNostrAccount(FAKE_NPUB)).rejects.toThrow();
    expect(clearWoTCache).not.toHaveBeenCalled();
  });

  it("throws when localStorage save fails (quota exceeded)", async () => {
    const spy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      await expect(linkNostrAccount(FAKE_NPUB)).rejects.toThrow("Failed to save linked account");
    } finally {
      spy.mockRestore();
    }
  });

  it("throws on invalid input before making any relay calls", async () => {
    const poolConstructor = SimplePool as jest.MockedClass<typeof SimplePool>;
    await expect(linkNostrAccount("bad-input")).rejects.toThrow("Invalid input:");
    // SimplePool should never have been constructed
    expect(poolConstructor).not.toHaveBeenCalled();
  });
});

describe("syncLinkedAccountToIC", () => {
  const account: LinkedNostrAccount = {
    npub: FAKE_NPUB,
    pubkeyHex: FAKE_HEX,
    displayName: "Alice",
    linkedAt: 1700000000000,
    followCount: 42,
  };

  it("calls saveUserSettings with correct payload", async () => {
    await syncLinkedAccountToIC(fakeIdentity, account, true);
    expect(mockSaveUserSettings).toHaveBeenCalledWith({
      linkedNostrNpub: [FAKE_NPUB],
      linkedNostrPubkeyHex: [FAKE_HEX],
      d2aEnabled: true,
      updatedAt: BigInt(0),
    });
  });

  it("sends empty arrays when account is null (unlink)", async () => {
    await syncLinkedAccountToIC(fakeIdentity, null, false);
    expect(mockSaveUserSettings).toHaveBeenCalledWith({
      linkedNostrNpub: [],
      linkedNostrPubkeyHex: [],
      d2aEnabled: false,
      updatedAt: BigInt(0),
    });
  });

  it("swallows errors (logs warning, does not throw)", async () => {
    mockSaveUserSettings.mockRejectedValue(new Error("IC unreachable"));
    await expect(syncLinkedAccountToIC(fakeIdentity, account, true)).resolves.toBeUndefined();
  });
});

describe("loadSettingsFromIC", () => {
  it("returns account + d2aEnabled from IC", async () => {
    mockGetUserSettings.mockResolvedValue([{
      linkedNostrNpub: [FAKE_NPUB],
      linkedNostrPubkeyHex: [FAKE_HEX],
      d2aEnabled: true,
      updatedAt: BigInt(1700000000000),
    }]);
    const result = await loadSettingsFromIC(fakeIdentity, "aaaaa-aa");
    expect(result).not.toBeNull();
    expect(result!.account).not.toBeNull();
    expect(result!.account!.npub).toBe(FAKE_NPUB);
    expect(result!.account!.pubkeyHex).toBe(FAKE_HEX);
    expect(result!.d2aEnabled).toBe(true);
  });

  it("returns null when no settings stored", async () => {
    mockGetUserSettings.mockResolvedValue([]);
    const result = await loadSettingsFromIC(fakeIdentity, "aaaaa-aa");
    expect(result).toBeNull();
  });

  it("returns null account when npub fields are empty", async () => {
    mockGetUserSettings.mockResolvedValue([{
      linkedNostrNpub: [],
      linkedNostrPubkeyHex: [],
      d2aEnabled: false,
      updatedAt: BigInt(0),
    }]);
    const result = await loadSettingsFromIC(fakeIdentity, "aaaaa-aa");
    expect(result).not.toBeNull();
    expect(result!.account).toBeNull();
    expect(result!.d2aEnabled).toBe(false);
  });

  it("swallows errors and returns null", async () => {
    mockGetUserSettings.mockRejectedValue(new Error("IC unreachable"));
    const result = await loadSettingsFromIC(fakeIdentity, "aaaaa-aa");
    expect(result).toBeNull();
  });
});

describe("parseICSettings", () => {
  it("extracts account when npub and hex are present", () => {
    const result = parseICSettings({
      linkedNostrNpub: ["npub1abc"],
      linkedNostrPubkeyHex: ["deadbeef"],
      d2aEnabled: true,
    });
    expect(result.account).not.toBeNull();
    expect(result.account!.npub).toBe("npub1abc");
    expect(result.account!.pubkeyHex).toBe("deadbeef");
    expect(result.account!.followCount).toBe(0);
    expect(result.d2aEnabled).toBe(true);
  });

  it("returns null account when arrays are empty", () => {
    const result = parseICSettings({
      linkedNostrNpub: [],
      linkedNostrPubkeyHex: [],
      d2aEnabled: false,
    });
    expect(result.account).toBeNull();
    expect(result.d2aEnabled).toBe(false);
  });

  it("returns null account when only npub is present (no hex)", () => {
    const result = parseICSettings({
      linkedNostrNpub: ["npub1abc"],
      linkedNostrPubkeyHex: [],
      d2aEnabled: true,
    });
    expect(result.account).toBeNull();
  });

  it("returns null account when only hex is present (no npub)", () => {
    const result = parseICSettings({
      linkedNostrNpub: [],
      linkedNostrPubkeyHex: ["deadbeef"],
      d2aEnabled: false,
    });
    expect(result.account).toBeNull();
  });
});
