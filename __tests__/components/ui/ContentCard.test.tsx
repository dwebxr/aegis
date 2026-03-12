import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContentCard, deriveScoreTags, ScoreGrid, TopicTags } from "@/components/ui/ContentCard";
import type { ContentItem } from "@/lib/types/content";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "test-id",
    owner: "test-owner",
    author: "test-author",
    avatar: "\uD83E\uDDEA",
    text: "Test content",
    source: "nostr",
    scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
    verdict: "quality",
    reason: "Good content",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "just now",
    ...overrides,
  };
}

describe("deriveScoreTags", () => {
  describe("with VCL fields", () => {
    it("returns 'High signal' when vSignal >= 7", () => {
      const tags = deriveScoreTags(makeItem({ vSignal: 7, cContext: 3, lSlop: 3 }));
      expect(tags.some(t => t.label === "High signal")).toBe(true);
    });

    it("returns 'Rich context' when cContext >= 7", () => {
      const tags = deriveScoreTags(makeItem({ vSignal: 3, cContext: 7, lSlop: 3 }));
      expect(tags.some(t => t.label === "Rich context")).toBe(true);
    });

    it("returns 'High slop risk' when lSlop >= 7", () => {
      const tags = deriveScoreTags(makeItem({ vSignal: 3, cContext: 3, lSlop: 7 }));
      expect(tags.some(t => t.label === "High slop risk")).toBe(true);
    });

    it("returns 'Low noise' when lSlop <= 2", () => {
      const tags = deriveScoreTags(makeItem({ vSignal: 3, cContext: 3, lSlop: 2 }));
      expect(tags.some(t => t.label === "Low noise")).toBe(true);
    });

    it("limits output to 2 tags max", () => {
      // All conditions met: High signal + Rich context + Low noise = 3 potential tags
      const tags = deriveScoreTags(makeItem({ vSignal: 9, cContext: 9, lSlop: 1 }));
      expect(tags.length).toBeLessThanOrEqual(2);
    });

    it("returns empty when all VCL values are mid-range", () => {
      const tags = deriveScoreTags(makeItem({ vSignal: 5, cContext: 5, lSlop: 5 }));
      expect(tags).toHaveLength(0);
    });

    it("returns empty at just below thresholds", () => {
      const tags = deriveScoreTags(makeItem({ vSignal: 6, cContext: 6, lSlop: 3 }));
      expect(tags).toHaveLength(0);
    });
  });

  describe("with legacy scores (no VCL fields)", () => {
    it("returns 'Original' when originality >= 8", () => {
      const tags = deriveScoreTags(makeItem({
        scores: { originality: 8, insight: 5, credibility: 5, composite: 6 },
      }));
      expect(tags.some(t => t.label === "Original")).toBe(true);
    });

    it("returns 'Insightful' when insight >= 8", () => {
      const tags = deriveScoreTags(makeItem({
        scores: { originality: 5, insight: 8, credibility: 5, composite: 6 },
      }));
      expect(tags.some(t => t.label === "Insightful")).toBe(true);
    });

    it("returns 'Credible' when credibility >= 8", () => {
      const tags = deriveScoreTags(makeItem({
        scores: { originality: 5, insight: 5, credibility: 8, composite: 6 },
      }));
      expect(tags.some(t => t.label === "Credible")).toBe(true);
    });

    it("returns 'Low credibility' when credibility <= 3", () => {
      const tags = deriveScoreTags(makeItem({
        scores: { originality: 5, insight: 5, credibility: 3, composite: 4 },
      }));
      expect(tags.some(t => t.label === "Low credibility")).toBe(true);
    });

    it("returns 'Derivative' when originality <= 2", () => {
      const tags = deriveScoreTags(makeItem({
        scores: { originality: 2, insight: 5, credibility: 5, composite: 4 },
      }));
      expect(tags.some(t => t.label === "Derivative")).toBe(true);
    });

    it("limits output to 2 tags max (legacy)", () => {
      // Original + Insightful + Credible = 3 potential tags
      const tags = deriveScoreTags(makeItem({
        scores: { originality: 9, insight: 9, credibility: 9, composite: 9 },
      }));
      expect(tags.length).toBeLessThanOrEqual(2);
    });

    it("returns empty for mid-range legacy scores", () => {
      const tags = deriveScoreTags(makeItem({
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
      }));
      expect(tags).toHaveLength(0);
    });
  });

  describe("VCL detection (hasVCL)", () => {
    it("uses VCL branch when all 3 fields are present", () => {
      // With VCL: vSignal=9 triggers "High signal", not "Original"
      const tags = deriveScoreTags(makeItem({
        vSignal: 9, cContext: 3, lSlop: 5,
        scores: { originality: 9, insight: 9, credibility: 9, composite: 9 },
      }));
      expect(tags.some(t => t.label === "High signal")).toBe(true);
      expect(tags.some(t => t.label === "Original")).toBe(false);
    });

    it("uses legacy branch when vSignal is missing", () => {
      const tags = deriveScoreTags(makeItem({
        cContext: 9, lSlop: 1,
        scores: { originality: 9, insight: 5, credibility: 5, composite: 7 },
      }));
      // Missing vSignal → legacy path → "Original"
      expect(tags.some(t => t.label === "Original")).toBe(true);
      expect(tags.some(t => t.label === "Low noise")).toBe(false);
    });

    it("uses legacy branch when cContext is missing", () => {
      const tags = deriveScoreTags(makeItem({
        vSignal: 9, lSlop: 1,
        scores: { originality: 9, insight: 5, credibility: 5, composite: 7 },
      }));
      expect(tags.some(t => t.label === "Original")).toBe(true);
    });

    it("uses legacy branch when lSlop is missing", () => {
      const tags = deriveScoreTags(makeItem({
        vSignal: 9, cContext: 9,
        scores: { originality: 9, insight: 5, credibility: 5, composite: 7 },
      }));
      expect(tags.some(t => t.label === "Original")).toBe(true);
    });
  });
});

