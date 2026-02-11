jest.mock("nostr-tools/pure", () => ({
  finalizeEvent: jest.fn().mockImplementation((event) => ({
    ...event,
    id: "mock-event-id-abc123",
    sig: "mock-sig",
    pubkey: "mock-pubkey",
  })),
}));

jest.mock("nostr-tools/pool", () => ({
  SimplePool: jest.fn().mockImplementation(() => ({
    publish: jest.fn().mockReturnValue([Promise.resolve()]),
    destroy: jest.fn(),
  })),
}));

jest.mock("nostr-tools/nip19", () => ({
  naddrEncode: jest.fn().mockReturnValue("naddr1mock"),
}));

import { publishSignalToNostr, publishBriefingToNostr } from "@/lib/nostr/publish";
import { finalizeEvent } from "nostr-tools/pure";
import { SimplePool } from "nostr-tools/pool";
import { naddrEncode } from "nostr-tools/nip19";
import { DEFAULT_RELAYS } from "@/lib/nostr/types";

const mockFinalizeEvent = finalizeEvent as jest.MockedFunction<typeof finalizeEvent>;
const mockNaddrEncode = naddrEncode as jest.MockedFunction<typeof naddrEncode>;

const fakeSk = new Uint8Array(32).fill(1);

describe("publishSignalToNostr", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: single relay succeeds
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      publish: jest.fn().mockReturnValue([Promise.resolve()]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);
  });

  it("returns eventId from finalized event", async () => {
    const result = await publishSignalToNostr("hello", fakeSk, [["t", "test"]]);
    expect(result.eventId).toBe("mock-event-id-abc123");
  });

  it("passes correct kind and content to finalizeEvent", async () => {
    await publishSignalToNostr("my signal text", fakeSk, [["aegis", "v1"]]);
    expect(mockFinalizeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 1,
        content: "my signal text",
        tags: [["aegis", "v1"]],
      }),
      fakeSk,
    );
  });

  it("uses DEFAULT_RELAYS when relayUrls not provided", async () => {
    const mockPublish = jest.fn().mockReturnValue(DEFAULT_RELAYS.map(() => Promise.resolve()));
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      publish: mockPublish,
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const result = await publishSignalToNostr("text", fakeSk, []);
    expect(mockPublish).toHaveBeenCalledWith(DEFAULT_RELAYS, expect.anything());
    expect(result.relaysPublished).toEqual(DEFAULT_RELAYS);
  });

  it("uses DEFAULT_RELAYS when relayUrls is empty array", async () => {
    const mockPublish = jest.fn().mockReturnValue(DEFAULT_RELAYS.map(() => Promise.resolve()));
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      publish: mockPublish,
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const result = await publishSignalToNostr("text", fakeSk, [], []);
    expect(mockPublish).toHaveBeenCalledWith(DEFAULT_RELAYS, expect.anything());
    expect(result.relaysPublished).toEqual(DEFAULT_RELAYS);
  });

  it("uses provided relayUrls when specified", async () => {
    const customRelays = ["wss://custom.relay.com"];
    const mockPublish = jest.fn().mockReturnValue([Promise.resolve()]);
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      publish: mockPublish,
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const result = await publishSignalToNostr("text", fakeSk, [], customRelays);
    expect(mockPublish).toHaveBeenCalledWith(customRelays, expect.anything());
    expect(result.relaysPublished).toEqual(customRelays);
  });

  it("partitions relays into published and failed", async () => {
    const relays = ["wss://ok.relay", "wss://fail.relay"];
    const mockPublish = jest.fn().mockReturnValue([
      Promise.resolve(),
      Promise.reject(new Error("timeout")),
    ]);
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      publish: mockPublish,
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const result = await publishSignalToNostr("text", fakeSk, [], relays);
    expect(result.relaysPublished).toEqual(["wss://ok.relay"]);
    expect(result.relaysFailed).toEqual(["wss://fail.relay"]);
  });

  it("destroys pool after publish", async () => {
    const mockDestroy = jest.fn();
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      publish: jest.fn().mockReturnValue([Promise.resolve()]),
      destroy: mockDestroy,
    }) as unknown as SimplePool);

    await publishSignalToNostr("text", fakeSk, []);
    expect(mockDestroy).toHaveBeenCalled();
  });

  it("sets created_at to current timestamp in seconds", async () => {
    const before = Math.floor(Date.now() / 1000);
    await publishSignalToNostr("text", fakeSk, []);
    const after = Math.floor(Date.now() / 1000);

    const call = mockFinalizeEvent.mock.calls[0][0] as { created_at: number };
    expect(call.created_at).toBeGreaterThanOrEqual(before);
    expect(call.created_at).toBeLessThanOrEqual(after);
  });
});

