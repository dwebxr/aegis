/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, fireEvent } from "@testing-library/react";
import { ContentCard } from "@/components/ui/ContentCard";
import type { ContentItem } from "@/lib/types/content";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "card-42",
    owner: "test-owner",
    author: "test-author",
    avatar: "T",
    text: "Test content",
    source: "nostr",
    scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
    verdict: "quality" as const,
    reason: "Good content",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "just now",
    ...overrides,
  };
}

describe("ContentCard — onToggle(id) callback", () => {
  it("calls onToggle with item.id on click", () => {
    const onToggle = jest.fn();
    const item = makeItem({ id: "abc-123" });
    const { container } = render(
      <ContentCard item={item} expanded={false} onToggle={onToggle} onValidate={jest.fn()} onFlag={jest.fn()} />,
    );
    const card = container.querySelector('[role="button"]')!;
    fireEvent.click(card);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith("abc-123");
  });

  it("calls onToggle with item.id on Enter key", () => {
    const onToggle = jest.fn();
    const item = makeItem({ id: "key-enter" });
    const { container } = render(
      <ContentCard item={item} expanded={false} onToggle={onToggle} onValidate={jest.fn()} onFlag={jest.fn()} />,
    );
    const card = container.querySelector('[role="button"]')!;
    fireEvent.keyDown(card, { key: "Enter" });
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith("key-enter");
  });

  it("calls onToggle with item.id on Space key", () => {
    const onToggle = jest.fn();
    const item = makeItem({ id: "key-space" });
    const { container } = render(
      <ContentCard item={item} expanded={false} onToggle={onToggle} onValidate={jest.fn()} onFlag={jest.fn()} />,
    );
    const card = container.querySelector('[role="button"]')!;
    fireEvent.keyDown(card, { key: " " });
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith("key-space");
  });

  it("does not call onToggle on unrelated keys", () => {
    const onToggle = jest.fn();
    const { container } = render(
      <ContentCard item={makeItem()} expanded={false} onToggle={onToggle} onValidate={jest.fn()} onFlag={jest.fn()} />,
    );
    const card = container.querySelector('[role="button"]')!;
    fireEvent.keyDown(card, { key: "Tab" });
    fireEvent.keyDown(card, { key: "Escape" });
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("passes the correct id for different items", () => {
    const onToggle = jest.fn();
    const { container: c1 } = render(
      <ContentCard item={makeItem({ id: "first" })} expanded={false} onToggle={onToggle} onValidate={jest.fn()} onFlag={jest.fn()} />,
    );
    fireEvent.click(c1.querySelector('[role="button"]')!);

    const { container: c2 } = render(
      <ContentCard item={makeItem({ id: "second" })} expanded={false} onToggle={onToggle} onValidate={jest.fn()} onFlag={jest.fn()} />,
    );
    fireEvent.click(c2.querySelector('[role="button"]')!);

    expect(onToggle).toHaveBeenCalledWith("first");
    expect(onToggle).toHaveBeenCalledWith("second");
  });
});
