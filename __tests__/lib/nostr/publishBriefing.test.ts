import { naddrEncode, decode } from "nostr-tools/nip19";
import type { AddressPointer } from "nostr-tools/nip19";
import { KIND_LONG_FORM, DEFAULT_RELAYS } from "@/lib/nostr/types";
import { serializeBriefing } from "@/lib/briefing/serialize";
import type { BriefingState } from "@/lib/briefing/types";
import type { ContentItem } from "@/lib/types/content";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "pub-item-1",
    owner: "owner-1",
    author: "Author",
    text: "Test briefing content.",
    source: "manual",
    scores: { originality: 7, insight: 8, credibility: 7, composite: 7.3 },
    verdict: "quality",
    reason: "Solid analysis",
    createdAt: 1700000000000,
    validated: false,
    flagged: false,
    timestamp: "2h ago",
    topics: ["nostr", "ic"],
    ...overrides,
  };
}

function makeBriefing(): BriefingState {
  return {
    priority: [
      { item: makeItem(), briefingScore: 8.5, isSerendipity: false },
    ],
    serendipity: null,
    filteredOut: [],
    totalItems: 10,
    generatedAt: 1700000000000,
  };
}

describe("publishBriefing naddr encoding", () => {
  it("encodes a valid naddr for Kind 30023", () => {
    const briefing = makeBriefing();
    const serialized = serializeBriefing(briefing);

    const addr: AddressPointer = {
      identifier: serialized.identifier,
      pubkey: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      kind: KIND_LONG_FORM,
      relays: DEFAULT_RELAYS.slice(0, 2),
    };

    const naddr = naddrEncode(addr);
    expect(naddr).toMatch(/^naddr1/);

    // Decode and verify
    const decoded = decode(naddr);
    expect(decoded.type).toBe("naddr");
    const data = decoded.data as AddressPointer;
    expect(data.kind).toBe(30023);
    expect(data.identifier).toBe(serialized.identifier);
  });

  it("serialized tags include correct structure for NIP-23", () => {
    const briefing = makeBriefing();
    const serialized = serializeBriefing(briefing);

    // Required NIP-23 tags
    const tagKeys = serialized.tags.map((t) => t[0]);
    expect(tagKeys).toContain("d");
    expect(tagKeys).toContain("title");
    expect(tagKeys).toContain("summary");
    expect(tagKeys).toContain("published_at");
    expect(tagKeys).toContain("client");
    expect(tagKeys).toContain("t");
  });

  it("KIND_LONG_FORM constant is 30023", () => {
    expect(KIND_LONG_FORM).toBe(30023);
  });

  it("DEFAULT_RELAYS contains valid wss URLs", () => {
    expect(DEFAULT_RELAYS.length).toBeGreaterThan(0);
    for (const relay of DEFAULT_RELAYS) {
      expect(relay).toMatch(/^wss:\/\//);
    }
  });
});
