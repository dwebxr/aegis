jest.mock("nostr-tools/pool", () => ({
  SimplePool: jest.fn().mockImplementation(() => ({
    publish: jest.fn((...args: unknown[]) => {
      const urls = args[0] as string[];
      return urls.map(() => Promise.reject(new Error("mock: no real connection")));
    }),
    destroy: jest.fn(),
  })),
}));

import { buildAegisTags, publishAndPartition, publishSignalToNostr } from "@/lib/nostr/publish";
import { SimplePool } from "nostr-tools/pool";
import { finalizeEvent } from "nostr-tools/pure";
import { deriveNostrKeypairFromText } from "@/lib/nostr/identity";
import { DEFAULT_RELAYS } from "@/lib/nostr/types";

describe("buildAegisTags — imageUrl (NIP-92 imeta)", () => {
  it("adds imeta tag when imageUrl is provided", () => {
    const tags = buildAegisTags(7.0, undefined, [], "https://nostr.build/i/abc.jpg");
    const imeta = tags.find(t => t[0] === "imeta");
    expect(imeta).toBeDefined();
    expect(imeta![1]).toBe("url https://nostr.build/i/abc.jpg");
  });

  it("omits imeta tag when imageUrl is undefined", () => {
    const tags = buildAegisTags(7.0, undefined, []);
    expect(tags.find(t => t[0] === "imeta")).toBeUndefined();
  });

  it("omits imeta tag when imageUrl is empty string", () => {
    const tags = buildAegisTags(7.0, undefined, [], "");
    expect(tags.find(t => t[0] === "imeta")).toBeUndefined();
  });

  it("total tag count with all options", () => {
    // 3 base + 1 vSignal + 2 topics + 1 imeta = 7
    const tags = buildAegisTags(8.0, 9, ["ai", "ml"], "https://img.com/test.png");
    expect(tags).toHaveLength(7);
  });

  it("preserves full URL in imeta tag", () => {
    const url = "https://nostr.build/i/very-long-path/image-with-special-chars_123.webp";
    const tags = buildAegisTags(5.0, undefined, [], url);
    const imeta = tags.find(t => t[0] === "imeta")!;
    expect(imeta[1]).toBe(`url ${url}`);
  });
});

describe("buildAegisTags — boundary conditions", () => {
  it("handles composite score of 0", () => {
    const tags = buildAegisTags(0, undefined, []);
    expect(tags).toContainEqual(["aegis-score", "0.0"]);
  });

  it("handles composite score of 10", () => {
    const tags = buildAegisTags(10, undefined, []);
    expect(tags).toContainEqual(["aegis-score", "10.0"]);
  });

  it("handles composite with many decimal places", () => {
    const tags = buildAegisTags(7.123456789, undefined, []);
    expect(tags).toContainEqual(["aegis-score", "7.1"]);
  });

  it("handles negative vSignal (should still be included)", () => {
    const tags = buildAegisTags(5.0, -1, []);
    expect(tags).toContainEqual(["aegis-vsignal", "-1"]);
  });

  it("handles empty string topic", () => {
    const tags = buildAegisTags(5.0, undefined, [""]);
    expect(tags).toContainEqual(["t", ""]);
  });
});

describe("publishAndPartition — relay distribution", () => {
  const keys = deriveNostrKeypairFromText("test-publish-partition");

  beforeEach(() => {
    jest.useFakeTimers({ advanceTimers: true });
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns published and failed lists", async () => {
    const signed = finalizeEvent(
      { kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: "test" },
      keys.sk,
    );

    const result = await publishAndPartition(signed, ["wss://fake-relay.example.com"]);
    expect(Array.isArray(result.published)).toBe(true);
    expect(Array.isArray(result.failed)).toBe(true);
    expect(result.published.length + result.failed.length).toBe(1);
  });

  it("handles empty relay list", async () => {
    const signed = finalizeEvent(
      { kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: "test" },
      keys.sk,
    );

    const result = await publishAndPartition(signed, []);
    expect(result.published).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it("handles multiple relays with mixed results", async () => {
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      publish: jest.fn((...args: unknown[]) => {
        const urls = args[0] as string[];
        return urls.map((_, i) => i === 0 ? Promise.resolve() : Promise.reject(new Error("timeout")));
      }),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const signed = finalizeEvent(
      { kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: "test" },
      keys.sk,
    );

    const result = await publishAndPartition(signed, [
      "wss://ok-relay.example.com",
      "wss://fail-relay.example.com",
    ]);
    expect(result.published).toEqual(["wss://ok-relay.example.com"]);
    expect(result.failed).toEqual(["wss://fail-relay.example.com"]);
  });

  it("calls pool.destroy() after publish", async () => {
    const mockDestroy = jest.fn();
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      publish: jest.fn().mockReturnValue([Promise.resolve()]),
      destroy: mockDestroy,
    }) as unknown as SimplePool);

    const signed = finalizeEvent(
      { kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: "test" },
      keys.sk,
    );

    await publishAndPartition(signed, ["wss://relay.example.com"]);
    expect(mockDestroy).toHaveBeenCalled();
  });
});

describe("publishSignalToNostr — relay fallback", () => {
  const keys = deriveNostrKeypairFromText("test-signal-relay");

  beforeEach(() => {
    jest.useFakeTimers({ advanceTimers: true });
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("uses DEFAULT_RELAYS when relayUrls is empty array", async () => {
    const mockPublish = jest.fn((...args: unknown[]) => {
      const urls = args[0] as string[];
      return urls.map(() => Promise.reject(new Error("mock")));
    });
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      publish: mockPublish,
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    await publishSignalToNostr("test signal", keys.sk, [["t", "test"]], []);
    expect(mockPublish).toHaveBeenCalledWith(DEFAULT_RELAYS, expect.anything());
  });

  it("uses DEFAULT_RELAYS when relayUrls is undefined", async () => {
    const mockPublish = jest.fn((...args: unknown[]) => {
      const urls = args[0] as string[];
      return urls.map(() => Promise.reject(new Error("mock")));
    });
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      publish: mockPublish,
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    await publishSignalToNostr("test signal", keys.sk, [["t", "test"]], undefined);
    expect(mockPublish).toHaveBeenCalledWith(DEFAULT_RELAYS, expect.anything());
  });

  it("returns a valid eventId", async () => {
    const result = await publishSignalToNostr("test signal", keys.sk, [["t", "test"]]);
    expect(result.eventId).toBeTruthy();
    expect(typeof result.eventId).toBe("string");
    expect(result.eventId).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uses custom relayUrls when provided", async () => {
    const mockPublish = jest.fn().mockReturnValue([Promise.resolve()]);
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      publish: mockPublish,
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const customRelays = ["wss://custom-relay.example.com"];
    const result = await publishSignalToNostr("test", keys.sk, [], customRelays);
    expect(mockPublish).toHaveBeenCalledWith(customRelays, expect.anything());
    expect(result.relaysPublished).toEqual(customRelays);
  });
});
