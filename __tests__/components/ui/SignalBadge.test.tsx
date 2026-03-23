import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SignalBadge, deriveSignalTypes } from "@/components/ui/SignalBadge";
import type { SignalType } from "@/components/ui/SignalBadge";
import type { ContentItem } from "@/lib/types/content";

const wrap = (el: React.ReactElement) => renderToStaticMarkup(el);

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "t1", owner: "o1", author: "a1", avatar: "A", text: "txt", source: "rss",
    scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
    verdict: "quality", reason: "", createdAt: Date.now(),
    validated: false, flagged: false, timestamp: "now",
    ...overrides,
  };
}

describe("SignalBadge", () => {
  const ALL_TYPES: SignalType[] = [
    "high-signal", "rich-context", "low-noise", "high-slop",
    "original", "insightful", "credible", "low-credibility", "derivative",
  ];

  it.each(ALL_TYPES)("renders %s badge without error", (type) => {
    const html = wrap(<SignalBadge type={type} />);
    expect(html).toContain("aria-label");
    expect(html).toContain("<svg");
  });

  it.each(ALL_TYPES)("renders %s badge with label when showLabel=true", (type) => {
    const html = wrap(<SignalBadge type={type} showLabel />);
    // Should contain the short label text in a <span>
    expect(html.match(/<span[^>]*tracking-wide[^>]*>[^<]+<\/span>/)).toBeTruthy();
  });

  it("hides label text by default (showLabel=false)", () => {
    const html = wrap(<SignalBadge type="high-signal" />);
    expect(html).not.toContain("tracking-wide");
  });

  it("contains tooltip text in aria-label", () => {
    const html = wrap(<SignalBadge type="high-signal" />);
    expect(html).toContain("High signal");
    expect(html).toContain("strong originality");
  });

  it("applies correct color for high-signal (purple)", () => {
    const html = wrap(<SignalBadge type="high-signal" />);
    expect(html).toContain("#a78bfa");
  });

  it("applies correct color for low-noise (green)", () => {
    const html = wrap(<SignalBadge type="low-noise" />);
    expect(html).toContain("#34d399");
  });

  it("applies correct color for derivative (orange)", () => {
    const html = wrap(<SignalBadge type="derivative" />);
    expect(html).toContain("#fb923c");
  });

  it("uses SlopRiskIcon for both high-slop and low-credibility", () => {
    const highSlop = wrap(<SignalBadge type="high-slop" />);
    const lowCred = wrap(<SignalBadge type="low-credibility" />);
    // Both should contain alert triangle SVG path
    expect(highSlop).toContain("M10.29 3.86");
    expect(lowCred).toContain("M10.29 3.86");
  });
});

