import { adaptiveHalfLife } from "@/lib/briefing/ranker";
import { generateBriefing } from "@/lib/briefing/ranker";
import { createEmptyProfile } from "@/lib/preferences/types";
import type { ActivityHistogram } from "@/lib/preferences/types";
import type { ContentItem } from "@/lib/types/content";

function makeHistogram(overrides: Partial<ActivityHistogram> = {}): ActivityHistogram {
  return {
    hourCounts: new Array(24).fill(0),
    lastActivityAt: Date.now() - 2 * 3600000, // 2h ago by default
    totalEvents: 20,
    ...overrides,
  };
}

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: `item-${Math.random().toString(36).slice(2)}`,
    owner: "test",
    author: "Author",
    avatar: "A",
    text: "Test content",
    source: "rss",
    scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
    verdict: "quality",
    reason: "Test",
    createdAt: Date.now() - 7 * 3600000, // 7h ago
    validated: false,
    flagged: false,
    timestamp: "7h ago",
    ...overrides,
  };
}

describe("adaptiveHalfLife", () => {
  it("returns 7 when histogram is undefined", () => {
    expect(adaptiveHalfLife(undefined, Date.now())).toBe(7);
  });

  it("returns 7 when totalEvents < 10", () => {
    const hist = makeHistogram({ totalEvents: 5 });
    expect(adaptiveHalfLife(hist, Date.now())).toBe(7);
  });

  it("returns 7 when gap is under 4 hours", () => {
    const now = Date.now();
    const hist = makeHistogram({ lastActivityAt: now - 2 * 3600000 }); // 2h ago
    expect(adaptiveHalfLife(hist, now)).toBe(7);
  });

  it("returns 7 at exactly 0 gap", () => {
    const now = Date.now();
    const hist = makeHistogram({ lastActivityAt: now });
    expect(adaptiveHalfLife(hist, now)).toBe(7);
  });

  it("starts increasing at 4h gap", () => {
    const now = Date.now();
    const hist = makeHistogram({ lastActivityAt: now - 4 * 3600000 }); // exactly 4h
    const hl = adaptiveHalfLife(hist, now);
    expect(hl).toBeGreaterThan(7);
    expect(hl).toBeLessThan(24);
  });

  it("returns ~15.5 at 4h gap", () => {
    const now = Date.now();
    const hist = makeHistogram({ lastActivityAt: now - 4 * 3600000 });
    const hl = adaptiveHalfLife(hist, now);
    // gapFactor = 4/8 = 0.5, halfLife = 7 + (24-7)*0.5 = 15.5
    expect(hl).toBeCloseTo(15.5, 1);
  });

  it("returns 24 at 8h+ gap", () => {
    const now = Date.now();
    const hist = makeHistogram({ lastActivityAt: now - 8 * 3600000 });
    expect(adaptiveHalfLife(hist, now)).toBe(24);
  });

  it("clamps at 24 for very large gaps", () => {
    const now = Date.now();
    const hist = makeHistogram({ lastActivityAt: now - 100 * 3600000 });
    expect(adaptiveHalfLife(hist, now)).toBe(24);
  });

  it("returns increasing values as gap grows", () => {
    const now = Date.now();
    const hl4 = adaptiveHalfLife(makeHistogram({ lastActivityAt: now - 4 * 3600000 }), now);
    const hl6 = adaptiveHalfLife(makeHistogram({ lastActivityAt: now - 6 * 3600000 }), now);
    const hl8 = adaptiveHalfLife(makeHistogram({ lastActivityAt: now - 8 * 3600000 }), now);
    expect(hl6).toBeGreaterThan(hl4);
    expect(hl8).toBeGreaterThan(hl6);
  });

  it("exactly 10 events is enough data", () => {
    const now = Date.now();
    const hist = makeHistogram({ totalEvents: 10, lastActivityAt: now - 8 * 3600000 });
    expect(adaptiveHalfLife(hist, now)).toBe(24);
  });

  it("9 events falls back to default", () => {
    const now = Date.now();
    const hist = makeHistogram({ totalEvents: 9, lastActivityAt: now - 8 * 3600000 });
    expect(adaptiveHalfLife(hist, now)).toBe(7);
  });
});

describe("briefingScore with adaptive half-life", () => {
  it("scores older content higher in catchup mode", () => {
    const now = Date.now();
    const item = makeItem({ createdAt: now - 7 * 3600000, topics: ["test"] }); // 7h old

    // Normal mode: user was active 1h ago
    const normalPrefs = createEmptyProfile("user1");
    normalPrefs.activityHistogram = makeHistogram({ lastActivityAt: now - 1 * 3600000 });

    // Catchup mode: user was last active 10h ago
    const catchupPrefs = createEmptyProfile("user2");
    catchupPrefs.activityHistogram = makeHistogram({ lastActivityAt: now - 10 * 3600000 });

    // Use generateBriefing to compare scores (briefingScore is private)
    const normalBriefing = generateBriefing([item], normalPrefs, now);
    const catchupBriefing = generateBriefing([item], catchupPrefs, now);

    // In catchup mode, the 7h-old item should score higher
    const normalScore = normalBriefing.priority[0]?.briefingScore ?? 0;
    const catchupScore = catchupBriefing.priority[0]?.briefingScore ?? 0;
    expect(catchupScore).toBeGreaterThan(normalScore);
  });

  it("treats recent content similarly in both modes", () => {
    const now = Date.now();
    const item = makeItem({ createdAt: now - 0.5 * 3600000, topics: ["test"] }); // 30min old

    const normalPrefs = createEmptyProfile("user1");
    normalPrefs.activityHistogram = makeHistogram({ lastActivityAt: now - 1 * 3600000 });

    const catchupPrefs = createEmptyProfile("user2");
    catchupPrefs.activityHistogram = makeHistogram({ lastActivityAt: now - 10 * 3600000 });

    const normalBriefing = generateBriefing([item], normalPrefs, now);
    const catchupBriefing = generateBriefing([item], catchupPrefs, now);

    const normalScore = normalBriefing.priority[0]?.briefingScore ?? 0;
    const catchupScore = catchupBriefing.priority[0]?.briefingScore ?? 0;
    // Both should be high for recent content, within ~20%
    expect(catchupScore / normalScore).toBeGreaterThan(0.8);
    expect(catchupScore / normalScore).toBeLessThan(1.2);
  });

  it("falls back to normal half-life without histogram", () => {
    const now = Date.now();
    const item = makeItem({ createdAt: now - 7 * 3600000, topics: ["test"] }); // 7h old

    const prefsNoHist = createEmptyProfile("user1");
    const prefsActive = createEmptyProfile("user2");
    prefsActive.activityHistogram = makeHistogram({ lastActivityAt: now - 1 * 3600000 });

    const noHistBriefing = generateBriefing([item], prefsNoHist, now);
    const activeBriefing = generateBriefing([item], prefsActive, now);

    const noHistScore = noHistBriefing.priority[0]?.briefingScore ?? 0;
    const activeScore = activeBriefing.priority[0]?.briefingScore ?? 0;
    // Without histogram → same 7h half-life as active user
    expect(noHistScore).toBeCloseTo(activeScore, 1);
  });
});
