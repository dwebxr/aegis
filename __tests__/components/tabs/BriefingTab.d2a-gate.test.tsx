/**
 * @jest-environment jsdom
 *
 * Codex finding #3 — D2A briefing-sync gate.
 *
 * Pre-fix: BriefingTab called syncBriefing() unconditionally whenever the
 * priority list changed. Any user who opened the Briefing tab once had their
 * full briefing JSON saved to a publicly readable canister field.
 *
 * Post-fix: the effect now short-circuits when useAgent().isEnabled is false.
 * These tests verify that contract by inspecting calls to a real
 * jest.fn-backed syncBriefing — not just shape, but call count and args.
 */
import React from "react";
import { render } from "@testing-library/react";
import type { ContentItem } from "@/lib/types/content";
import type { UserPreferenceProfile } from "@/lib/preferences/types";

const syncBriefingMock = jest.fn();
const useAgentMock = jest.fn();

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
  useContent: () => ({ syncBriefing: syncBriefingMock }),
}));

jest.mock("@/contexts/AgentContext", () => ({
  useAgent: () => useAgentMock(),
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

const profile: UserPreferenceProfile = createEmptyProfile("p-test");

beforeEach(() => {
  syncBriefingMock.mockReset();
  useAgentMock.mockReset();
});

function renderWith(props: { content: ContentItem[]; nostrPubkey?: string | null }) {
  return render(
    <BriefingTab
      content={props.content}
      profile={profile}
      onValidate={() => {}}
      onFlag={() => {}}
      nostrKeys={props.nostrPubkey ? { sk: new Uint8Array(), pk: props.nostrPubkey } : null}
    />,
  );
}

describe("BriefingTab — D2A privacy gate", () => {
  it("does NOT sync briefing to IC when D2A is disabled", () => {
    useAgentMock.mockReturnValue({ isEnabled: false });
    renderWith({ content: [makeItem("p1", 9), makeItem("p2", 8), makeItem("p3", 7)] });
    expect(syncBriefingMock).not.toHaveBeenCalled();
  });

  it("syncs briefing to IC when D2A is enabled and priority list is non-empty", () => {
    useAgentMock.mockReturnValue({ isEnabled: true });
    renderWith({ content: [makeItem("p1", 9), makeItem("p2", 8), makeItem("p3", 7)] });
    expect(syncBriefingMock).toHaveBeenCalledTimes(1);
    // First arg is BriefingState — confirm priority list flows through.
    const [briefingState, nostrPk] = syncBriefingMock.mock.calls[0];
    expect(briefingState.priority.length).toBeGreaterThan(0);
    expect(nostrPk).toBeNull();
  });

  it("forwards nostr pubkey when provided + D2A enabled", () => {
    useAgentMock.mockReturnValue({ isEnabled: true });
    renderWith({
      content: [makeItem("p1", 9), makeItem("p2", 8), makeItem("p3", 7)],
      nostrPubkey: "deadbeef".repeat(8),
    });
    expect(syncBriefingMock).toHaveBeenCalledWith(expect.any(Object), "deadbeef".repeat(8));
  });

  it("does NOT sync when D2A is enabled but priority list is empty", () => {
    useAgentMock.mockReturnValue({ isEnabled: true });
    // Empty content → generateBriefing returns empty priority → skip sync.
    renderWith({ content: [] });
    expect(syncBriefingMock).not.toHaveBeenCalled();
  });

  it("toggling D2A from on → off stops further syncs (content also changing)", () => {
    useAgentMock.mockReturnValue({ isEnabled: true });
    const items = [makeItem("p1", 9), makeItem("p2", 8), makeItem("p3", 7)];
    const view = renderWith({ content: items });
    expect(syncBriefingMock).toHaveBeenCalledTimes(1);

    syncBriefingMock.mockClear();
    useAgentMock.mockReturnValue({ isEnabled: false });
    view.rerender(
      <BriefingTab
        content={[makeItem("p4", 9), ...items]} // change content to retrigger effect
        profile={profile}
        onValidate={() => {}}
        onFlag={() => {}}
        nostrKeys={null}
      />,
    );
    expect(syncBriefingMock).not.toHaveBeenCalled();
  });

  it("toggling D2A on → off with STABLE content also stops syncs (gate, not content-change-triggered)", () => {
    // Without this isolation, the previous test could be passing for the wrong
    // reason: the content change might be the cause of the re-render that
    // skipped the sync. Pinning content stable proves the gate is what fires.
    useAgentMock.mockReturnValue({ isEnabled: true });
    const items = [makeItem("p1", 9), makeItem("p2", 8), makeItem("p3", 7)];
    const view = renderWith({ content: items });
    expect(syncBriefingMock).toHaveBeenCalledTimes(1);

    syncBriefingMock.mockClear();
    useAgentMock.mockReturnValue({ isEnabled: false });
    // SAME items array → briefingSyncKey unchanged. Only d2aEnabled flipped.
    view.rerender(
      <BriefingTab
        content={items}
        profile={profile}
        onValidate={() => {}}
        onFlag={() => {}}
        nostrKeys={null}
      />,
    );
    expect(syncBriefingMock).not.toHaveBeenCalled();
  });

  it("flipping D2A off → on with stable content DOES re-fire the sync", () => {
    // Complement to the previous test: if the gate is the deciding factor,
    // flipping it the other way (with content stable) must restart syncing.
    useAgentMock.mockReturnValue({ isEnabled: false });
    const items = [makeItem("p1", 9), makeItem("p2", 8), makeItem("p3", 7)];
    const view = renderWith({ content: items });
    expect(syncBriefingMock).not.toHaveBeenCalled();

    useAgentMock.mockReturnValue({ isEnabled: true });
    view.rerender(
      <BriefingTab
        content={items}
        profile={profile}
        onValidate={() => {}}
        onFlag={() => {}}
        nostrKeys={null}
      />,
    );
    expect(syncBriefingMock).toHaveBeenCalledTimes(1);
  });

  it("toggling D2A from off → on starts syncing on next content change", () => {
    useAgentMock.mockReturnValue({ isEnabled: false });
    const items = [makeItem("p1", 9), makeItem("p2", 8), makeItem("p3", 7)];
    const view = renderWith({ content: items });
    expect(syncBriefingMock).not.toHaveBeenCalled();

    useAgentMock.mockReturnValue({ isEnabled: true });
    view.rerender(
      <BriefingTab
        content={[makeItem("p4", 9), ...items]}
        profile={profile}
        onValidate={() => {}}
        onFlag={() => {}}
        nostrKeys={null}
      />,
    );
    expect(syncBriefingMock).toHaveBeenCalled();
  });
});
