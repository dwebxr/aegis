/**
 * @jest-environment jsdom
 */
if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

// Mock @dfinity/agent to avoid BigInt incompatibility in Jest
jest.mock("@dfinity/agent", () => ({}));
jest.mock("@dfinity/principal", () => ({
  Principal: { fromText: jest.fn().mockReturnValue({ toText: () => "mock-principal" }) },
}));

// Mock useAgent before importing the component
const mockUseAgent = jest.fn();
jest.mock("@/contexts/AgentContext", () => ({
  useAgent: () => mockUseAgent(),
}));

jest.mock("@/lib/ic/actor", () => ({
  createBackendActorAsync: jest.fn().mockResolvedValue({
    getUserD2AMatches: jest.fn().mockResolvedValue([]),
  }),
}));

jest.mock("@/lib/ic/icpLedger", () => ({
  formatICP: jest.fn((n: bigint) => (Number(n) / 1e8).toFixed(4)),
}));

jest.mock("@/lib/utils/errors", () => ({
  handleICSessionError: jest.fn().mockReturnValue(false),
  errMsg: jest.fn((e: unknown) => e instanceof Error ? e.message : String(e)),
}));

jest.mock("nostr-tools/nip19", () => ({
  npubEncode: jest.fn().mockReturnValue("npub1testfake123456789abcdefghijklmnopqrstuvwxyz"),
}));

jest.mock("@/lib/nostr/linkAccount", () => ({
  maskNpub: jest.fn((npub: string) => npub.length > 16 ? npub.slice(0, 10) + "\u2026" + npub.slice(-6) : npub),
}));

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act } = require("react-dom/test-utils");
import { D2ATab } from "@/components/tabs/D2ATab";
import type { AgentState, ActivityLogEntry } from "@/lib/agent/types";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const FAKE_PUBKEY = "a".repeat(64);

function makeAgentState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    isActive: true,
    myPubkey: FAKE_PUBKEY,
    peers: [],
    activeHandshakes: [],
    receivedItems: 0,
    sentItems: 0,
    d2aMatchCount: 0,
    consecutiveErrors: 0,
    activityLog: [],
    ...overrides,
  };
}

const defaultAgentCtx = {
  agentProfile: null,
  agentProfileLoading: false,
  nostrKeys: { sk: new Uint8Array(32).fill(1), pk: "test-pk" },
  refreshAgentProfile: jest.fn(),
};

const defaultProps = {
  content: [],
  agentState: makeAgentState(),
  mobile: false,
  identity: {} as import("@dfinity/agent").Identity,
  principalText: "test-principal",
  onValidate: jest.fn(),
  onFlag: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAgent.mockReturnValue(defaultAgentCtx);
});

