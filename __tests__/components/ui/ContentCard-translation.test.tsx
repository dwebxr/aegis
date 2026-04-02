/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ContentCard } from "@/components/ui/ContentCard";
import type { ContentItem } from "@/lib/types/content";

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "test-id",
    owner: "test-owner",
    author: "test-author",
    avatar: "",
    text: "Original English content here",
    source: "rss",
    scores: { originality: 7, insight: 6, credibility: 8, composite: 7 },
    verdict: "quality",
    reason: "Good content",
    createdAt: Date.now(),
    validated: false,
    flagged: false,
    timestamp: "just now",
    ...overrides,
  };
}

const noop = () => {};
const mockTranslate = jest.fn();

function renderCard(overrides: Partial<ContentItem> = {}, onTranslate?: (id: string) => void) {
  return render(
    <ContentCard
      item={makeItem(overrides)}
      expanded={true}
      onToggle={noop}
      onValidate={noop}
      onFlag={noop}
      onTranslate={onTranslate}
    />
  );
}

beforeEach(() => {
  mockTranslate.mockClear();
});

describe("ContentCard translation display", () => {
  it("shows original text when no translation exists", () => {
    renderCard();
    expect(screen.getByText("Original English content here")).toBeTruthy();
    expect(screen.queryByText("Show original")).toBeNull();
  });

  it("shows translated text as primary when translation exists", () => {
    renderCard({
      translation: {
        translatedText: "翻訳されたコンテンツ",
        targetLanguage: "ja",
        backend: "ic-llm",
        generatedAt: Date.now(),
      },
    });
    expect(screen.getByText("翻訳されたコンテンツ")).toBeTruthy();
    expect(screen.queryByText("Original English content here")).toBeNull();
  });

  it("shows backend info when translation exists", () => {
    renderCard({
      translation: {
        translatedText: "Translated",
        targetLanguage: "ja",
        backend: "ollama",
        generatedAt: Date.now(),
      },
    });
    expect(screen.getByText(/ja via ollama/)).toBeTruthy();
  });

  it("shows Show original button that toggles original text", () => {
    renderCard({
      translation: {
        translatedText: "翻訳テキスト",
        targetLanguage: "ja",
        backend: "ic-llm",
        generatedAt: Date.now(),
      },
    });

    expect(screen.queryByText("Original English content here")).toBeNull();
    expect(screen.getByText("Show original")).toBeTruthy();

    fireEvent.click(screen.getByText("Show original"));
    expect(screen.getByText("Original English content here")).toBeTruthy();
    expect(screen.getByText("Hide original")).toBeTruthy();

    fireEvent.click(screen.getByText("Hide original"));
    expect(screen.queryByText("Original English content here")).toBeNull();
    expect(screen.getByText("Show original")).toBeTruthy();
  });

  it("shows Translate button when onTranslate provided and no translation", () => {
    renderCard({}, mockTranslate);
    expect(screen.getByText("Translate")).toBeTruthy();
  });

  it("hides Translate button when translation already exists", () => {
    renderCard({
      translation: {
        translatedText: "翻訳済み",
        targetLanguage: "ja",
        backend: "claude-server",
        generatedAt: Date.now(),
      },
    }, mockTranslate);
    expect(screen.queryByText("Translate")).toBeNull();
  });

  it("hides Translate button when onTranslate is not provided", () => {
    renderCard();
    expect(screen.queryByText("Translate")).toBeNull();
  });

  it("calls onTranslate with item id when Translate button clicked", () => {
    renderCard({}, mockTranslate);
    fireEvent.click(screen.getByText("Translate"));
    expect(mockTranslate).toHaveBeenCalledWith("test-id");
  });

  it("shows Translating... state when isTranslating is true", () => {
    render(
      <ContentCard
        item={makeItem()}
        expanded={true}
        onToggle={noop}
        onValidate={noop}
        onFlag={noop}
        onTranslate={mockTranslate}
        isTranslating={true}
      />
    );
    expect(screen.getByText("Translating...")).toBeTruthy();
  });
});
