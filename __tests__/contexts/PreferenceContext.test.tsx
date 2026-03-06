/**
 * @jest-environment jsdom
 */

// Polyfill structuredClone for jsdom
if (typeof globalThis.structuredClone === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  globalThis.structuredClone = ((val: any) => JSON.parse(JSON.stringify(val))) as typeof structuredClone;
}

import React from "react";
import { render, act } from "@testing-library/react";
import type { UserPreferenceProfile } from "@/lib/preferences/types";
import { createEmptyProfile } from "@/lib/preferences/types";

// ─── Mocks ───────────────────────────────────────────────────────────

let mockIsAuthenticated = false;
let mockPrincipalText: string | null = null;
let mockIdentity: { [key: string]: unknown } | null = null;

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: mockIsAuthenticated,
    principalText: mockPrincipalText,
    identity: mockIdentity,
  }),
}));

const mockLoadProfile = jest.fn(
  (pid: string) => createEmptyProfile(pid),
);
const mockSaveProfile = jest.fn().mockReturnValue(true);
const mockSyncToIC = jest.fn().mockResolvedValue(true);
const mockLoadFromIC = jest.fn().mockResolvedValue(null);
const mockMergeProfiles = jest.fn(
  (local: UserPreferenceProfile, _ic: UserPreferenceProfile) => local,
);

jest.mock("@/lib/preferences/storage", () => ({
  loadProfile: (...args: unknown[]) => mockLoadProfile(args[0] as string),
  saveProfile: (...args: unknown[]) => mockSaveProfile(...args),
  syncPreferencesToIC: (pid: string, p: unknown) => mockSyncToIC(pid, p),
  loadPreferencesFromIC: (pid: string) => mockLoadFromIC(pid),
  mergeProfiles: (a: unknown, b: unknown) => mockMergeProfiles(a as UserPreferenceProfile, b as UserPreferenceProfile),
}));

const mockLearn = jest.fn((profile: UserPreferenceProfile, _event: unknown) => ({
  ...profile,
  totalValidated: profile.totalValidated + 1,
  lastUpdated: Date.now(),
}));
const mockGetContext = jest.fn().mockReturnValue({
  highAffinityTopics: ["ai"],
  lowAffinityTopics: [],
  trustedAuthors: [],
  recentTopics: ["ai"],
});
const mockHasEnoughData = jest.fn().mockReturnValue(false);

jest.mock("@/lib/preferences/engine", () => ({
  learn: (p: unknown, event: unknown) => mockLearn(p as UserPreferenceProfile, event),
  getContext: (p: unknown) => mockGetContext(p),
  hasEnoughData: (p: unknown) => mockHasEnoughData(p),
}));

jest.mock("@/lib/sources/discovery", () => ({
  trackDomainValidation: jest.fn(),
}));

jest.mock("@/lib/utils/math", () => ({
  clamp: (v: number, min: number, max: number) => Math.min(Math.max(v, min), max),
}));

