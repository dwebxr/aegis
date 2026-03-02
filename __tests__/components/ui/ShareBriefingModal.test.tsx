/**
 * @jest-environment jsdom
 */
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act } = require("react-dom/test-utils");
import { ShareBriefingModal } from "@/components/ui/ShareBriefingModal";
import type { BriefingState } from "@/lib/briefing/types";
import type { ContentItem } from "@/lib/types/content";

jest.mock("@/lib/briefing/serialize", () => ({
  serializeBriefing: jest.fn().mockReturnValue("serialized-content"),
}));

jest.mock("@/lib/nostr/publish", () => ({
  publishBriefingToNostr: jest.fn().mockResolvedValue({
    naddr: "naddr1test",
    relaysPublished: ["wss://relay.test"],
  }),
}));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "test-1", owner: "o", author: "A", avatar: "", text: "Text",
    source: "rss", scores: { originality: 7, insight: 7, credibility: 7, composite: 7 },
    verdict: "quality", reason: "Good", createdAt: Date.now(),
    validated: false, flagged: false, timestamp: "1h ago",
    ...overrides,
  };
}

const briefing: BriefingState = {
  priority: [
    { item: makeItem({ id: "p1" }), briefingScore: 8, isSerendipity: false, classification: "familiar" },
    { item: makeItem({ id: "p2" }), briefingScore: 7, isSerendipity: false, classification: "novel" },
  ],
  serendipity: { item: makeItem({ id: "s1" }), briefingScore: 5, isSerendipity: true, classification: "novel" },
  filteredOut: [makeItem({ id: "f1" })],
  totalItems: 4,
  generatedAt: Date.now(),
};

const nostrKeys = {
  sk: new Uint8Array(32),
  pk: "test-pubkey",
};

describe("ShareBriefingModal — rendering", () => {
  it("renders confirm phase by default", () => {
    const html = renderToStaticMarkup(
      <ShareBriefingModal briefing={briefing} nostrKeys={nostrKeys} onClose={jest.fn()} />,
    );
    expect(html).toContain("Share Briefing");
    expect(html).toContain("NIP-23");
    expect(html).toContain("3 curated items"); // 2 priority + 1 serendipity
    expect(html).toContain("Cancel");
  });

  it("shows what is shared", () => {
    const html = renderToStaticMarkup(
      <ShareBriefingModal briefing={briefing} nostrKeys={nostrKeys} onClose={jest.fn()} />,
    );
    expect(html).toContain("What");
    expect(html).toContain("shared");
    expect(html).toContain("scores");
    expect(html).toContain("Nostr public key");
  });

  it("shows what is NOT shared", () => {
    const html = renderToStaticMarkup(
      <ShareBriefingModal briefing={briefing} nostrKeys={nostrKeys} onClose={jest.fn()} />,
    );
    expect(html).toContain("NOT shared");
    expect(html).toContain("preference profile");
    expect(html).toContain("1 burned"); // filteredOut.length = 1
  });

  it("renders with zero serendipity", () => {
    const noSerendipity: BriefingState = { ...briefing, serendipity: null };
    const html = renderToStaticMarkup(
      <ShareBriefingModal briefing={noSerendipity} nostrKeys={nostrKeys} onClose={jest.fn()} />,
    );
    expect(html).toContain("2 curated items"); // only priority
  });

  it("renders mobile width", () => {
    const html = renderToStaticMarkup(
      <ShareBriefingModal briefing={briefing} nostrKeys={nostrKeys} onClose={jest.fn()} mobile />,
    );
    expect(html).toContain("92vw");
  });
});

