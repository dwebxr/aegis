/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, fireEvent } from "@testing-library/react";
import { ContentCard } from "@/components/ui/ContentCard";
import { WithTooltip } from "../../helpers/withTooltip";
import type { ContentItem } from "@/lib/types/content";

const renderCard = (ui: React.ReactElement) => render(<WithTooltip>{ui}</WithTooltip>);

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "test-1",
    owner: "owner-1",
    author: "Test Author",
    avatar: "TA",
    text: "Test content text",
    source: "rss",
    scores: { originality: 7, insight: 6, credibility: 8, composite: 7 },
    verdict: "quality",
    reason: "Test reason",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "2h ago",
    ...overrides,
  };
}

describe("ContentCard — YouTube integration", () => {
  it("renders YouTubePreview for YouTube watch URL", () => {
    const { container } = renderCard(
      <ContentCard
        item={makeItem({ sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", platform: "youtube" })}
        expanded={false} onToggle={jest.fn()} onValidate={jest.fn()} onFlag={jest.fn()}
      />
    );
    expect(container.querySelector(".aspect-video")).not.toBeNull();
    const img = container.querySelector(".aspect-video img");
    expect(img).not.toBeNull();
    expect((img as HTMLImageElement).src).toContain("img.youtube.com/vi/dQw4w9WgXcQ");
  });

  it("does NOT render YouTubePreview for non-YouTube URL", () => {
    const { container } = renderCard(
      <ContentCard
        item={makeItem({ sourceUrl: "https://example.com/article" })}
        expanded={false} onToggle={jest.fn()} onValidate={jest.fn()} onFlag={jest.fn()}
      />
    );
    expect(container.querySelector(".aspect-video")).toBeNull();
  });

  it("does NOT render YouTubePreview when sourceUrl is absent", () => {
    const { container } = renderCard(
      <ContentCard
        item={makeItem()}
        expanded={false} onToggle={jest.fn()} onValidate={jest.fn()} onFlag={jest.fn()}
      />
    );
    expect(container.querySelector(".aspect-video")).toBeNull();
  });

  it("renders both imageUrl and YouTubePreview when both present", () => {
    const { container } = renderCard(
      <ContentCard
        item={makeItem({
          sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          imageUrl: "https://example.com/thumb.jpg",
          platform: "youtube",
        })}
        expanded={false} onToggle={jest.fn()} onValidate={jest.fn()} onFlag={jest.fn()}
      />
    );
    const srcs = Array.from(container.querySelectorAll("img")).map(img => img.src);
    expect(srcs.some(s => s.includes("example.com/thumb.jpg"))).toBe(true);
    expect(srcs.some(s => s.includes("img.youtube.com/vi/dQw4w9WgXcQ"))).toBe(true);
  });

  it.each(["priority", "serendipity"] as const)("renders YouTubePreview in %s variant", (variant) => {
    const { container } = renderCard(
      <ContentCard
        item={makeItem({ sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", platform: "youtube" })}
        expanded={false} onToggle={jest.fn()} onValidate={jest.fn()} onFlag={jest.fn()}
        variant={variant} rank={variant === "priority" ? 1 : undefined}
      />
    );
    expect(container.querySelector(".aspect-video img")).not.toBeNull();
  });

  it("clicking play inside ContentCard shows iframe with correct embed URL", () => {
    const { container } = renderCard(
      <ContentCard
        item={makeItem({ sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", platform: "youtube" })}
        expanded={false} onToggle={jest.fn()} onValidate={jest.fn()} onFlag={jest.fn()}
      />
    );
    fireEvent.click(container.querySelector(".aspect-video button")!);

    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe!.src).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1");
  });

  // stopPropagation: playing video must not toggle the card
  it("clicking YouTubePreview does NOT call onToggle", () => {
    const onToggle = jest.fn();
    const { container } = renderCard(
      <ContentCard
        item={makeItem({ sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", platform: "youtube" })}
        expanded={false} onToggle={onToggle} onValidate={jest.fn()} onFlag={jest.fn()}
      />
    );
    fireEvent.click(container.querySelector(".aspect-video button")!);
    expect(onToggle).not.toHaveBeenCalled();
  });
});