describe("D2ATab Agent Card — rendering", () => {
  it("renders Active badge when agent is active", () => {
    const html = renderToStaticMarkup(<D2ATab {...defaultProps} />);
    expect(html).toContain("Active");
  });

  it("shows default name when no profile is set", () => {
    const html = renderToStaticMarkup(<D2ATab {...defaultProps} />);
    expect(html).toContain("Aegis Agent for");
    expect(html).toContain("test-"); // principalText.slice(0,5)
  });

  it("shows display_name when profile has one", () => {
    mockUseAgent.mockReturnValue({
      ...defaultAgentCtx,
      agentProfile: { display_name: "My Cool Agent", name: "fallback" },
    });
    const html = renderToStaticMarkup(<D2ATab {...defaultProps} />);
    expect(html).toContain("My Cool Agent");
  });

  it("falls back to name when display_name is missing", () => {
    mockUseAgent.mockReturnValue({
      ...defaultAgentCtx,
      agentProfile: { name: "FallbackName" },
    });
    const html = renderToStaticMarkup(<D2ATab {...defaultProps} />);
    expect(html).toContain("FallbackName");
  });

  it("shows bot emoji when no picture set", () => {
    const html = renderToStaticMarkup(<D2ATab {...defaultProps} />);
    expect(html).toContain("\uD83E\uDD16");
  });

  it("shows avatar image when profile has picture", () => {
    mockUseAgent.mockReturnValue({
      ...defaultAgentCtx,
      agentProfile: { picture: "https://img.com/agent.jpg" },
    });
    const html = renderToStaticMarkup(<D2ATab {...defaultProps} />);
    expect(html).toContain("https://img.com/agent.jpg");
    expect(html).toContain("Agent");
  });

  it("renders peer count and exchange stats", () => {
    const agentState = makeAgentState({ peers: [{ nostrPubkey: "p1", interests: [], capacity: 3, lastSeen: Date.now() }, { nostrPubkey: "p2", interests: [], capacity: 3, lastSeen: Date.now() }], sentItems: 5, receivedItems: 3 });
    const html = renderToStaticMarkup(<D2ATab {...defaultProps} agentState={agentState} />);
    expect(html).toContain("2 peers");
    expect(html).toContain("5\u2191");
    expect(html).toContain("3\u2193");
  });

  it("renders masked npub", () => {
    const html = renderToStaticMarkup(<D2ATab {...defaultProps} />);
    expect(html).toContain("npub1test");
    expect(html).toContain("\u2026");
  });

  it("renders Copy npub button", () => {
    const html = renderToStaticMarkup(<D2ATab {...defaultProps} />);
    expect(html).toContain("Copy npub");
  });

  it("renders Edit Profile button when nostrKeys are available", () => {
    const html = renderToStaticMarkup(<D2ATab {...defaultProps} />);
    expect(html).toContain("Edit Profile");
  });

  it("does not render Edit Profile when nostrKeys is null", () => {
    mockUseAgent.mockReturnValue({
      ...defaultAgentCtx,
      nostrKeys: null,
    });
    const html = renderToStaticMarkup(<D2ATab {...defaultProps} />);
    expect(html).not.toContain("Edit Profile");
  });

  it("renders about text when profile has about", () => {
    mockUseAgent.mockReturnValue({
      ...defaultAgentCtx,
      agentProfile: { about: "I am a test agent doing test things" },
    });
    const html = renderToStaticMarkup(<D2ATab {...defaultProps} />);
    expect(html).toContain("I am a test agent doing test things");
  });

  it("does not render about section when profile has no about", () => {
    mockUseAgent.mockReturnValue({
      ...defaultAgentCtx,
      agentProfile: { name: "Agent" },
    });
    const html = renderToStaticMarkup(<D2ATab {...defaultProps} />);
    expect(html).not.toContain("-webkit-line-clamp");
  });

  it("renders website link when profile has website", () => {
    mockUseAgent.mockReturnValue({
      ...defaultAgentCtx,
      agentProfile: { website: "https://example.com" },
    });
    const html = renderToStaticMarkup(<D2ATab {...defaultProps} />);
    expect(html).toContain("example.com");
    expect(html).toContain("noopener noreferrer");
  });

  it("strips protocol and trailing slash from website display text", () => {
    mockUseAgent.mockReturnValue({
      ...defaultAgentCtx,
      agentProfile: { website: "https://www.example.com/" },
    });
    const html = renderToStaticMarkup(<D2ATab {...defaultProps} />);
    expect(html).toContain("www.example.com</a>"); // display text stripped
    expect(html).toContain('href="https://www.example.com/"'); // href preserved
  });

  it("shows loading indicator when profile is loading", () => {
    mockUseAgent.mockReturnValue({
      ...defaultAgentCtx,
      agentProfileLoading: true,
    });
    const html = renderToStaticMarkup(<D2ATab {...defaultProps} />);
    expect(html).toContain("...");
  });
});

describe("D2ATab Agent Card — hidden when inactive", () => {
  it("does not render Agent Card when agent is inactive", () => {
    const html = renderToStaticMarkup(
      <D2ATab {...defaultProps} agentState={makeAgentState({ isActive: false })} />,
    );
    expect(html).not.toContain("Active");
    expect(html).not.toContain("Edit Profile");
    expect(html).not.toContain("Copy npub");
  });

  it("does not render Agent Card when myPubkey is null", () => {
    const html = renderToStaticMarkup(
      <D2ATab {...defaultProps} agentState={makeAgentState({ myPubkey: null })} />,
    );
    expect(html).not.toContain("Edit Profile");
    expect(html).not.toContain("Copy npub");
  });

  it("does not render Agent Card when agentState is null", () => {
    const html = renderToStaticMarkup(
      <D2ATab {...defaultProps} agentState={null} />,
    );
    expect(html).not.toContain("Active");
    expect(html).not.toContain("Edit Profile");
  });
});

describe("D2ATab Agent Card — explanatory text", () => {
  it("renders explanatory text by default", () => {
    const html = renderToStaticMarkup(<D2ATab {...defaultProps} />);
    expect(html).toContain("auto-generated from your Internet Identity");
    expect(html).toContain("follow graph (WoT)");
    expect(html).toContain("Kind 0 profile");
  });

  it("renders Hide button", () => {
    const html = renderToStaticMarkup(<D2ATab {...defaultProps} />);
    expect(html).toContain("Hide");
  });
});

