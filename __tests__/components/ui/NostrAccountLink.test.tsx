// Partial mock: only mock nostr-tools externals (need network/WebSocket).
// Use real getLinkedAccount, saveLinkedAccount, clearLinkedAccount, maskNpub
// so tests exercise actual code paths instead of mock reimplementations.

// Polyfill localStorage for node test environment (react-dom/server needs node, not jsdom)
const _store: Record<string, string> = {};
if (typeof globalThis.localStorage === "undefined") {
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => _store[key] ?? null,
    setItem: (key: string, value: string) => { _store[key] = value; },
    removeItem: (key: string) => { delete _store[key]; },
    clear: () => { Object.keys(_store).forEach(k => delete _store[k]); },
    get length() { return Object.keys(_store).length; },
    key: (i: number) => Object.keys(_store)[i] ?? null,
  } as Storage;
}

jest.mock("nostr-tools/nip19", () => ({
  decode: jest.fn(),
  npubEncode: jest.fn(),
}));

jest.mock("nostr-tools/pool", () => ({
  SimplePool: jest.fn().mockImplementation(() => ({
    querySync: jest.fn().mockResolvedValue([]),
    destroy: jest.fn(),
  })),
}));

jest.mock("@/lib/wot/cache", () => ({
  clearWoTCache: jest.fn(),
}));

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NostrAccountLink } from "@/components/ui/NostrAccountLink";
import {
  getLinkedAccount,
  saveLinkedAccount,
  clearLinkedAccount,
  maskNpub,
} from "@/lib/nostr/linkAccount";
import type { LinkedNostrAccount } from "@/lib/nostr/linkAccount";

const FAKE_NPUB = "npub1testfakenpubvalue123456789";
const FAKE_HEX = "a".repeat(64);

beforeEach(() => {
  // Clear real (polyfilled) localStorage
  localStorage.clear();
});

describe("NostrAccountLink", () => {
  const noop = () => {};

  it("renders 'Not linked' state with input and Link button", () => {
    const html = renderToStaticMarkup(
      <NostrAccountLink onLinkChange={noop} />
    );
    expect(html).toContain("Not linked");
    expect(html).toContain("npub1");
    expect(html).toContain("Link");
  });

  it("renders linked state with masked npub and follow count", () => {
    saveLinkedAccount({
      npub: FAKE_NPUB,
      pubkeyHex: FAKE_HEX,
      displayName: "Alice",
      linkedAt: Date.now(),
      followCount: 342,
    });
    const html = renderToStaticMarkup(
      <NostrAccountLink onLinkChange={noop} />
    );
    expect(html).toContain("Alice");
    expect(html).toContain("342 follows");
    expect(html).toContain("Unlink");
  });

  it("renders caption text about WoT filtering", () => {
    const html = renderToStaticMarkup(
      <NostrAccountLink onLinkChange={noop} />
    );
    expect(html).toContain("Web of Trust");
  });

  it("renders in mobile mode without errors", () => {
    const html = renderToStaticMarkup(
      <NostrAccountLink mobile onLinkChange={noop} />
    );
    expect(html).toContain("Link");
  });

  it("falls back to real maskNpub when displayName is undefined", () => {
    saveLinkedAccount({
      npub: FAKE_NPUB,
      pubkeyHex: FAKE_HEX,
      linkedAt: Date.now(),
      followCount: 10,
    });
    const html = renderToStaticMarkup(
      <NostrAccountLink onLinkChange={noop} />
    );
    // Verify the real maskNpub output matches
    const expected = maskNpub(FAKE_NPUB);
    expect(html).toContain(expected);
    expect(html).toContain("10 follows");
    expect(html).not.toContain("undefined");
  });

  it("displays 0 follows correctly", () => {
    saveLinkedAccount({
      npub: FAKE_NPUB,
      pubkeyHex: FAKE_HEX,
      displayName: "NoFollows",
      linkedAt: Date.now(),
      followCount: 0,
    });
    const html = renderToStaticMarkup(
      <NostrAccountLink onLinkChange={noop} />
    );
    expect(html).toContain("0 follows");
    expect(html).toContain("NoFollows");
  });

  it("renders Link button as disabled when input is empty (SSR)", () => {
    const html = renderToStaticMarkup(
      <NostrAccountLink onLinkChange={noop} />
    );
    expect(html).toContain("disabled");
  });

  it("does not render input or Link button when linked", () => {
    saveLinkedAccount({
      npub: FAKE_NPUB,
      pubkeyHex: FAKE_HEX,
      displayName: "Alice",
      linkedAt: Date.now(),
      followCount: 42,
    });
    const html = renderToStaticMarkup(
      <NostrAccountLink onLinkChange={noop} />
    );
    expect(html).toContain("Unlink");
    expect(html).not.toContain("npub1… or hex pubkey");
  });

  it("does not render Unlink or Confirm when not linked", () => {
    const html = renderToStaticMarkup(
      <NostrAccountLink onLinkChange={noop} />
    );
    expect(html).not.toContain("Unlink");
    expect(html).not.toContain("Confirm");
  });

  it("uses mono font for input field", () => {
    const html = renderToStaticMarkup(
      <NostrAccountLink onLinkChange={noop} />
    );
    expect(html).toContain("JetBrains Mono");
  });

  it("renders green status dot when linked", () => {
    saveLinkedAccount({
      npub: FAKE_NPUB,
      pubkeyHex: FAKE_HEX,
      displayName: "Alice",
      linkedAt: Date.now(),
      followCount: 5,
    });
    const html = renderToStaticMarkup(
      <NostrAccountLink onLinkChange={noop} />
    );
    // Green status dot (colors.green[400] = #34d399)
    expect(html).toContain("#34d399");
  });

  it("follow count appears twice in linked state (status + detail)", () => {
    saveLinkedAccount({
      npub: FAKE_NPUB,
      pubkeyHex: FAKE_HEX,
      displayName: "Test",
      linkedAt: Date.now(),
      followCount: 77,
    });
    const html = renderToStaticMarkup(
      <NostrAccountLink onLinkChange={noop} />
    );
    const matches = html.match(/77 follows/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(2);
  });

  it("renders real maskNpub output in code element", () => {
    saveLinkedAccount({
      npub: FAKE_NPUB,
      pubkeyHex: FAKE_HEX,
      displayName: "Alice",
      linkedAt: Date.now(),
      followCount: 10,
    });
    const html = renderToStaticMarkup(
      <NostrAccountLink onLinkChange={noop} />
    );
    // The <code> element should contain the real maskNpub output
    const masked = maskNpub(FAKE_NPUB);
    expect(masked).toContain("…"); // verify real maskNpub works
    expect(html).toContain(`<code`);
    expect(html).toContain(masked);
  });

  it("reads initial state from real localStorage", () => {
    // Save, then verify the component picks it up via real getLinkedAccount
    const account: LinkedNostrAccount = {
      npub: FAKE_NPUB,
      pubkeyHex: FAKE_HEX,
      displayName: "FromStorage",
      linkedAt: 1700000000000,
      followCount: 99,
    };
    saveLinkedAccount(account);
    expect(getLinkedAccount()).toEqual(account); // verify storage works

    const html = renderToStaticMarkup(
      <NostrAccountLink onLinkChange={noop} />
    );
    expect(html).toContain("FromStorage");
    expect(html).toContain("99 follows");
  });
});
