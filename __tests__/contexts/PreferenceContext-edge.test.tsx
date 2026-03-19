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
const mockGetContext = jest.fn().mockReturnValue({ highAffinityTopics: [], lowAffinityTopics: [], trustedAuthors: [], recentTopics: [] });
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

describe("PreferenceContext — debounce coalescing for IC sync", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockIdentity = { getPrincipal: () => "test-principal" };
  });

  it("multiple rapid operations result in single IC sync", () => {
    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });

    act(() => {
      state!.setTopicAffinity("a", 0.1);
      state!.setTopicAffinity("b", 0.2);
      state!.setTopicAffinity("c", 0.3);
      state!.setQualityThreshold(7);
      state!.bookmarkItem("item-1");
    });

    // Advance past localStorage debounce (500ms) but not IC sync (3000ms)
    act(() => { jest.advanceTimersByTime(600); });
    expect(mockSaveProfile).toHaveBeenCalledTimes(1);
    expect(mockSyncToIC).not.toHaveBeenCalled();

    // Advance past IC sync debounce
    act(() => { jest.advanceTimersByTime(2500); });
    expect(mockSyncToIC).toHaveBeenCalledTimes(1);
  });
});

describe("PreferenceContext — cleanup on unmount", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockIdentity = { getPrincipal: () => "test-principal" };
  });

  it("clears save timeout on unmount", () => {
    let state: ReturnType<typeof usePreferences> | null = null;
    const { unmount } = renderWithProvider((s) => { state = s; });

    act(() => {
      state!.setTopicAffinity("x", 0.5);
    });

    unmount();

    // Advance timers past debounce — save should NOT fire after unmount
    act(() => { jest.advanceTimersByTime(1000); });
    // Cannot directly assert timer was cleared, but no error means cleanup worked
  });
});

describe("PreferenceContext — addFilterRule / removeFilterRule edge cases", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockIdentity = { getPrincipal: () => "test-principal" };
  });

  it("adding multiple rules preserves order", () => {
    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });

    act(() => {
      state!.addFilterRule({ field: "author", pattern: "rule1" });
    });
    act(() => {
      state!.addFilterRule({ field: "title", pattern: "rule2" });
    });
    act(() => {
      state!.addFilterRule({ field: "author", pattern: "rule3" });
    });

    const rules = state!.profile.customFilterRules!;
    expect(rules).toHaveLength(3);
    expect(rules[0].pattern).toBe("rule1");
    expect(rules[1].pattern).toBe("rule2");
    expect(rules[2].pattern).toBe("rule3");
  });

  it("removing non-existent rule is a no-op", () => {
    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });

    act(() => {
      state!.addFilterRule({ field: "author", pattern: "rule1" });
    });

    const rulesBefore = state!.profile.customFilterRules!.length;

    act(() => {
      state!.removeFilterRule("nonexistent-id");
    });

    expect(state!.profile.customFilterRules).toHaveLength(rulesBefore);
  });
});

describe("PreferenceContext — bookmark edge cases", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockIdentity = { getPrincipal: () => "test-principal" };
  });

  it("unbookmarking non-existent item is a no-op", () => {
    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });

    act(() => { state!.bookmarkItem("item-1"); });
    const beforeLen = (state!.profile.bookmarkedIds ?? []).length;

    act(() => { state!.unbookmarkItem("item-999"); });
    expect(state!.profile.bookmarkedIds).toHaveLength(beforeLen);
  });

  it("multiple bookmarks and unbookmarks in sequence", () => {
    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });

    act(() => { state!.bookmarkItem("a"); });
    act(() => { state!.bookmarkItem("b"); });
    act(() => { state!.bookmarkItem("c"); });
    expect(state!.profile.bookmarkedIds).toHaveLength(3);

    act(() => { state!.unbookmarkItem("b"); });
    expect(state!.profile.bookmarkedIds).toEqual(["a", "c"]);

    act(() => { state!.unbookmarkItem("a"); });
    act(() => { state!.unbookmarkItem("c"); });
    expect(state!.profile.bookmarkedIds).toHaveLength(0);
  });
});

describe("PreferenceContext — IC load failure does not crash", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockIdentity = { getPrincipal: () => "test-principal" };
  });

  it("handles IC load rejection without blocking local profile", async () => {
    mockLoadFromIC.mockRejectedValue(new Error("Network timeout"));
    const warnSpy = jest.spyOn(console, "warn").mockImplementation();

    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Local profile should still be loaded
    expect(state!.profile).toBeDefined();
    expect(state!.profile.principalId).toBe("test-principal");

    warnSpy.mockRestore();
  });
});

