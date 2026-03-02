import { isD2AContent } from "@/lib/d2a/activity";
import type { ContentItem } from "@/lib/types/content";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "test-1",
    owner: "owner",
    author: "Author",
    avatar: "",
    text: "Test content",
    source: "nostr",
    scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
    verdict: "quality",
    reason: "",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "just now",
    ...overrides,
  };
}

describe("isD2AContent", () => {
  it("returns true for D2A reason string", () => {
    expect(isD2AContent(makeItem({ reason: "Received via D2A from abc12345..." }))).toBe(true);
  });

  it("returns false for empty reason", () => {
    expect(isD2AContent(makeItem({ reason: "" }))).toBe(false);
  });

  it("returns false for undefined reason", () => {
    expect(isD2AContent(makeItem({ reason: undefined }))).toBe(false);
  });

  it("returns false for non-D2A reason", () => {
    expect(isD2AContent(makeItem({ reason: "Heuristic: short text" }))).toBe(false);
  });

  it("returns false for partial D2A prefix", () => {
    expect(isD2AContent(makeItem({ reason: "Received via D2A" }))).toBe(false);
  });

  it("returns false for case mismatch", () => {
    expect(isD2AContent(makeItem({ reason: "received via d2a from abc" }))).toBe(false);
  });

  it("returns true with full pubkey in reason", () => {
    const pk = "a".repeat(64);
    expect(isD2AContent(makeItem({ reason: `Received via D2A from ${pk}` }))).toBe(true);
  });

  it("returns true with truncated pubkey in reason", () => {
    expect(isD2AContent(makeItem({ reason: "Received via D2A from abc12345" }))).toBe(true);
  });

  it("returns false for reason that contains D2A but doesn't start with it", () => {
    expect(isD2AContent(makeItem({ reason: "Content Received via D2A from abc" }))).toBe(false);
  });
});

