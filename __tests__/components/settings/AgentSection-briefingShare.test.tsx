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
let mockBriefingShareEnabled = false;
let mockAuthValue: { isAuthenticated: boolean; identity: unknown } = {
  isAuthenticated: true,
  identity: { fake: true },
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
  getLinkedAccount: () => null,
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
  mockBriefingShareEnabled = false;
  mockAuthValue = { isAuthenticated: true, identity: { fake: true } };
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

  it("OFF: flips client state immediately, then writes the canister purge", async () => {
    mockBriefingShareEnabled = true;
    mockSyncLinkedAccountToIC.mockResolvedValue(true);
    render(<AgentSection />);
    fireEvent.click(toggle());
    // Immediate local stop — before the canister write resolves.
    expect(mockSetBriefingShareEnabled).toHaveBeenCalledWith(false);
    await waitFor(() => expect(mockSyncLinkedAccountToIC).toHaveBeenCalledWith({ fake: true }, null, false));
  });

  it("OFF failure: keeps local state off and surfaces the purge-retry warning", async () => {
    mockBriefingShareEnabled = true;
    mockSyncLinkedAccountToIC.mockResolvedValue(false);
    render(<AgentSection />);
    fireEvent.click(toggle());
    expect(mockSetBriefingShareEnabled).toHaveBeenCalledWith(false);
    expect(await screen.findByText(/may not be purged yet/)).toBeInTheDocument();
  });

  it("is disabled when signed out", () => {
    mockAuthValue = { isAuthenticated: false, identity: null };
    render(<AgentSection />);
    expect(toggle()).toBeDisabled();
    fireEvent.click(toggle());
    expect(mockSyncLinkedAccountToIC).not.toHaveBeenCalled();
    expect(mockSetBriefingShareEnabled).not.toHaveBeenCalled();
  });
});
