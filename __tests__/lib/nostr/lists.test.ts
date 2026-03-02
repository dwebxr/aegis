import { parseCurationListEvent } from "@/lib/nostr/lists";
import { KIND_CATEGORIZED_LIST } from "@/lib/nostr/types";

jest.mock("nostr-tools/pure", () => ({
  finalizeEvent: jest.fn().mockReturnValue({ id: "test-id", sig: "test-sig", pubkey: "test-pk", kind: 30001, tags: [], content: "", created_at: 0 }),
}));

jest.mock("nostr-tools/pool", () => ({
  SimplePool: jest.fn().mockImplementation(() => ({
    publish: jest.fn().mockReturnValue([Promise.resolve()]),
    querySync: jest.fn().mockResolvedValue([]),
    destroy: jest.fn(),
  })),
}));

jest.mock("@/lib/nostr/publish", () => ({
  publishAndPartition: jest.fn().mockResolvedValue({ published: ["wss://relay.test"], failed: [] }),
}));

describe("parseCurationListEvent", () => {
  it("parses valid aegis group event", () => {
    const result = parseCurationListEvent({
      kind: KIND_CATEGORIZED_LIST,
      pubkey: "owner123",
      created_at: 1700000000,
      tags: [
        ["d", "aegis-group-abc"],
        ["name", "AI Research"],
        ["description", "Articles about AI"],
        ["p", "member1"],
        ["p", "member2"],
        ["t", "ai"],
        ["t", "ml"],
      ],
      content: "",
    });
    expect(result).not.toBeNull();
    expect(result!.dTag).toBe("aegis-group-abc");
    expect(result!.name).toBe("AI Research");
    expect(result!.description).toBe("Articles about AI");
    expect(result!.members).toEqual(["member1", "member2"]);
    expect(result!.topics).toEqual(["ai", "ml"]);
    expect(result!.ownerPk).toBe("owner123");
  });

  it("rejects event with wrong kind", () => {
    const result = parseCurationListEvent({
      kind: 1,
      pubkey: "owner",
      created_at: 1700000000,
      tags: [["d", "aegis-group-abc"]],
      content: "",
    });
    expect(result).toBeNull();
  });

  it("rejects event without aegis-group prefix", () => {
    const result = parseCurationListEvent({
      kind: KIND_CATEGORIZED_LIST,
      pubkey: "owner",
      created_at: 1700000000,
      tags: [["d", "some-other-list"]],
      content: "",
    });
    expect(result).toBeNull();
  });

  it("rejects event without d-tag", () => {
    const result = parseCurationListEvent({
      kind: KIND_CATEGORIZED_LIST,
      pubkey: "owner",
      created_at: 1700000000,
      tags: [["name", "Test"]],
      content: "",
    });
    expect(result).toBeNull();
  });

  it("handles missing name and description gracefully", () => {
    const result = parseCurationListEvent({
      kind: KIND_CATEGORIZED_LIST,
      pubkey: "owner",
      created_at: 1700000000,
      tags: [["d", "aegis-group-abc"]],
      content: "",
    });
    expect(result).not.toBeNull();
    expect(result!.name).toBe("");
    expect(result!.description).toBe("");
    expect(result!.members).toEqual([]);
    expect(result!.topics).toEqual([]);
  });

  it("handles empty p-tag values by filtering them", () => {
    const result = parseCurationListEvent({
      kind: KIND_CATEGORIZED_LIST,
      pubkey: "owner",
      created_at: 1700000000,
      tags: [
        ["d", "aegis-group-abc"],
        ["p", "member1"],
        ["p", ""],
        ["p", "member2"],
      ],
      content: "",
    });
    expect(result!.members).toEqual(["member1", "member2"]);
  });

  it("converts created_at to milliseconds", () => {
    const result = parseCurationListEvent({
      kind: KIND_CATEGORIZED_LIST,
      pubkey: "owner",
      created_at: 1700000000,
      tags: [["d", "aegis-group-abc"]],
      content: "",
    });
    expect(result!.createdAt).toBe(1700000000000);
  });
});