describe("ScoreGrid", () => {
  it("renders VCL labels when all VCL fields are present", () => {
    const item = makeItem({ vSignal: 7, cContext: 6, lSlop: 2 });
    const html = renderToStaticMarkup(<ScoreGrid item={item} />);
    expect(html).toContain("V Signal");
    expect(html).toContain("C Context");
    expect(html).toContain("L Slop");
    expect(html).not.toContain("Originality");
  });

  it("renders legacy labels when VCL fields are missing", () => {
    const item = makeItem();
    const html = renderToStaticMarkup(<ScoreGrid item={item} />);
    expect(html).toContain("Originality");
    expect(html).toContain("Insight");
    expect(html).toContain("Credibility");
    expect(html).not.toContain("V Signal");
  });
});

describe("TopicTags", () => {
  it("renders topic tags", () => {
    const html = renderToStaticMarkup(<TopicTags topics={["ai", "crypto"]} />);
    expect(html).toContain("ai");
    expect(html).toContain("crypto");
  });

  it("returns null for empty topics", () => {
    const html = renderToStaticMarkup(<TopicTags topics={[]} />);
    expect(html).toBe("");
  });

  it("renders single topic", () => {
    const html = renderToStaticMarkup(<TopicTags topics={["defi"]} />);
    expect(html).toContain("defi");
  });

  it("limits visible topics to max prop and shows overflow", () => {
    const html = renderToStaticMarkup(<TopicTags topics={["a", "b", "c", "d", "e"]} max={3} />);
    expect(html).toContain("a");
    expect(html).toContain("b");
    expect(html).toContain("c");
    expect(html).not.toContain(">d<");
    expect(html).not.toContain(">e<");
    expect(html).toContain("+2");
  });

  it("shows no overflow indicator when topics within max", () => {
    const html = renderToStaticMarkup(<TopicTags topics={["a", "b"]} max={3} />);
    expect(html).toContain("a");
    expect(html).toContain("b");
    expect(html).not.toContain("+");
  });

  it("uses default max of 3", () => {
    const html = renderToStaticMarkup(<TopicTags topics={["a", "b", "c", "d"]} />);
    expect(html).toContain("+1");
  });
});