describe("ShareBriefingModal — interaction", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    document.body.innerHTML = "";
    jest.restoreAllMocks();
  });

  function render(props: React.ComponentProps<typeof ShareBriefingModal>) {
    act(() => { root.render(<ShareBriefingModal {...props} />); });
  }

  it("clicking Cancel calls onClose", () => {
    const onClose = jest.fn();
    render({ briefing, nostrKeys, onClose });

    const cancelBtn = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent === "Cancel");
    expect(cancelBtn).not.toBeNull();
    act(() => { cancelBtn!.click(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking backdrop calls onClose", () => {
    const onClose = jest.fn();
    render({ briefing, nostrKeys, onClose });

    const backdrop = container.firstElementChild as HTMLDivElement;
    act(() => { backdrop.click(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking modal content does NOT call onClose", () => {
    const onClose = jest.fn();
    render({ briefing, nostrKeys, onClose });

    const modal = container.firstElementChild?.firstElementChild as HTMLDivElement;
    act(() => { modal.click(); });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Share Briefing button triggers publishing flow", async () => {
    const onClose = jest.fn();
    render({ briefing, nostrKeys, onClose });

    const shareBtn = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent === "Share Briefing");
    expect(shareBtn).not.toBeNull();

    await act(async () => { shareBtn!.click(); });

    // After successful publish, should show success phase
    expect(container.textContent).toContain("Briefing Shared");
  });

  it("clipboard copy fallback cleans up DOM element", async () => {
    const onClose = jest.fn();
    render({ briefing, nostrKeys, onClose });

    // Trigger publish first
    const shareBtn = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent === "Share Briefing");
    await act(async () => { shareBtn!.click(); });

    // Mock clipboard to fail (triggers fallback)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: jest.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });

    // Define execCommand (not present in jsdom by default) then spy on it
    if (!document.execCommand) {
      document.execCommand = jest.fn().mockReturnValue(true);
    }
    const execSpy = jest.spyOn(document, "execCommand").mockReturnValue(true);
    const bodyChildCount = document.body.children.length;

    const copyBtn = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent === "Copy");
    if (copyBtn) {
      await act(async () => { copyBtn.click(); });
      // DOM element should be cleaned up (no lingering input)
      expect(document.body.children.length).toBe(bodyChildCount);
      expect(execSpy).toHaveBeenCalledWith("copy");
    }

    execSpy.mockRestore();
  });
});

describe("ShareBriefingModal — error handling", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    document.body.innerHTML = "";
    jest.restoreAllMocks();
  });

  it("shows error phase when publish fails", async () => {
    const { publishBriefingToNostr } = require("@/lib/nostr/publish");
    publishBriefingToNostr.mockRejectedValueOnce(new Error("Relay timeout"));

    act(() => {
      root.render(<ShareBriefingModal briefing={briefing} nostrKeys={nostrKeys} onClose={jest.fn()} />);
    });

    const shareBtn = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent === "Share Briefing");
    await act(async () => { shareBtn!.click(); });

    expect(container.textContent).toContain("Share Failed");
    expect(container.textContent).toContain("Relay timeout");
  });

  it("shows error when no relays published", async () => {
    const { publishBriefingToNostr } = require("@/lib/nostr/publish");
    publishBriefingToNostr.mockResolvedValueOnce({
      naddr: "naddr1test",
      relaysPublished: [],
    });

    act(() => {
      root.render(<ShareBriefingModal briefing={briefing} nostrKeys={nostrKeys} onClose={jest.fn()} />);
    });

    const shareBtn = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent === "Share Briefing");
    await act(async () => { shareBtn!.click(); });

    expect(container.textContent).toContain("Failed to publish to any relay");
  });

  it("Try Again button resets to confirm phase", async () => {
    const { publishBriefingToNostr } = require("@/lib/nostr/publish");
    publishBriefingToNostr.mockRejectedValueOnce(new Error("fail"));

    act(() => {
      root.render(<ShareBriefingModal briefing={briefing} nostrKeys={nostrKeys} onClose={jest.fn()} />);
    });

    const shareBtn = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent === "Share Briefing");
    await act(async () => { shareBtn!.click(); });

    const retryBtn = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent === "Try Again");
    expect(retryBtn).not.toBeNull();
    act(() => { retryBtn!.click(); });

    expect(container.textContent).toContain("Share Briefing");
    expect(container.textContent).not.toContain("Share Failed");
  });
});
