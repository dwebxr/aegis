/**
 * @jest-environment jsdom
 *
 * Public-briefing-sharing gate (originally Codex finding #3, then decoupled
 * from D2A dormancy).
 *
 * Pre-fix: BriefingTab called syncBriefing() unconditionally whenever the
 * priority list changed. Any user who opened the Briefing tab once had their
 * full briefing JSON saved to a publicly readable canister field.
 *
 * Now: the effect short-circuits when useAgent().briefingShareEnabled is
 * false. The gate is deliberately INDEPENDENT of the D2A agent state
 * (useAgent().isEnabled) — D2A stays dormant while briefing sharing works.
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

describe("BriefingTab — public briefing sharing gate", () => {
  it("does NOT sync briefing to IC when sharing is disabled", () => {
    useAgentMock.mockReturnValue({ briefingShareEnabled: false });
    renderWith({ content: [makeItem("p1", 9), makeItem("p2", 8), makeItem("p3", 7)] });
    expect(syncBriefingMock).not.toHaveBeenCalled();
  });

  it("syncs briefing to IC when sharing is enabled and priority list is non-empty", () => {
    useAgentMock.mockReturnValue({ briefingShareEnabled: true });
    renderWith({ content: [makeItem("p1", 9), makeItem("p2", 8), makeItem("p3", 7)] });
    expect(syncBriefingMock).toHaveBeenCalledTimes(1);
    // First arg is BriefingState — confirm priority list flows through.
    const [briefingState, nostrPk] = syncBriefingMock.mock.calls[0];
    expect(briefingState.priority.length).toBeGreaterThan(0);
    expect(nostrPk).toBeNull();
  });

  it("forwards nostr pubkey when provided + sharing enabled", () => {
    useAgentMock.mockReturnValue({ briefingShareEnabled: true });
    renderWith({
      content: [makeItem("p1", 9), makeItem("p2", 8), makeItem("p3", 7)],
      nostrPubkey: "deadbeef".repeat(8),
    });
    expect(syncBriefingMock).toHaveBeenCalledWith(expect.any(Object), "deadbeef".repeat(8));
  });

  it("does NOT sync when sharing is enabled but priority list is empty", () => {
    useAgentMock.mockReturnValue({ briefingShareEnabled: true });
    // Empty content → generateBriefing returns empty priority → skip sync.
    renderWith({ content: [] });
    expect(syncBriefingMock).not.toHaveBeenCalled();
  });

  it("toggling sharing from on → off stops further syncs (content also changing)", () => {
    useAgentMock.mockReturnValue({ briefingShareEnabled: true });
    const items = [makeItem("p1", 9), makeItem("p2", 8), makeItem("p3", 7)];
    const view = renderWith({ content: items });
    expect(syncBriefingMock).toHaveBeenCalledTimes(1);

    syncBriefingMock.mockClear();
    useAgentMock.mockReturnValue({ briefingShareEnabled: false });
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

  it("toggling sharing on → off with STABLE content also stops syncs (gate, not content-change-triggered)", () => {
    // Without this isolation, the previous test could be passing for the wrong
    // reason: the content change might be the cause of the re-render that
    // skipped the sync. Pinning content stable proves the gate is what fires.
    useAgentMock.mockReturnValue({ briefingShareEnabled: true });
    const items = [makeItem("p1", 9), makeItem("p2", 8), makeItem("p3", 7)];
    const view = renderWith({ content: items });
    expect(syncBriefingMock).toHaveBeenCalledTimes(1);

    syncBriefingMock.mockClear();
    useAgentMock.mockReturnValue({ briefingShareEnabled: false });
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

  it("flipping sharing off → on with stable content DOES re-fire the sync", () => {
    // Complement to the previous test: if the gate is the deciding factor,
    // flipping it the other way (with content stable) must restart syncing.
    useAgentMock.mockReturnValue({ briefingShareEnabled: false });
    const items = [makeItem("p1", 9), makeItem("p2", 8), makeItem("p3", 7)];
    const view = renderWith({ content: items });
    expect(syncBriefingMock).not.toHaveBeenCalled();

    useAgentMock.mockReturnValue({ briefingShareEnabled: true });
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

  it("gate is independent of the D2A agent state (isEnabled)", () => {
    // D2A agent "on" must NOT publish when sharing is off…
    useAgentMock.mockReturnValue({ briefingShareEnabled: false, isEnabled: true });
    const view = renderWith({ content: [makeItem("p1", 9), makeItem("p2", 8), makeItem("p3", 7)] });
    expect(syncBriefingMock).not.toHaveBeenCalled();
    view.unmount();

    // …and sharing "on" publishes even with the D2A agent dormant.
    useAgentMock.mockReturnValue({ briefingShareEnabled: true, isEnabled: false });
    renderWith({ content: [makeItem("p1", 9), makeItem("p2", 8), makeItem("p3", 7)] });
    expect(syncBriefingMock).toHaveBeenCalledTimes(1);
  });

  it("toggling sharing from off → on starts syncing on next content change", () => {
    useAgentMock.mockReturnValue({ briefingShareEnabled: false });
    const items = [makeItem("p1", 9), makeItem("p2", 8), makeItem("p3", 7)];
    const view = renderWith({ content: items });
    expect(syncBriefingMock).not.toHaveBeenCalled();

    useAgentMock.mockReturnValue({ briefingShareEnabled: true });
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
