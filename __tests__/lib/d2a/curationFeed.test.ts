import { buildGroupFeed } from "@/lib/d2a/curationFeed";
import type { CurationGroup } from "@/lib/d2a/curationGroup";
import type { ContentItem } from "@/lib/types/content";

function makeGroup(overrides: Partial<CurationGroup> = {}): CurationGroup {
  return {
    id: "g1",
    dTag: "aegis-group-g1",
    name: "Test",
    description: "",
    topics: [],
    members: ["member1", "member2"],
    ownerPk: "member1",
    createdAt: Date.now(),
    lastSynced: 0,
    ...overrides,
  };
}

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "item-" + Math.random().toString(36).slice(2, 8),
    owner: "user1",
    author: "author1",
    avatar: "",
    text: "test content",
    source: "nostr" as const,
    scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
    verdict: "quality" as const,
    reason: "Received via D2A from member10",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: new Date().toISOString(),
    nostrPubkey: "member1",
    topics: ["bitcoin"],
    ...overrides,
  };
}

describe("buildGroupFeed", () => {
  it("includes D2A content from group members", () => {
    const group = makeGroup({ members: ["member1", "member2"] });
    const content = [
      makeItem({ nostrPubkey: "member1", reason: "Received via D2A from member10" }),
      makeItem({ nostrPubkey: "member2", reason: "Received via D2A from member20" }),
    ];
    const feed = buildGroupFeed(group, content);
    expect(feed).toHaveLength(2);
  });

  it("excludes content from non-members", () => {
    const group = makeGroup({ members: ["member1"] });
    const content = [
      makeItem({ nostrPubkey: "member1", reason: "Received via D2A from member10" }),
      makeItem({ nostrPubkey: "outsider", reason: "Received via D2A from outsider0" }),
    ];
    const feed = buildGroupFeed(group, content);
    expect(feed).toHaveLength(1);
  });

  it("excludes non-D2A content", () => {
    const group = makeGroup({ members: ["member1"] });
    const content = [
      makeItem({ nostrPubkey: "member1", reason: "Received via D2A from member10" }),
      makeItem({ nostrPubkey: "member1", reason: "RSS feed" }),
    ];
    const feed = buildGroupFeed(group, content);
    expect(feed).toHaveLength(1);
  });

  it("only includes quality verdict", () => {
    const group = makeGroup({ members: ["member1"] });
    const content = [
      makeItem({ nostrPubkey: "member1", verdict: "quality", reason: "Received via D2A from member10" }),
      makeItem({ nostrPubkey: "member1", verdict: "slop", reason: "Received via D2A from member10" }),
    ];
    const feed = buildGroupFeed(group, content);
    expect(feed).toHaveLength(1);
    expect(feed[0].verdict).toBe("quality");
  });

  it("applies topic filter when topics are set", () => {
    const group = makeGroup({ members: ["member1"], topics: ["bitcoin"] });
    const content = [
      makeItem({ nostrPubkey: "member1", topics: ["bitcoin", "defi"], reason: "Received via D2A from member10" }),
      makeItem({ nostrPubkey: "member1", topics: ["ethereum"], reason: "Received via D2A from member10" }),
    ];
    const feed = buildGroupFeed(group, content);
    expect(feed).toHaveLength(1);
    expect(feed[0].topics).toContain("bitcoin");
  });

  it("includes all topics when group has no topic filter", () => {
    const group = makeGroup({ members: ["member1"], topics: [] });
    const content = [
      makeItem({ nostrPubkey: "member1", topics: ["bitcoin"], reason: "Received via D2A from member10" }),
      makeItem({ nostrPubkey: "member1", topics: ["ethereum"], reason: "Received via D2A from member10" }),
    ];
    const feed = buildGroupFeed(group, content);
    expect(feed).toHaveLength(2);
  });

  it("sorts by createdAt descending", () => {
    const group = makeGroup({ members: ["member1"] });
    const content = [
      makeItem({ nostrPubkey: "member1", createdAt: 1000, reason: "Received via D2A from member10" }),
      makeItem({ nostrPubkey: "member1", createdAt: 3000, reason: "Received via D2A from member10" }),
      makeItem({ nostrPubkey: "member1", createdAt: 2000, reason: "Received via D2A from member10" }),
    ];
    const feed = buildGroupFeed(group, content);
    expect(feed[0].createdAt).toBe(3000);
    expect(feed[1].createdAt).toBe(2000);
    expect(feed[2].createdAt).toBe(1000);
  });

  it("limits to 50 items", () => {
    const group = makeGroup({ members: ["member1"] });
    const content = Array.from({ length: 60 }, (_, i) =>
      makeItem({ nostrPubkey: "member1", createdAt: i, reason: "Received via D2A from member10" })
    );
    const feed = buildGroupFeed(group, content);
    expect(feed).toHaveLength(50);
  });

  it("returns empty array for empty group", () => {
    const group = makeGroup({ members: [] });
    const content = [makeItem({ reason: "Received via D2A from member10" })];
    const feed = buildGroupFeed(group, content);
    expect(feed).toHaveLength(0);
  });

  it("returns empty for empty content", () => {
    const group = makeGroup();
    const feed = buildGroupFeed(group, []);
    expect(feed).toHaveLength(0);
  });

  it("excludes items with no nostrPubkey", () => {
    const group = makeGroup({ members: ["member1"] });
    const content = [
      makeItem({ nostrPubkey: undefined, reason: "Received via D2A from member10" }),
    ];
    const feed = buildGroupFeed(group, content);
    expect(feed).toHaveLength(0);
  });
});
