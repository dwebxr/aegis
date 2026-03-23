import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContentCard } from "@/components/ui/ContentCard";
import { WithTooltip } from "../../helpers/withTooltip";
import type { ContentItem } from "@/lib/types/content";

const wrap = (el: React.ReactElement) => renderToStaticMarkup(<WithTooltip>{el}</WithTooltip>);

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
    const html = wrap(
      <ContentCard item={makeItem()} expanded={true} onToggle={noop} onValidate={noop} onFlag={noop} />
    );
    expect(html).toContain("Validate");
    expect(html).toContain("Flag");
  });

  it("shows Read more link when sourceUrl is http", () => {
    const html = wrap(
      <ContentCard
        item={makeItem({ sourceUrl: "https://example.com/article" })}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
      />
    );
    expect(html).toContain("Read");
    expect(html).toContain("https://example.com/article");
  });

  it("hides Read more link for non-http sourceUrl", () => {
    const html = wrap(
      <ContentCard
        item={makeItem({ sourceUrl: "nostr:nevent1abc" })}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
      />
    );
    expect(html).not.toContain("Read");
  });

  it("shows reason text when expanded", () => {
    const html = wrap(
      <ContentCard
        item={makeItem({ reason: "Excellent sourcing" })}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
      />
    );
    expect(html).toContain("Excellent sourcing");
  });

  it("hides reason when not present", () => {
    const html = wrap(
      <ContentCard
        item={makeItem({ reason: "" })}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
      />
    );
    // Empty reason should not render the italic reason container
    expect(html).not.toContain("font-style:italic");
  });

  it("shows disabled Validate button when already validated", () => {
    const html = wrap(
      <ContentCard
        item={makeItem({ validated: true })}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
      />
    );
    expect(html).toContain("Validated");
    expect(html).toContain("disabled");
  });

  it("shows disabled Flag button when already flagged", () => {
    const html = wrap(
      <ContentCard
        item={makeItem({ flagged: true })}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
      />
    );
    expect(html).toContain("Flagged");
  });

  it("does not show Flag Slop button for slop verdict (compact mode)", () => {
    const html = wrap(
      <ContentCard
        item={makeItem({ verdict: "slop" })}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
      />
    );
    // Slop items don't show Flag Slop button (only Not Slop / Validate)
    expect(html).not.toContain("Flag");
    expect(html).toContain("Not Slop");
  });

  it("shows 'Not Slop' for slop items in compact expanded mode", () => {
    const html = wrap(
      <ContentCard
        item={makeItem({ verdict: "slop" })}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
      />
    );
    expect(html).toContain("Not Slop");
  });
});

describe("ContentCard — mobile rendering", () => {
  it("shows full-text buttons on mobile when few buttons (no bookmark/filter)", () => {
    const html = wrap(
      <ContentCard
        item={makeItem({ sourceUrl: "https://example.com/article" })}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
        mobile={true}
      />
    );
    // Only 3 buttons (Read more, Validate, Flag Slop) — full text fits on mobile
    expect(html).toContain("Read");
    expect(html).toContain("Validate");
    expect(html).toContain("Flag");
  });

  it("shows icon-only buttons on mobile when many buttons (bookmark present)", () => {
    const html = wrap(
      <ContentCard
        item={makeItem({ sourceUrl: "https://example.com/article" })}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
        mobile={true}
        onBookmark={noop}
      />
    );
    // In mobile compact mode, buttons show icon-only (no text labels)
    expect(html).toContain('aria-label="Read source article"');
    expect(html).not.toContain(" Read<"); // no text label next to icon
  });

  it("shows icon-only Save button on mobile", () => {
    const html = wrap(
      <ContentCard
        item={makeItem()}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
        mobile={true}
        onBookmark={noop}
      />
    );
    // Mobile compact: only icon, no "Save" text
    expect(html).toContain('aria-label="Bookmark for later"');
    expect(html).not.toContain(" Save<");
  });

  it("shows full text labels on desktop", () => {
    const html = wrap(
      <ContentCard
        item={makeItem({ sourceUrl: "https://example.com/article" })}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
        mobile={false}
        onBookmark={noop}
      />
    );
    expect(html).toContain("Read");
    expect(html).toContain("Validate");
    expect(html).toContain("Flag");
    expect(html).toContain("Save");
  });
});

describe("ContentCard — bookmark button", () => {
  it("shows Save button when onBookmark is provided", () => {
    const html = wrap(
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
    const html = wrap(
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
    const html = wrap(
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
    const html = wrap(
      <ContentCard
        item={makeItem()}
        expanded={false} onToggle={noop} onValidate={noop} onFlag={noop}
        clusterCount={3}
      />
    );
    expect(html).toContain("+3 related");
  });

  it("hides cluster count when expanded", () => {
    const html = wrap(
      <ContentCard
        item={makeItem()}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
        clusterCount={3}
      />
    );
    expect(html).not.toContain("+3 related");
  });

  it("hides cluster count when 0", () => {
    const html = wrap(
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
    const html = wrap(
      <ContentCard
        item={makeItem()}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
        variant="serendipity"
      />
    );
    expect(html).toContain("purple-600"); // purple from serendipity Tailwind class
  });
});

describe("ContentCard — ScoreGrid rendering in expanded state", () => {
  it("shows score labels when expanded", () => {
    const html = wrap(
      <ContentCard
        item={makeItem({ scores: { originality: 8, insight: 6, credibility: 9, composite: 7.5 } })}
        expanded={true} onToggle={noop} onValidate={noop} onFlag={noop}
      />
    );
    expect(html).toContain("Orig");
    expect(html).toContain("Ins");
    expect(html).toContain("Cred");
  });

  it("does not show ScoreGrid when collapsed", () => {
    const html = wrap(
      <ContentCard
        item={makeItem()}
        expanded={false} onToggle={noop} onValidate={noop} onFlag={noop}
      />
    );
    expect(html).not.toContain("Orig");
    expect(html).not.toContain("Ins<");
    expect(html).not.toContain("Cred");
  });
});

describe("ContentCard — topics display", () => {
  it("shows topic tags", () => {
    const html = wrap(
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
    const html = wrap(
      <ContentCard
        item={makeItem({ topics: undefined })}
        expanded={false} onToggle={noop} onValidate={noop} onFlag={noop}
      />
    );
    // Should render without error
    expect(html).toContain("test-id");
  });
});
