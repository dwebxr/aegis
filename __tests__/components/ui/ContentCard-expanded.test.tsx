import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContentCard } from "@/components/ui/ContentCard";
import type { ContentItem } from "@/lib/types/content";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "test-id",
    owner: "test-owner",
    author: "test-author",
    avatar: "\uD83E\uDDEA",
    text: "Test content for expanded card testing",
    source: "nostr",
    scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
    verdict: "quality",
    reason: "Good analysis with solid reasoning",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "just now",
    ...overrides,
  };
}

const noop = jest.fn();

describe("ContentCard — expanded state actions", () => {
  it("shows Validate and Flag Slop buttons when expanded", () => {
    const html = renderToStaticMarkup(
      <ContentCard item={makeItem()} expanded={true} onToggle={noop} onValidate={noop} onFlag={noop} />
    );
    expect(html).toContain("Validate");
    expect(html).toContain("Flag Slop");
  });

  it("shows Read more link when sourceUrl is http", () => {
    const html = renderToStaticMarkup(
      <ContentCard
        item={makeItem({ sourceUrl: "https://example.com/article" })}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
      />
    );
    expect(html).toContain("Read more");
    expect(html).toContain("https://example.com/article");
  });

  it("hides Read more link for non-http sourceUrl", () => {
    const html = renderToStaticMarkup(
      <ContentCard
        item={makeItem({ sourceUrl: "nostr:nevent1abc" })}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
      />
    );
    expect(html).not.toContain("Read more");
  });

  it("shows reason text when expanded", () => {
    const html = renderToStaticMarkup(
      <ContentCard
        item={makeItem({ reason: "Excellent sourcing" })}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
      />
    );
    expect(html).toContain("Excellent sourcing");
  });

  it("hides reason when not present", () => {
    const html = renderToStaticMarkup(
      <ContentCard
        item={makeItem({ reason: "" })}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
      />
    );
    // Empty reason should not render the italic reason container
    expect(html).not.toContain("font-style:italic");
  });

  it("shows disabled Validate button when already validated", () => {
    const html = renderToStaticMarkup(
      <ContentCard
        item={makeItem({ validated: true })}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
      />
    );
    expect(html).toContain("Validated");
    expect(html).toContain("disabled");
  });

  it("shows disabled Flag button when already flagged", () => {
    const html = renderToStaticMarkup(
      <ContentCard
        item={makeItem({ flagged: true })}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
      />
    );
    expect(html).toContain("Flagged");
  });

  it("does not show Flag Slop button for slop verdict (compact mode)", () => {
    const html = renderToStaticMarkup(
      <ContentCard
        item={makeItem({ verdict: "slop" })}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
      />
    );
    // Slop items don't show Flag Slop button (only Not Slop / Validate)
    expect(html).not.toContain("Flag Slop");
    expect(html).toContain("Not Slop");
  });

  it("shows 'Not Slop' for slop items in compact expanded mode", () => {
    const html = renderToStaticMarkup(
      <ContentCard
        item={makeItem({ verdict: "slop" })}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
      />
    );
    expect(html).toContain("Not Slop");
  });
});

describe("ContentCard — mobile rendering", () => {
  it("shows icon-only buttons on mobile", () => {
    const html = renderToStaticMarkup(
      <ContentCard
        item={makeItem({ sourceUrl: "https://example.com/article" })}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
        mobile={true}
      />
    );
    // Mobile: icon-only (no visible text labels after icons)
    expect(html).not.toContain("Read more");
    // "Validate" appears in aria-label but NOT as visible button text
    // The visible text " Validate" / " Flag Slop" is hidden on mobile
    expect(html).not.toContain("Flag Slop");
    // Verify icon-only mode: ↗ for Read more, SVG icons for validate/flag
    expect(html).toContain("\u2197"); // ↗
    // Validate button uses flex:none on mobile (not flex:1)
    expect(html).toContain("flex:none");
  });

  it("shows icon-only Save button on mobile", () => {
    const html = renderToStaticMarkup(
      <ContentCard
        item={makeItem()}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
        mobile={true}
        onBookmark={noop}
      />
    );
    // Mobile: only icon, no "Save" text
    expect(html).not.toContain("Save");
    expect(html).toContain("\uD83D\uDD16"); // 🔖
  });

  it("shows full text labels on desktop", () => {
    const html = renderToStaticMarkup(
      <ContentCard
        item={makeItem({ sourceUrl: "https://example.com/article" })}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
        mobile={false}
        onBookmark={noop}
      />
    );
    expect(html).toContain("Read more");
    expect(html).toContain("Validate");
    expect(html).toContain("Flag Slop");
    expect(html).toContain("Save");
  });
});

