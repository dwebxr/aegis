/**
 * @jest-environment jsdom
 *
 * Briefing surface auto-translation (Codex P2 r2): search results, the
 * expanded Filtered Out list and discoveries render without ContentCard's
 * per-card auto effect, so a tab-level effect requests them — CAPPED at 20
 * for the unbounded lists so they can't mass-fire against the shared IC LLM.
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ContentItem } from "@/lib/types/content";
import type { UserPreferenceProfile } from "@/lib/preferences/types";

const onAutoTranslateMock = jest.fn();

jest.mock("@/components/ui/ContentCard", () => ({
  ContentCard: () => null,
  YouTubePreview: () => null,
}));
jest.mock("@/components/ui/ShareBriefingModal", () => ({ ShareBriefingModal: () => null }));
jest.mock("@/components/filtering/SerendipityBadge", () => ({ SerendipityBadge: () => null }));
jest.mock("@/components/ui/AudioBriefingPlayer", () => ({ AudioBriefingPlayer: () => null }));
jest.mock("@/components/ui/InfoTooltip", () => ({ InfoTooltip: () => null }));
jest.mock("@/components/ui/BriefingClassificationBadge", () => ({ BriefingClassificationBadge: () => null }));
jest.mock("@/hooks/useAudioBriefing", () => ({
  useAudioBriefing: () => ({
    status: { status: "idle" },
    available: false,
    prefs: { enabled: false, includeSerendipity: false },
    start: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
  }),
}));
jest.mock("@/contexts/ContentContext", () => ({
  useContent: () => ({ syncBriefing: jest.fn() }),
}));
jest.mock("@/contexts/AgentContext", () => ({
  useAgent: () => ({ briefingShareEnabled: false, isEnabled: false }),
}));
jest.mock("@/lib/apiKey/storage", () => ({ getUserApiKey: () => null }));

import { BriefingTab } from "@/components/tabs/BriefingTab";
import { createEmptyProfile } from "@/lib/preferences/types";

function makeItem(id: string, score = 8): ContentItem {
  return {
    id,
    owner: "u",
    author: "a",
    avatar: "",
    text: `text-${id}`,
    source: "rss",
    scores: { originality: score, insight: score, credibility: score, composite: score },
    verdict: "quality",
    reason: "good",
    createdAt: 1_700_000_000_000,
    validated: false,
    flagged: false,
    timestamp: "1m",
  };
}

function makeProfile(): UserPreferenceProfile {
  const p = createEmptyProfile("p-test");
  return {
    ...p,
    translationPrefs: { targetLanguage: "ja", policy: "all", backend: "auto", minScore: 6 },
  };
}

beforeEach(() => {
  onAutoTranslateMock.mockReset();
});

function renderTab(content: ContentItem[]) {
  return render(
    <BriefingTab
      content={content}
      profile={makeProfile()}
      onValidate={() => {}}
      onFlag={() => {}}
      nostrKeys={null}
      onAutoTranslate={onAutoTranslateMock}
    />,
  );
}

describe("BriefingTab — surface auto-translation", () => {
  it("expanding Filtered Out requests at most 20 items (cap against unbounded lists)", async () => {
    // 40 quality items → 5 priority + 1 serendipity, 34 filtered out.
    const items = Array.from({ length: 40 }, (_, i) => makeItem(`i-${i}`, 9 - (i % 3)));
    renderTab(items);

    const before = new Set(onAutoTranslateMock.mock.calls.map(c => c[0]));

    fireEvent.click(screen.getByTestId("aegis-briefing-filtered-toggle"));
    await waitFor(() => {
      const after = onAutoTranslateMock.mock.calls.map(c => c[0]);
      const newIds = after.filter(id => !before.has(id));
      expect(new Set(newIds).size).toBeGreaterThan(0);
      expect(new Set(newIds).size).toBeLessThanOrEqual(20);
    });
  });

  it("does not fire surface requests when onAutoTranslate is undefined (policy off/manual)", () => {
    const items = Array.from({ length: 10 }, (_, i) => makeItem(`i-${i}`));
    render(
      <BriefingTab
        content={items}
        profile={makeProfile()}
        onValidate={() => {}}
        onFlag={() => {}}
        nostrKeys={null}
      />,
    );
    expect(onAutoTranslateMock).not.toHaveBeenCalled();
  });
});