jest.mock("@/lib/utils/errors", () => ({
  errMsg: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

import { PreferenceProvider, usePreferences } from "@/contexts/PreferenceContext";
import { trackDomainValidation } from "@/lib/sources/discovery";

// Helper to capture context values
function Consumer({ onRender }: { onRender: (state: ReturnType<typeof usePreferences>) => void }) {
  const state = usePreferences();
  onRender(state);
  return null;
}

function renderWithProvider(onRender: (state: ReturnType<typeof usePreferences>) => void) {
  return render(
    <PreferenceProvider>
      <Consumer onRender={onRender} />
    </PreferenceProvider>,
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockIsAuthenticated = false;
  mockPrincipalText = null;
  mockIdentity = null;
  mockLoadProfile.mockImplementation((pid: string) => createEmptyProfile(pid));
  mockHasEnoughData.mockReturnValue(false);
  mockLearn.mockImplementation((profile: UserPreferenceProfile) => ({
    ...profile,
    totalValidated: profile.totalValidated + 1,
    lastUpdated: Date.now(),
  }));
  mockLoadFromIC.mockResolvedValue(null);
  mockMergeProfiles.mockImplementation((local: UserPreferenceProfile) => local);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("PreferenceContext — unauthenticated", () => {
  it("provides empty profile when not authenticated", () => {
    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });
    expect(state!.profile.principalId).toBe("");
    expect(state!.profile.totalValidated).toBe(0);
    expect(state!.isPersonalized).toBe(false);
    expect(state!.userContext).toBeNull();
  });

  it("does not load from localStorage or IC", () => {
    renderWithProvider(() => {});
    expect(mockLoadProfile).not.toHaveBeenCalled();
    expect(mockLoadFromIC).not.toHaveBeenCalled();
  });
});

describe("PreferenceContext — authenticated", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal-123";
    mockIdentity = { getPrincipal: () => "test-principal-123" };
  });

  it("loads profile from localStorage on auth", () => {
    renderWithProvider(() => {});
    expect(mockLoadProfile).toHaveBeenCalledWith("test-principal-123");
  });

  it("loads from IC and merges when IC has data", async () => {
    const icProfile = createEmptyProfile("test-principal-123");
    icProfile.totalValidated = 10;
    icProfile.lastUpdated = Date.now() - 1000;
    mockLoadFromIC.mockResolvedValue(icProfile);
    mockMergeProfiles.mockReturnValue(icProfile);

    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });

    await act(async () => {
      await Promise.resolve(); // flush loadPreferencesFromIC
    });

    expect(mockMergeProfiles).toHaveBeenCalled();
    expect(mockSaveProfile).toHaveBeenCalledWith(icProfile);
  });

  it("syncs local to IC when IC has no data but local has data", async () => {
    const localProfile = createEmptyProfile("test-principal-123");
    localProfile.totalValidated = 5;
    mockLoadProfile.mockReturnValue(localProfile);
    mockLoadFromIC.mockResolvedValue(null);

    renderWithProvider(() => {});

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockSyncToIC).toHaveBeenCalledWith(mockIdentity, localProfile);
  });

  it("does not sync to IC when both local and IC are empty", async () => {
    mockLoadFromIC.mockResolvedValue(null);
    // loadProfile returns empty by default

    renderWithProvider(() => {});

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockSyncToIC).not.toHaveBeenCalled();
  });

  it("syncs merged profile to IC when merged is newer than IC", async () => {
    const icProfile = createEmptyProfile("test-principal-123");
    icProfile.lastUpdated = 1000;

    const mergedProfile = createEmptyProfile("test-principal-123");
    mergedProfile.lastUpdated = 2000;

    mockLoadFromIC.mockResolvedValue(icProfile);
    mockMergeProfiles.mockReturnValue(mergedProfile);

    renderWithProvider(() => {});

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockSyncToIC).toHaveBeenCalledWith(mockIdentity, mergedProfile);
  });

  it("handles IC load failure gracefully", async () => {
    mockLoadFromIC.mockRejectedValue(new Error("Network error"));
    const warnSpy = jest.spyOn(console, "warn").mockImplementation();

    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Should still have a valid profile (from localStorage)
    expect(state!.profile).toBeDefined();
    warnSpy.mockRestore();
  });

  it("resets to empty profile on logout", () => {
    let state: ReturnType<typeof usePreferences> | null = null;
    const { rerender } = renderWithProvider((s) => { state = s; });

    expect(state!.profile.principalId).toBe("test-principal-123");

    // Simulate logout
    mockIsAuthenticated = false;
    mockPrincipalText = null;
    mockIdentity = null;

    rerender(
      <PreferenceProvider>
        <Consumer onRender={(s) => { state = s; }} />
      </PreferenceProvider>,
    );

    expect(state!.profile.principalId).toBe("");
    expect(state!.profile.totalValidated).toBe(0);
  });
});