describe("D2ATab Agent Card — interaction", () => {
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
  });

  function render(props: Partial<typeof defaultProps> = {}) {
    const merged = { ...defaultProps, ...props };
    act(() => { root.render(<D2ATab {...merged} />); });
    return merged;
  }

  it("clicking Edit Profile opens the edit modal", () => {
    render();

    const editBtn = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent?.includes("Edit Profile"));
    expect(editBtn).toBeTruthy();

    act(() => { editBtn!.click(); });

    expect(container.textContent).toContain("Edit Agent Profile");
  });

  it("clicking Hide hides explanatory text, shows Learn more", () => {
    render();

    const hideBtn = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent === "Hide");
    expect(hideBtn).toBeTruthy();

    act(() => { hideBtn!.click(); });

    expect(container.textContent).not.toContain("auto-generated from your Internet Identity");
    expect(container.textContent).toContain("Learn more about this agent account");
  });

  it("clicking Learn more re-shows explanatory text", () => {
    render();

    // First hide
    const hideBtn = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent === "Hide");
    act(() => { hideBtn!.click(); });

    // Then show
    const learnBtn = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent?.includes("Learn more"));
    expect(learnBtn).toBeTruthy();
    act(() => { learnBtn!.click(); });

    expect(container.textContent).toContain("auto-generated from your Internet Identity");
    expect(container.textContent).toContain("Kind 0 profile");
  });

  it("Copy npub button copies and shows Copied feedback", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render();

    const copyBtn = Array.from(container.querySelectorAll("button"))
      .find(b => b.textContent === "Copy npub");
    expect(copyBtn).toBeTruthy();

    await act(async () => { copyBtn!.click(); });

    expect(writeText).toHaveBeenCalledWith("npub1testfake123456789abcdefghijklmnopqrstuvwxyz");
    expect(container.textContent).toContain("Copied!");
  });

  it("avatar img onError falls back to bot emoji", () => {
    mockUseAgent.mockReturnValue({
      ...defaultAgentCtx,
      agentProfile: { picture: "https://img.com/broken.jpg" },
    });

    render();

    const img = container.querySelector("img[alt='Agent']") as HTMLImageElement;
    expect(img).toBeTruthy();

    act(() => { img.dispatchEvent(new Event("error")); });

    const imgAfter = container.querySelector("img[alt='Agent']");
    expect(imgAfter).toBeNull();
    expect(container.textContent).toContain("\uD83E\uDD16");
  });
});

describe("D2ATab — empty states", () => {
  it("shows exchanges empty state when active but no content", () => {
    const html = renderToStaticMarkup(<D2ATab {...defaultProps} />);
    expect(html).toContain("Waiting for exchanges");
    expect(html).toContain("Agent identity established");
    expect(html).toContain("Broadcasting presence");
  });

  it("shows start exchanging state when agent is inactive", () => {
    const html = renderToStaticMarkup(
      <D2ATab {...defaultProps} agentState={makeAgentState({ isActive: false })} onTabChange={jest.fn()} />,
    );
    expect(html).toContain("Start exchanging content");
    expect(html).toContain("Enable in Settings");
  });
});

describe("D2ATab — header text", () => {
  it("shows agent status in header when active", () => {
    const agentState = makeAgentState({ peers: [{ nostrPubkey: "a", interests: [], capacity: 3, lastSeen: Date.now() }, { nostrPubkey: "b", interests: [], capacity: 3, lastSeen: Date.now() }], sentItems: 3, receivedItems: 2 });
    const html = renderToStaticMarkup(<D2ATab {...defaultProps} agentState={agentState} />);
    expect(html).toContain("Agent active");
    expect(html).toContain("2 peers");
    expect(html).toContain("3\u2191");
    expect(html).toContain("2\u2193");
  });

  it("shows enable prompt in header when inactive", () => {
    const html = renderToStaticMarkup(
      <D2ATab {...defaultProps} agentState={makeAgentState({ isActive: false })} />,
    );
    expect(html).toContain("Enable D2A Agent in Settings");
  });
});

describe("D2ATab — activity log", () => {
  it("renders activity log entries", () => {
    const log: ActivityLogEntry[] = [
      { id: "1", type: "presence", message: "Broadcasting presence", timestamp: Date.now() - 60000 },
      { id: "2", type: "discovery", message: "Discovered peer", peerId: "abc12345deadbeef", timestamp: Date.now() - 30000 },
    ];
    const html = renderToStaticMarkup(
      <D2ATab {...defaultProps} agentState={makeAgentState({ activityLog: log })} />,
    );
    expect(html).toContain("Activity Log");
    expect(html).toContain("Broadcasting presence");
    expect(html).toContain("Discovered peer");
    expect(html).toContain("abc12345");
  });

  it("does not render activity log when empty", () => {
    const html = renderToStaticMarkup(<D2ATab {...defaultProps} />);
    expect(html).not.toContain("Activity Log");
  });

  it("shows Show more button when more than 5 log entries", () => {
    const log: ActivityLogEntry[] = Array.from({ length: 8 }, (_, i) => ({
      id: `${i}`,
      type: "presence",
      message: `Entry ${i}`,
      timestamp: Date.now() - i * 10000,
    }));
    const html = renderToStaticMarkup(
      <D2ATab {...defaultProps} agentState={makeAgentState({ activityLog: log })} />,
    );
    expect(html).toContain("Show more (8)");
  });
});

describe("D2ATab — sub-tabs", () => {
  it("renders Exchanges, Published, and Matches sub-tabs", () => {
    const html = renderToStaticMarkup(<D2ATab {...defaultProps} />);
    expect(html).toContain("Exchanges");
    expect(html).toContain("Published");
    expect(html).toContain("Matches");
  });
});
