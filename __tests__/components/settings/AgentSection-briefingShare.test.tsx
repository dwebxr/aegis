/**
 * @jest-environment jsdom
 *
 * Public-briefing-sharing toggle (settings). Ordering contract:
 * - ON: canister write FIRST, client state only after success (otherwise
 *   BriefingTab would publish against a canister that still rejects saves).
 * - OFF: client state immediately (stop publishing now), then canister write
 *   (which purges the public snapshot); failure surfaces a retry message.
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockSetBriefingShareEnabled = jest.fn();
const mockSyncLinkedAccountToIC = jest.fn();
const mockLoadSettingsFromIC = jest.fn();
let mockLinkedAccount: unknown = null;
let mockBriefingShareEnabled = false;
let mockAuthValue: { isAuthenticated: boolean; identity: unknown; principalText: string | null } = {
  isAuthenticated: true,
  identity: { fake: true },
  principalText: "principal-abc",
};

jest.mock("@/contexts/AgentContext", () => ({
  __esModule: true,
  useAgent: () => ({
    isEnabled: false,
    briefingShareEnabled: mockBriefingShareEnabled,
    setBriefingShareEnabled: mockSetBriefingShareEnabled,
  }),
}));
jest.mock("@/contexts/AuthContext", () => ({
  __esModule: true,
  useAuth: () => mockAuthValue,
}));
jest.mock("@/contexts/PreferenceContext", () => ({
  __esModule: true,
  usePreferences: () => ({
    profile: {
      topicAffinities: {},
      customFilterRules: [],
      calibration: { qualityThreshold: 6 },
      totalValidated: 0,
      totalFlagged: 0,
    },
    setTopicAffinity: jest.fn(),
    removeTopicAffinity: jest.fn(),
    setQualityThreshold: jest.fn(),
    addFilterRule: jest.fn(),
    removeFilterRule: jest.fn(),
  }),
}));
jest.mock("@/components/ui/AgentStatusBadge", () => ({ AgentStatusBadge: () => null }));
jest.mock("@/lib/nostr/linkAccount", () => ({
  __esModule: true,
  syncLinkedAccountToIC: (...a: unknown[]) => mockSyncLinkedAccountToIC(...a),
  loadSettingsFromIC: (...a: unknown[]) => mockLoadSettingsFromIC(...a),
  getLinkedAccount: () => mockLinkedAccount,
}));
jest.mock("@/lib/agent/config", () => ({
  __esModule: true,
  D2A_SUBSYSTEM_ENABLED: false,
  BRIEFING_PUBLISH_ENABLED: true,
}));

import { AgentSection } from "@/components/settings/AgentSection";

beforeEach(() => {
  mockSetBriefingShareEnabled.mockReset();
  mockSyncLinkedAccountToIC.mockReset();
  mockLoadSettingsFromIC.mockReset();
  mockLoadSettingsFromIC.mockResolvedValue({ ok: true, settings: null }); // no on-chain settings yet
  mockLinkedAccount = null;
  mockBriefingShareEnabled = false;
  mockAuthValue = { isAuthenticated: true, identity: { fake: true }, principalText: "principal-abc" };
  localStorage.clear();
});

const toggle = () => screen.getByTestId("aegis-settings-briefing-share-toggle");

describe("AgentSection — public briefing sharing toggle", () => {
  it("renders the card with the toggle disabled state", () => {
    render(<AgentSection />);
    expect(screen.getByText("Public Briefing Sharing")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
  });

  it("ON: writes the canister first and flips client state only on success", async () => {
    mockSyncLinkedAccountToIC.mockResolvedValue(true);
    render(<AgentSection />);
    fireEvent.click(toggle());
    await waitFor(() => expect(mockSetBriefingShareEnabled).toHaveBeenCalledWith(true));
    expect(mockSyncLinkedAccountToIC).toHaveBeenCalledWith({ fake: true }, null, true);
    // Client state was NOT set before the canister write resolved:
    // setBriefingShareEnabled(true) must be the only call (no premature flip).
    expect(mockSetBriefingShareEnabled).toHaveBeenCalledTimes(1);
  });

  it("ON failure: does NOT flip client state and shows an error", async () => {
    mockSyncLinkedAccountToIC.mockResolvedValue(false);
    render(<AgentSection />);
    fireEvent.click(toggle());
    await waitFor(() => expect(mockSyncLinkedAccountToIC).toHaveBeenCalled());
    expect(mockSetBriefingShareEnabled).not.toHaveBeenCalled();
    expect(await screen.findByText(/Could not enable sharing/)).toBeInTheDocument();
  });

  it("OFF: flips client state immediately, then writes the canister purge and clears the pending flag", async () => {
    mockBriefingShareEnabled = true;
    mockSyncLinkedAccountToIC.mockResolvedValue(true);
    render(<AgentSection />);
    fireEvent.click(toggle());
    // Immediate local stop — before the canister write resolves — with the
    // durable opt-out recorded in case the write never lands.
    expect(mockSetBriefingShareEnabled).toHaveBeenCalledWith(false);
    expect(localStorage.getItem("aegis-briefing-share-pending-off:principal-abc")).toBe("1");
    await waitFor(() => expect(mockSyncLinkedAccountToIC).toHaveBeenCalledWith({ fake: true }, null, false));
    await waitFor(() => expect(localStorage.getItem("aegis-briefing-share-pending-off:principal-abc")).toBeNull());
  });

  it("OFF failure: keeps local state off, keeps the pending opt-out flag, surfaces the retry warning", async () => {
    mockBriefingShareEnabled = true;
    mockSyncLinkedAccountToIC.mockResolvedValue(false);
    render(<AgentSection />);
    fireEvent.click(toggle());
    expect(mockSetBriefingShareEnabled).toHaveBeenCalledWith(false);
    expect(await screen.findByText(/may not be purged yet/)).toBeInTheDocument();
    // The un-acknowledged opt-out survives so the next load doesn't silently
    // restore sharing-ON from the still-true on-chain flag.
    expect(localStorage.getItem("aegis-briefing-share-pending-off:principal-abc")).toBe("1");
  });

  it("uses the freshest ON-CHAIN linked account for the write, not stale local storage", async () => {
    // Local storage says "no linked account" but the canister has one — the
    // wholesale saveUserSettings put must carry the on-chain account or it
    // would wipe the user's linked Nostr account.
    const icAccount = { npub: "npub1abc", pubkeyHex: "ff".repeat(32), linkedAt: 1, followCount: 0 };
    mockLoadSettingsFromIC.mockResolvedValue({ ok: true, settings: { account: icAccount, d2aEnabled: false } });
    mockSyncLinkedAccountToIC.mockResolvedValue(true);
    render(<AgentSection />);
    fireEvent.click(toggle());
    await waitFor(() => expect(mockSyncLinkedAccountToIC).toHaveBeenCalledWith({ fake: true }, icAccount, true));
  });

  it("falls back to the local account when no settings exist on-chain yet", async () => {
    const localAccount = { npub: "npub1local", pubkeyHex: "aa".repeat(32), linkedAt: 1, followCount: 0 };
    mockLinkedAccount = localAccount;
    mockLoadSettingsFromIC.mockResolvedValue({ ok: true, settings: null });
    mockSyncLinkedAccountToIC.mockResolvedValue(true);
    render(<AgentSection />);
    fireEvent.click(toggle());
    await waitFor(() => expect(mockSyncLinkedAccountToIC).toHaveBeenCalledWith({ fake: true }, localAccount, true));
  });

  it("aborts the write (no clobber) when the on-chain settings READ fails", async () => {
    // ok:false ≠ "no settings": the canister may hold a linked account the
    // client couldn't see — a wholesale put with a null account would wipe it.
    mockLoadSettingsFromIC.mockResolvedValue({ ok: false });
    render(<AgentSection />);
    fireEvent.click(toggle());
    expect(await screen.findByText(/Could not load current settings/)).toBeInTheDocument();
    expect(mockSyncLinkedAccountToIC).not.toHaveBeenCalled();
    expect(mockSetBriefingShareEnabled).not.toHaveBeenCalled();
  });

  it("OFF with a failed settings read: local off + pending flag stick, write aborted", async () => {
    mockBriefingShareEnabled = true;
    mockLoadSettingsFromIC.mockResolvedValue({ ok: false });
    render(<AgentSection />);
    fireEvent.click(toggle());
    expect(mockSetBriefingShareEnabled).toHaveBeenCalledWith(false);
    expect(await screen.findByText(/Could not load current settings/)).toBeInTheDocument();
    expect(mockSyncLinkedAccountToIC).not.toHaveBeenCalled();
    // Durable opt-out remains so restore retries the purge next load.
    expect(localStorage.getItem("aegis-briefing-share-pending-off:principal-abc")).toBe("1");
  });

  it("is disabled when signed out", () => {
    mockAuthValue = { isAuthenticated: false, identity: null, principalText: null };
    render(<AgentSection />);
    expect(toggle()).toBeDisabled();
    fireEvent.click(toggle());
    expect(mockSyncLinkedAccountToIC).not.toHaveBeenCalled();
    expect(mockSetBriefingShareEnabled).not.toHaveBeenCalled();
  });
});