describe("onValidate", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockIdentity = { getPrincipal: () => "test-principal" };
  });

  it("calls learn with validate action", () => {
    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });

    act(() => {
      state!.onValidate(["ai", "ml"], "Author A", 7, "quality", "https://example.com");
    });

    expect(mockLearn).toHaveBeenCalledWith(
      expect.any(Object),
      { action: "validate", topics: ["ai", "ml"], author: "Author A", composite: 7, verdict: "quality" },
    );
  });

  it("debounces save to localStorage", () => {
    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });

    act(() => {
      state!.onValidate(["ai"], "A", 7, "quality");
    });

    // Not saved immediately
    expect(mockSaveProfile).not.toHaveBeenCalled();

    // After debounce period
    act(() => { jest.advanceTimersByTime(600); });
    expect(mockSaveProfile).toHaveBeenCalled();
  });

  it("debounces IC sync with 3s delay", () => {
    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });

    act(() => {
      state!.onValidate(["ai"], "A", 7, "quality");
    });

    act(() => { jest.advanceTimersByTime(600); });
    // localStorage saved, but IC not yet
    expect(mockSaveProfile).toHaveBeenCalled();
    expect(mockSyncToIC).not.toHaveBeenCalled();

    act(() => { jest.advanceTimersByTime(2500); });
    expect(mockSyncToIC).toHaveBeenCalled();
  });

  it("tracks domain validation", () => {
    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });

    act(() => {
      state!.onValidate(["ai"], "A", 7, "quality", "https://example.com/article");
    });

    expect(trackDomainValidation).toHaveBeenCalledWith("https://example.com/article");
  });

  it("removes bookmark when validating a bookmarked item", () => {
    const bookmarkedProfile = createEmptyProfile("test-principal");
    bookmarkedProfile.bookmarkedIds = ["item-1", "item-2"];
    mockLoadProfile.mockReturnValue(bookmarkedProfile);

    mockLearn.mockImplementation((profile: UserPreferenceProfile) => ({
      ...profile,
      totalValidated: profile.totalValidated + 1,
      bookmarkedIds: [...(profile.bookmarkedIds ?? [])],
      lastUpdated: Date.now(),
    }));

    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });

    act(() => {
      state!.onValidate(["ai"], "A", 7, "quality", undefined, "item-1");
    });

    // The learn mock returns bookmarkedIds with item-1, then onValidate filters it out
    expect(state!.profile.bookmarkedIds).not.toContain("item-1");
    expect(state!.profile.bookmarkedIds).toContain("item-2");
  });
});

describe("onFlag", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockIdentity = { getPrincipal: () => "test-principal" };
  });

  it("calls learn with flag action", () => {
    mockLearn.mockImplementation((profile: UserPreferenceProfile) => ({
      ...profile,
      totalFlagged: profile.totalFlagged + 1,
      lastUpdated: Date.now(),
    }));

    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });

    act(() => {
      state!.onFlag(["spam"], "Bad Author", 2, "slop");
    });

    expect(mockLearn).toHaveBeenCalledWith(
      expect.any(Object),
      { action: "flag", topics: ["spam"], author: "Bad Author", composite: 2, verdict: "slop" },
    );
  });

  it("removes bookmark when flagging a bookmarked item", () => {
    const bookmarkedProfile = createEmptyProfile("test-principal");
    bookmarkedProfile.bookmarkedIds = ["flag-me"];
    mockLoadProfile.mockReturnValue(bookmarkedProfile);

    mockLearn.mockImplementation((profile: UserPreferenceProfile) => ({
      ...profile,
      totalFlagged: profile.totalFlagged + 1,
      bookmarkedIds: [...(profile.bookmarkedIds ?? [])],
      lastUpdated: Date.now(),
    }));

    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });

    act(() => {
      state!.onFlag(["spam"], "A", 2, "slop", "flag-me");
    });

    expect(state!.profile.bookmarkedIds).not.toContain("flag-me");
  });
});

describe("setTopicAffinity / removeTopicAffinity", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockIdentity = { getPrincipal: () => "test-principal" };
  });

  it("sets topic affinity clamped to [-1, 1]", () => {
    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });

    act(() => { state!.setTopicAffinity("ai", 0.8); });
    expect(state!.profile.topicAffinities["ai"]).toBe(0.8);

    act(() => { state!.setTopicAffinity("spam", -2); });
    expect(state!.profile.topicAffinities["spam"]).toBe(-1);

    act(() => { state!.setTopicAffinity("hype", 5); });
    expect(state!.profile.topicAffinities["hype"]).toBe(1);
  });

  it("removes topic affinity", () => {
    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });

    act(() => { state!.setTopicAffinity("ai", 0.5); });
    expect(state!.profile.topicAffinities["ai"]).toBe(0.5);

    act(() => { state!.removeTopicAffinity("ai"); });
    expect(state!.profile.topicAffinities["ai"]).toBeUndefined();
  });
});

describe("setQualityThreshold", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockIdentity = { getPrincipal: () => "test-principal" };
  });

  it("clamps threshold to [1, 9]", () => {
    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });

    act(() => { state!.setQualityThreshold(7); });
    expect(state!.profile.calibration.qualityThreshold).toBe(7);

    act(() => { state!.setQualityThreshold(0); });
    expect(state!.profile.calibration.qualityThreshold).toBe(1);

    act(() => { state!.setQualityThreshold(15); });
    expect(state!.profile.calibration.qualityThreshold).toBe(9);
  });
});

