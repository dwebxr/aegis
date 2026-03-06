/**
 * Tests for publishCurationList — covers tag construction,
 * relay defaults, member/topic serialization, and error propagation.
 */
import { publishCurationList, parseCurationListEvent } from "@/lib/nostr/lists";
import type { CurationListEvent } from "@/lib/nostr/lists";
import { KIND_CATEGORIZED_LIST } from "@/lib/nostr/types";

// Mock nostr-tools finalizeEvent to capture the event template
const mockFinalizeEvent = jest.fn().mockImplementation((template) => ({
  id: "mock-event-id",
  sig: "mock-sig",
  pubkey: "mock-pubkey",
  ...template,
}));

jest.mock("nostr-tools/pure", () => ({
  finalizeEvent: (...args: unknown[]) => mockFinalizeEvent(...args),
}));

const mockPublishAndPartition = jest.fn().mockResolvedValue({
  published: ["wss://relay.test"],
  failed: [],
});

jest.mock("@/lib/nostr/publish", () => ({
  publishAndPartition: (...args: unknown[]) => mockPublishAndPartition(...args),
}));

const testSk = new Uint8Array(32).fill(1);

function makeList(overrides: Partial<CurationListEvent> = {}): CurationListEvent {
  return {
    dTag: "aegis-group-test",
    name: "Test Group",
    description: "A test curation group",
    members: ["pk1", "pk2"],
    topics: ["ai", "ml"],
    ownerPk: "owner-pk",
    createdAt: 1700000000000,
    ...overrides,
  };
}

beforeEach(() => {
  mockFinalizeEvent.mockClear();
  mockPublishAndPartition.mockClear();
});

describe("publishCurationList", () => {
  it("constructs event with correct kind", async () => {
    await publishCurationList(testSk, makeList());
    expect(mockFinalizeEvent).toHaveBeenCalledTimes(1);
    const [template] = mockFinalizeEvent.mock.calls[0];
    expect(template.kind).toBe(KIND_CATEGORIZED_LIST);
  });

  it("includes d-tag, name, and description", async () => {
    await publishCurationList(testSk, makeList());
    const [template] = mockFinalizeEvent.mock.calls[0];
    expect(template.tags).toContainEqual(["d", "aegis-group-test"]);
    expect(template.tags).toContainEqual(["name", "Test Group"]);
    expect(template.tags).toContainEqual(["description", "A test curation group"]);
  });

  it("includes p-tags for all members", async () => {
    await publishCurationList(testSk, makeList({ members: ["m1", "m2", "m3"] }));
    const [template] = mockFinalizeEvent.mock.calls[0];
    const pTags = template.tags.filter((t: string[]) => t[0] === "p");
    expect(pTags).toEqual([["p", "m1"], ["p", "m2"], ["p", "m3"]]);
  });

  it("includes t-tags for all topics", async () => {
    await publishCurationList(testSk, makeList({ topics: ["crypto", "defi", "nft"] }));
    const [template] = mockFinalizeEvent.mock.calls[0];
    const tTags = template.tags.filter((t: string[]) => t[0] === "t");
    expect(tTags).toEqual([["t", "crypto"], ["t", "defi"], ["t", "nft"]]);
  });

  it("handles empty members and topics", async () => {
    await publishCurationList(testSk, makeList({ members: [], topics: [] }));
    const [template] = mockFinalizeEvent.mock.calls[0];
    const pTags = template.tags.filter((t: string[]) => t[0] === "p");
    const tTags = template.tags.filter((t: string[]) => t[0] === "t");
    expect(pTags).toEqual([]);
    expect(tTags).toEqual([]);
  });

  it("uses custom relay URLs when provided", async () => {
    const customRelays = ["wss://custom1.test", "wss://custom2.test"];
    await publishCurationList(testSk, makeList(), customRelays);
    expect(mockPublishAndPartition).toHaveBeenCalledWith(
      expect.any(Object),
      customRelays,
    );
  });

  it("falls back to DEFAULT_RELAYS when no relay URLs provided", async () => {
    await publishCurationList(testSk, makeList());
    const [, relays] = mockPublishAndPartition.mock.calls[0];
    expect(relays.length).toBeGreaterThan(0);
    expect(relays[0]).toMatch(/^wss:\/\//);
  });

  it("falls back to DEFAULT_RELAYS when empty array provided", async () => {
    await publishCurationList(testSk, makeList(), []);
    const [, relays] = mockPublishAndPartition.mock.calls[0];
    expect(relays.length).toBeGreaterThan(0);
  });

  it("returns published and failed relay lists", async () => {
    mockPublishAndPartition.mockResolvedValueOnce({
      published: ["wss://relay1.test"],
      failed: ["wss://relay2.test"],
    });
    const result = await publishCurationList(testSk, makeList());
    expect(result.published).toEqual(["wss://relay1.test"]);
    expect(result.failed).toEqual(["wss://relay2.test"]);
  });

  it("sets created_at to current time in seconds", async () => {
    const before = Math.floor(Date.now() / 1000);
    await publishCurationList(testSk, makeList());
    const after = Math.floor(Date.now() / 1000);
    const [template] = mockFinalizeEvent.mock.calls[0];
    expect(template.created_at).toBeGreaterThanOrEqual(before);
    expect(template.created_at).toBeLessThanOrEqual(after);
  });

  it("sets content to empty string", async () => {
    await publishCurationList(testSk, makeList());
    const [template] = mockFinalizeEvent.mock.calls[0];
    expect(template.content).toBe("");
  });

  it("propagates errors from publishAndPartition", async () => {
    mockPublishAndPartition.mockRejectedValueOnce(new Error("Relay failure"));
    await expect(publishCurationList(testSk, makeList())).rejects.toThrow("Relay failure");
  });
});

describe("parseCurationListEvent round-trip", () => {
  it("publish → parse preserves all fields", async () => {
    const list = makeList();
    await publishCurationList(testSk, list);
    const [template] = mockFinalizeEvent.mock.calls[0];

    // Simulate what the signed event looks like
    const event = {
      kind: template.kind,
      pubkey: "mock-pubkey",
      created_at: template.created_at,
      tags: template.tags,
      content: template.content,
    };

    const parsed = parseCurationListEvent(event);
    expect(parsed).not.toBeNull();
    expect(parsed!.dTag).toBe(list.dTag);
    expect(parsed!.name).toBe(list.name);
    expect(parsed!.description).toBe(list.description);
    expect(parsed!.members).toEqual(list.members);
    expect(parsed!.topics).toEqual(list.topics);
    expect(parsed!.ownerPk).toBe("mock-pubkey");
  });
});