describe("ContentCard — data-source-url attribute", () => {
  it("sets data-source-url for http sourceUrl", () => {
    const item = makeItem({ sourceUrl: "https://example.com/article" });
    const html = renderToStaticMarkup(
      <ContentCard item={item} expanded={false} onToggle={jest.fn()} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain('data-source-url="https://example.com/article"');
  });

  it("omits data-source-url for nostr: URLs", () => {
    const item = makeItem({ sourceUrl: "nostr:nevent1abc123" });
    const html = renderToStaticMarkup(
      <ContentCard item={item} expanded={false} onToggle={jest.fn()} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).not.toContain("data-source-url");
  });

  it("omits data-source-url when sourceUrl is undefined", () => {
    const item = makeItem({ sourceUrl: undefined });
    const html = renderToStaticMarkup(
      <ContentCard item={item} expanded={false} onToggle={jest.fn()} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).not.toContain("data-source-url");
  });

  it("renders focus outline when focused prop is true", () => {
    const item = makeItem();
    const html = renderToStaticMarkup(
      <ContentCard item={item} expanded={false} onToggle={jest.fn()} onValidate={jest.fn()} onFlag={jest.fn()} focused />
    );
    expect(html).toContain("outline-2 outline-cyan-400");
  });

  it("has role=button and tabIndex=0 on card root", () => {
    const item = makeItem();
    const html = renderToStaticMarkup(
      <ContentCard item={item} expanded={false} onToggle={jest.fn()} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
  });

  it("sets aria-expanded=true when expanded", () => {
    const item = makeItem();
    const html = renderToStaticMarkup(
      <ContentCard item={item} expanded={true} onToggle={jest.fn()} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain('aria-expanded="true"');
  });

  it("sets aria-expanded=false when collapsed", () => {
    const item = makeItem();
    const html = renderToStaticMarkup(
      <ContentCard item={item} expanded={false} onToggle={jest.fn()} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain('aria-expanded="false"');
  });

  it("has aria-label on validate and flag buttons when expanded", () => {
    const item = makeItem();
    const html = renderToStaticMarkup(
      <ContentCard item={item} expanded={true} onToggle={jest.fn()} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain('aria-label="Validate content"');
    expect(html).toContain('aria-label="Flag as slop"');
  });
});

describe("ContentCard — float layout and font sizing", () => {
  it("uses float-right on GradeBadge container for default variant", () => {
    const html = renderToStaticMarkup(
      <ContentCard item={makeItem()} expanded={false} onToggle={jest.fn()} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("float-right");
  });

  it("uses float-right on GradeBadge container for priority variant", () => {
    const html = renderToStaticMarkup(
      <ContentCard item={makeItem()} expanded={false} onToggle={jest.fn()} onValidate={jest.fn()} onFlag={jest.fn()} variant="priority" />
    );
    expect(html).toContain("float-right");
  });

  it("contains float with flow-root BFC on text container", () => {
    const html = renderToStaticMarkup(
      <ContentCard item={makeItem()} expanded={false} onToggle={jest.fn()} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    // flow-root establishes BFC to contain floats without clipping box-shadow
    expect(html).toContain("flow-root");
  });

  it("uses text-body-lg for default card text", () => {
    const html = renderToStaticMarkup(
      <ContentCard item={makeItem()} expanded={false} onToggle={jest.fn()} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("text-body-lg");
    expect(html).toContain("leading-body-lg");
  });

  it("uses text-body-lg for default card on mobile too (unified sizing)", () => {
    const html = renderToStaticMarkup(
      <ContentCard item={makeItem()} expanded={false} onToggle={jest.fn()} onValidate={jest.fn()} onFlag={jest.fn()} mobile />
    );
    // Body text uses text-body-lg on mobile (same as desktop)
    expect(html).toContain("text-body-lg");
    // The <p> tag should have text-body-lg, not the old mobile-specific text-[13px]
    // (text-[13px] still appears on the author name in the header — that's expected)
    expect(html).toMatch(/<p[^>]*text-body-lg/);
  });

  it("uses 16px font for large (priority) variant", () => {
    const html = renderToStaticMarkup(
      <ContentCard item={makeItem()} expanded={false} onToggle={jest.fn()} onValidate={jest.fn()} onFlag={jest.fn()} variant="priority" />
    );
    expect(html).toContain("text-[16px]");
    expect(html).toContain("leading-[1.35]");
  });

  it("uses 16px font for serendipity variant", () => {
    const html = renderToStaticMarkup(
      <ContentCard item={makeItem()} expanded={false} onToggle={jest.fn()} onValidate={jest.fn()} onFlag={jest.fn()} variant="serendipity" />
    );
    expect(html).toContain("text-[16px]");
  });

  it("does not leak clear-right outside float container", () => {
    const html = renderToStaticMarkup(
      <ContentCard item={makeItem()} expanded={true} onToggle={jest.fn()} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    // overflow-hidden on the float parent establishes BFC — no clear-right needed outside
    // Count occurrences: clear-right should NOT appear at all (removed from expanded and outer divs)
    const clearCount = (html.match(/clear-right/g) || []).length;
    expect(clearCount).toBe(0);
  });

  it("wraps image and text in flex when imageUrl is present", () => {
    const html = renderToStaticMarkup(
      <ContentCard item={makeItem({ imageUrl: "https://example.com/img.jpg" })} expanded={false} onToggle={jest.fn()} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    expect(html).toContain("flex gap-3 items-start");
  });

  it("does not use flex wrapper when no imageUrl", () => {
    const html = renderToStaticMarkup(
      <ContentCard item={makeItem({ imageUrl: undefined })} expanded={false} onToggle={jest.fn()} onValidate={jest.fn()} onFlag={jest.fn()} />
    );
    // The body wrapper div should NOT have "flex gap-3" when there is no image
    // Check that "flex gap-3 items-start" does not appear (the header row has a different flex)
    expect(html).not.toContain("flex gap-3 items-start");
  });
});