describe("addFilterRule / removeFilterRule", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockIdentity = { getPrincipal: () => "test-principal" };
  });

  it("adds a filter rule with auto-generated id", () => {
    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });

    act(() => {
      state!.addFilterRule({ field: "author", pattern: "spambot.*" });
    });

    const rules = state!.profile.customFilterRules!;
    expect(rules).toHaveLength(1);
    expect(rules[0].field).toBe("author");
    expect(rules[0].pattern).toBe("spambot.*");
    expect(typeof rules[0].id).toBe("string");
    expect(typeof rules[0].createdAt).toBe("number");
  });

  it("removes a filter rule by id", () => {
    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });

    act(() => {
      state!.addFilterRule({ field: "author", pattern: "rule1" });
    });

    const ruleId = state!.profile.customFilterRules![0].id;

    act(() => {
      state!.removeFilterRule(ruleId);
    });

    expect(state!.profile.customFilterRules).toHaveLength(0);
  });
});

describe("bookmarkItem / unbookmarkItem", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockIdentity = { getPrincipal: () => "test-principal" };
  });

  it("adds and removes bookmarks", () => {
    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });

    act(() => { state!.bookmarkItem("item-1"); });
    expect(state!.profile.bookmarkedIds).toContain("item-1");

    act(() => { state!.bookmarkItem("item-2"); });
    expect(state!.profile.bookmarkedIds).toHaveLength(2);

    act(() => { state!.unbookmarkItem("item-1"); });
    expect(state!.profile.bookmarkedIds).not.toContain("item-1");
    expect(state!.profile.bookmarkedIds).toContain("item-2");
  });

  it("does not duplicate bookmark", () => {
    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });

    act(() => { state!.bookmarkItem("item-1"); });
    act(() => { state!.bookmarkItem("item-1"); });
    expect(state!.profile.bookmarkedIds).toHaveLength(1);
  });
});

describe("setNotificationPrefs", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockIdentity = { getPrincipal: () => "test-principal" };
  });

  it("sets notification preferences", () => {
    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });

    act(() => {
      state!.setNotificationPrefs({
        topicAlerts: ["ai", "crypto"],
        minScoreAlert: 7,
        d2aAlerts: true,
      });
    });

    expect(state!.profile.notificationPrefs).toEqual({
      topicAlerts: ["ai", "crypto"],
      minScoreAlert: 7,
      d2aAlerts: true,
    });
  });
});

describe("isPersonalized / userContext", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockIdentity = { getPrincipal: () => "test-principal" };
  });

  it("isPersonalized is false when hasEnoughData returns false", () => {
    mockHasEnoughData.mockReturnValue(false);

    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });

    expect(state!.isPersonalized).toBe(false);
    expect(state!.userContext).toBeNull();
  });

  it("isPersonalized is true when hasEnoughData returns true", () => {
    mockHasEnoughData.mockReturnValue(true);

    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });

    expect(state!.isPersonalized).toBe(true);
    expect(state!.userContext).toEqual({
      highAffinityTopics: ["ai"],
      lowAffinityTopics: [],
      trustedAuthors: [],
      recentTopics: ["ai"],
    });
    expect(mockGetContext).toHaveBeenCalled();
  });
});

describe("debounce coalescing", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockIdentity = { getPrincipal: () => "test-principal" };
  });

  it("multiple rapid updates result in single save", () => {
    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });

    act(() => {
      state!.setTopicAffinity("a", 0.1);
      state!.setTopicAffinity("b", 0.2);
      state!.setTopicAffinity("c", 0.3);
    });

    act(() => { jest.advanceTimersByTime(600); });

    // saveProfile debounces — only the last timer fires
    // Each setTopicAffinity call schedules a new timeout (clearing previous)
    // so only 1 save should fire
    expect(mockSaveProfile).toHaveBeenCalledTimes(1);
  });
});

describe("IC sync initial upload failure", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockIdentity = { getPrincipal: () => "test-principal" };
  });

  it("logs warning when initial IC sync fails", async () => {
    const localProfile = createEmptyProfile("test-principal");
    localProfile.totalValidated = 5;
    mockLoadProfile.mockReturnValue(localProfile);
    mockLoadFromIC.mockResolvedValue(null);
    mockSyncToIC.mockRejectedValueOnce(new Error("IC unavailable"));

    const warnSpy = jest.spyOn(console, "warn").mockImplementation();
    renderWithProvider(() => {});

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("IC initial sync failed"),
      expect.any(String),
    );
    warnSpy.mockRestore();
  });
});