describe("publishBriefingToNostr", () => {
  const fakePk = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
  const serialized = {
    content: "# Test Briefing\n\nContent",
    tags: [["d", "briefing-123"], ["title", "Test"]],
    identifier: "briefing-123",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      publish: jest.fn().mockReturnValue([Promise.resolve()]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);
    mockNaddrEncode.mockReturnValue("naddr1mock");
  });

  it("returns naddr, eventId, and relay lists", async () => {
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      publish: jest.fn().mockReturnValue(DEFAULT_RELAYS.map(() => Promise.resolve())),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    const result = await publishBriefingToNostr(serialized, fakeSk, fakePk);
    expect(result.naddr).toBe("naddr1mock");
    expect(result.eventId).toBe("mock-event-id-abc123");
    expect(result.relaysPublished).toEqual(DEFAULT_RELAYS);
    expect(result.relaysFailed).toEqual([]);
  });

  it("passes Kind 30023 to finalizeEvent", async () => {
    await publishBriefingToNostr(serialized, fakeSk, fakePk);
    expect(mockFinalizeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 30023,
        content: serialized.content,
        tags: serialized.tags,
      }),
      fakeSk,
    );
  });

  it("encodes naddr with published relays when some succeed", async () => {
    const relays = ["wss://ok.relay", "wss://fail.relay"];
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      publish: jest.fn().mockReturnValue([
        Promise.resolve(),
        Promise.reject(new Error("timeout")),
      ]),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    await publishBriefingToNostr(serialized, fakeSk, fakePk, relays);
    expect(mockNaddrEncode).toHaveBeenCalledWith(expect.objectContaining({
      identifier: "briefing-123",
      pubkey: fakePk,
      kind: 30023,
      relays: ["wss://ok.relay"],
    }));
  });

  it("falls back to input relays for naddr when all relays fail", async () => {
    const relays = ["wss://fail1.relay", "wss://fail2.relay", "wss://fail3.relay"];
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      publish: jest.fn().mockReturnValue(relays.map(() => Promise.reject(new Error("timeout")))),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    await publishBriefingToNostr(serialized, fakeSk, fakePk, relays);
    expect(mockNaddrEncode).toHaveBeenCalledWith(expect.objectContaining({
      relays: ["wss://fail1.relay", "wss://fail2.relay"],
    }));
  });

  it("uses DEFAULT_RELAYS when relayUrls not provided", async () => {
    const mockPublish = jest.fn().mockReturnValue(DEFAULT_RELAYS.map(() => Promise.resolve()));
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      publish: mockPublish,
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    await publishBriefingToNostr(serialized, fakeSk, fakePk);
    expect(mockPublish).toHaveBeenCalledWith(DEFAULT_RELAYS, expect.anything());
  });

  it("limits naddr relays to first 2 published relays", async () => {
    const relays = ["wss://r1.com", "wss://r2.com", "wss://r3.com"];
    (SimplePool as jest.MockedClass<typeof SimplePool>).mockImplementation(() => ({
      publish: jest.fn().mockReturnValue(relays.map(() => Promise.resolve())),
      destroy: jest.fn(),
    }) as unknown as SimplePool);

    await publishBriefingToNostr(serialized, fakeSk, fakePk, relays);
    expect(mockNaddrEncode).toHaveBeenCalledWith(expect.objectContaining({
      relays: ["wss://r1.com", "wss://r2.com"],
    }));
  });
});