describe("deriveSignalTypes", () => {
  describe("VCL branch (vSignal/cContext/lSlop present)", () => {
    it("returns high-signal when vSignal >= 7", () => {
      const types = deriveSignalTypes(makeItem({ vSignal: 7, cContext: 3, lSlop: 4 }));
      expect(types).toContain("high-signal");
    });

    it("does not return high-signal when vSignal < 7", () => {
      const types = deriveSignalTypes(makeItem({ vSignal: 6.9, cContext: 3, lSlop: 4 }));
      expect(types).not.toContain("high-signal");
    });

    it("returns rich-context when cContext >= 7", () => {
      const types = deriveSignalTypes(makeItem({ vSignal: 3, cContext: 7, lSlop: 4 }));
      expect(types).toContain("rich-context");
    });

    it("returns high-slop when lSlop >= 7", () => {
      const types = deriveSignalTypes(makeItem({ vSignal: 3, cContext: 3, lSlop: 7 }));
      expect(types).toContain("high-slop");
    });

    it("returns low-noise when lSlop <= 2", () => {
      const types = deriveSignalTypes(makeItem({ vSignal: 3, cContext: 3, lSlop: 2 }));
      expect(types).toContain("low-noise");
    });

    it("does not return low-noise when lSlop = 2.1", () => {
      const types = deriveSignalTypes(makeItem({ vSignal: 3, cContext: 3, lSlop: 2.1 }));
      expect(types).not.toContain("low-noise");
    });

    it("returns multiple types when multiple conditions met", () => {
      const types = deriveSignalTypes(makeItem({ vSignal: 9, cContext: 8, lSlop: 1 }));
      expect(types).toContain("high-signal");
      expect(types).toContain("rich-context");
      expect(types).toContain("low-noise");
    });

    it("limits to 3 max", () => {
      // vSignal 9 → high-signal, cContext 8 → rich-context, lSlop 1 → low-noise = 3 (all fit)
      const types = deriveSignalTypes(makeItem({ vSignal: 9, cContext: 8, lSlop: 1 }));
      expect(types.length).toBeLessThanOrEqual(3);
    });

    it("returns empty for mid-range values", () => {
      const types = deriveSignalTypes(makeItem({ vSignal: 5, cContext: 5, lSlop: 5 }));
      expect(types).toHaveLength(0);
    });

    it("does not return both high-slop and low-noise (mutually exclusive in practice)", () => {
      // lSlop can't be both >= 7 and <= 2
      const types = deriveSignalTypes(makeItem({ vSignal: 5, cContext: 5, lSlop: 5 }));
      const hasHighSlop = types.includes("high-slop");
      const hasLowNoise = types.includes("low-noise");
      expect(hasHighSlop && hasLowNoise).toBe(false);
    });

    it("boundary: vSignal exactly 7 qualifies", () => {
      const types = deriveSignalTypes(makeItem({ vSignal: 7, cContext: 5, lSlop: 5 }));
      expect(types).toContain("high-signal");
    });

    it("boundary: lSlop exactly 2 qualifies for low-noise", () => {
      const types = deriveSignalTypes(makeItem({ vSignal: 5, cContext: 5, lSlop: 2 }));
      expect(types).toContain("low-noise");
    });

    it("boundary: lSlop exactly 7 qualifies for high-slop", () => {
      const types = deriveSignalTypes(makeItem({ vSignal: 5, cContext: 5, lSlop: 7 }));
      expect(types).toContain("high-slop");
    });
  });

  describe("legacy branch (no VCL fields)", () => {
    it("returns original when originality >= 8", () => {
      const types = deriveSignalTypes(makeItem({
        scores: { originality: 8, insight: 5, credibility: 5, composite: 6 },
      }));
      expect(types).toContain("original");
    });

    it("does not return original when originality = 7.9", () => {
      const types = deriveSignalTypes(makeItem({
        scores: { originality: 7.9, insight: 5, credibility: 5, composite: 6 },
      }));
      expect(types).not.toContain("original");
    });

    it("returns insightful when insight >= 8", () => {
      const types = deriveSignalTypes(makeItem({
        scores: { originality: 5, insight: 8, credibility: 5, composite: 6 },
      }));
      expect(types).toContain("insightful");
    });

    it("returns credible when credibility >= 8", () => {
      const types = deriveSignalTypes(makeItem({
        scores: { originality: 5, insight: 5, credibility: 8, composite: 6 },
      }));
      expect(types).toContain("credible");
    });

    it("returns low-credibility when credibility <= 3", () => {
      const types = deriveSignalTypes(makeItem({
        scores: { originality: 5, insight: 5, credibility: 3, composite: 4 },
      }));
      expect(types).toContain("low-credibility");
    });

    it("returns derivative when originality <= 2", () => {
      const types = deriveSignalTypes(makeItem({
        scores: { originality: 2, insight: 5, credibility: 5, composite: 4 },
      }));
      expect(types).toContain("derivative");
    });

    it("limits to 3 max", () => {
      const types = deriveSignalTypes(makeItem({
        scores: { originality: 9, insight: 9, credibility: 9, composite: 9 },
      }));
      expect(types.length).toBeLessThanOrEqual(3);
    });

    it("returns empty for mid-range", () => {
      const types = deriveSignalTypes(makeItem({
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
      }));
      expect(types).toHaveLength(0);
    });

    it("never returns VCL types in legacy branch", () => {
      const types = deriveSignalTypes(makeItem({
        scores: { originality: 9, insight: 9, credibility: 1, composite: 6 },
      }));
      expect(types).not.toContain("high-signal");
      expect(types).not.toContain("rich-context");
      expect(types).not.toContain("low-noise");
      expect(types).not.toContain("high-slop");
    });
  });

  describe("VCL detection", () => {
    it("uses VCL branch when all 3 fields present", () => {
      const types = deriveSignalTypes(makeItem({ vSignal: 9, cContext: 3, lSlop: 3 }));
      expect(types).toContain("high-signal");
    });

    it("uses legacy branch when vSignal is missing", () => {
      const types = deriveSignalTypes(makeItem({
        cContext: 9, lSlop: 1,
        scores: { originality: 9, insight: 5, credibility: 5, composite: 6 },
      }));
      expect(types).toContain("original");
      expect(types).not.toContain("rich-context");
    });

    it("uses legacy branch when cContext is missing", () => {
      const types = deriveSignalTypes(makeItem({
        vSignal: 9, lSlop: 1,
        scores: { originality: 9, insight: 5, credibility: 5, composite: 6 },
      }));
      expect(types).toContain("original");
      expect(types).not.toContain("high-signal");
    });

    it("uses legacy branch when lSlop is missing", () => {
      const types = deriveSignalTypes(makeItem({
        vSignal: 9, cContext: 9,
        scores: { originality: 9, insight: 5, credibility: 5, composite: 6 },
      }));
      expect(types).toContain("original");
    });
  });
});