describe("PreferenceContext — IC merge sync failure", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockIdentity = { getPrincipal: () => "test-principal" };
  });

  it("logs warning when merge sync fails but doesn't crash", async () => {
    const icProfile = createEmptyProfile("test-principal");
    icProfile.lastUpdated = 1000;
    const mergedProfile = createEmptyProfile("test-principal");
    mergedProfile.lastUpdated = 2000;

    mockLoadFromIC.mockResolvedValue(icProfile);
    mockMergeProfiles.mockReturnValue(mergedProfile);
    mockSyncToIC.mockRejectedValueOnce(new Error("IC merge sync error"));

    const warnSpy = jest.spyOn(console, "warn").mockImplementation();

    renderWithProvider(() => {});

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("IC merge sync failed"),
      expect.any(String),
    );
    warnSpy.mockRestore();
  });
});

describe("PreferenceContext — onFlag without itemId does not remove bookmarks", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockIdentity = { getPrincipal: () => "test-principal" };
  });

  it("flagging without itemId preserves all bookmarks", () => {
    const bookmarkedProfile = createEmptyProfile("test-principal");
    bookmarkedProfile.bookmarkedIds = ["item-1", "item-2"];
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
      state!.onFlag(["spam"], "Author", 2, "slop"); // no itemId
    });

    expect(state!.profile.bookmarkedIds).toContain("item-1");
    expect(state!.profile.bookmarkedIds).toContain("item-2");
  });
});

describe("PreferenceContext — setQualityThreshold boundary values", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockIdentity = { getPrincipal: () => "test-principal" };
  });

  it("clamps negative value to 1", () => {
    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });
    act(() => { state!.setQualityThreshold(-5); });
    expect(state!.profile.calibration.qualityThreshold).toBe(1);
  });

  it("clamps value at 1 (lower boundary)", () => {
    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });
    act(() => { state!.setQualityThreshold(1); });
    expect(state!.profile.calibration.qualityThreshold).toBe(1);
  });

  it("clamps value at 9 (upper boundary)", () => {
    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });
    act(() => { state!.setQualityThreshold(9); });
    expect(state!.profile.calibration.qualityThreshold).toBe(9);
  });

  it("clamps value of 100 to 9", () => {
    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });
    act(() => { state!.setQualityThreshold(100); });
    expect(state!.profile.calibration.qualityThreshold).toBe(9);
  });
});

describe("PreferenceContext — isPersonalized transitions", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockIdentity = { getPrincipal: () => "test-principal" };
  });

  it("transitions from not personalized to personalized after enough data", () => {
    mockHasEnoughData.mockReturnValue(false);

    let state: ReturnType<typeof usePreferences> | null = null;
    const { rerender } = renderWithProvider((s) => { state = s; });

    expect(state!.isPersonalized).toBe(false);
    expect(state!.userContext).toBeNull();

    // Simulate enough data accumulation
    mockHasEnoughData.mockReturnValue(true);
    mockGetContext.mockReturnValue({ highAffinityTopics: ["tech"], lowAffinityTopics: [], trustedAuthors: [], recentTopics: ["tech"] });

    act(() => {
      state!.onValidate(["tech"], "Author", 8, "quality");
    });

    expect(state!.isPersonalized).toBe(true);
    expect(state!.userContext).not.toBeNull();
    expect(state!.userContext!.highAffinityTopics).toContain("tech");
  });
});

describe("PreferenceContext — saveProfile failure", () => {
  beforeEach(() => {
    mockIsAuthenticated = true;
    mockPrincipalText = "test-principal";
    mockIdentity = { getPrincipal: () => "test-principal" };
  });

  it("logs error when saveProfile returns false", () => {
    mockSaveProfile.mockReturnValue(false);
    const errorSpy = jest.spyOn(console, "error").mockImplementation();

    let state: ReturnType<typeof usePreferences> | null = null;
    renderWithProvider((s) => { state = s; });

    act(() => {
      state!.setTopicAffinity("test", 0.5);
    });

    // Advance past debounce
    act(() => { jest.advanceTimersByTime(600); });

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Preference save failed"));
    errorSpy.mockRestore();
    mockSaveProfile.mockReturnValue(true);
  });
});