describe("ContentCard — bookmark button", () => {
  it("shows Save button when onBookmark is provided", () => {
    const html = renderToStaticMarkup(
      <ContentCard
        item={makeItem()}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
        onBookmark={noop}
      />
    );
    expect(html).toContain("Save");
    expect(html).toContain('aria-label="Bookmark for later"');
  });

  it("shows Saved state when isBookmarked is true", () => {
    const html = renderToStaticMarkup(
      <ContentCard
        item={makeItem()}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
        onBookmark={noop}
        isBookmarked={true}
      />
    );
    expect(html).toContain("Saved");
    expect(html).toContain('aria-label="Remove bookmark"');
  });

  it("does not show bookmark button when onBookmark is not provided", () => {
    const html = renderToStaticMarkup(
      <ContentCard
        item={makeItem()}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
      />
    );
    expect(html).not.toContain("Bookmark for later");
    expect(html).not.toContain("Remove bookmark");
  });
});

describe("ContentCard — cluster count badge", () => {
  it("shows related cluster count when collapsed", () => {
    const html = renderToStaticMarkup(
      <ContentCard
        item={makeItem()}
        expanded={false} onToggle={noop} onValidate={noop} onFlag={noop}
        clusterCount={3}
      />
    );
    expect(html).toContain("+3 related");
  });

  it("hides cluster count when expanded", () => {
    const html = renderToStaticMarkup(
      <ContentCard
        item={makeItem()}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
        clusterCount={3}
      />
    );
    expect(html).not.toContain("+3 related");
  });

  it("hides cluster count when 0", () => {
    const html = renderToStaticMarkup(
      <ContentCard
        item={makeItem()}
        expanded={false} onToggle={noop} onValidate={noop} onFlag={noop}
        clusterCount={0}
      />
    );
    expect(html).not.toContain("related");
  });
});

describe("ContentCard — serendipity variant", () => {
  it("renders serendipity border color when variant is serendipity", () => {
    const html = renderToStaticMarkup(
      <ContentCard
        item={makeItem()}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
        variant="serendipity"
      />
    );
    expect(html).toContain("124,58,237"); // purple RGB from serendipity theme
  });
});

describe("ContentCard — ScoreGrid rendering in expanded state", () => {
  it("shows score labels when expanded", () => {
    const html = renderToStaticMarkup(
      <ContentCard
        item={makeItem({ scores: { originality: 8, insight: 6, credibility: 9, composite: 7.5 } })}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
      />
    );
    expect(html).toContain("Originality");
    expect(html).toContain("Insight");
    expect(html).toContain("Credibility");
  });

  it("does not show ScoreGrid when collapsed", () => {
    const html = renderToStaticMarkup(
      <ContentCard
        item={makeItem()}
        expanded={false} onToggle={noop} onValidate={noop} onFlag={noop}
      />
    );
    expect(html).not.toContain("Originality");
    expect(html).not.toContain("Insight");
    expect(html).not.toContain("Credibility");
  });
});

describe("ContentCard — topics display", () => {
  it("shows topic tags", () => {
    const html = renderToStaticMarkup(
      <ContentCard
        item={makeItem({ topics: ["ai", "crypto", "defi"] })}
        expanded={false} onToggle={noop} onValidate={noop} onFlag={noop}
      />
    );
    expect(html).toContain("ai");
    expect(html).toContain("crypto");
    expect(html).toContain("defi");
  });

  it("handles items with no topics", () => {
    const html = renderToStaticMarkup(
      <ContentCard
        item={makeItem({ topics: undefined })}
        expanded={false} onToggle={noop} onValidate={noop} onFlag={noop}
      />
    );
    // Should render without error
    expect(html).toContain("test-id");
  });
});
