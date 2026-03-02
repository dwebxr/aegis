/**
 * @jest-environment jsdom
 */
import { isValidProfile, mergeProfiles, loadProfile, saveProfile } from "@/lib/preferences/storage";
import { createEmptyProfile } from "@/lib/preferences/types";

function validProfileData() {
  return {
    version: 1,
    principalId: "abc-123",
    topicAffinities: { tech: 0.5, crypto: -0.3 },
    authorTrust: {
      "Alice": { validates: 5, flags: 0, trust: 0.8 },
    },
    calibration: { qualityThreshold: 4.0 },
    recentTopics: [
      { topic: "tech", timestamp: Date.now() },
    ],
    totalValidated: 10,
    totalFlagged: 2,
    lastUpdated: Date.now(),
  };
}

describe("isValidProfile — boundary and edge cases", () => {
  it("accepts a fully valid profile", () => {
    expect(isValidProfile(validProfileData())).toBe(true);
  });

  it("rejects null", () => {
    expect(isValidProfile(null)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isValidProfile(undefined)).toBe(false);
  });

  it("rejects string", () => {
    expect(isValidProfile("not an object")).toBe(false);
  });

  it("rejects array", () => {
    expect(isValidProfile([1, 2, 3])).toBe(false);
  });

  it("rejects wrong version", () => {
    const data = validProfileData();
    data.version = 2 as unknown as 1;
    expect(isValidProfile(data)).toBe(false);
  });

  it("rejects missing principalId", () => {
    const data = validProfileData();
    (data as Record<string, unknown>).principalId = 123;
    expect(isValidProfile(data)).toBe(false);
  });

  it("rejects topicAffinities with non-number values", () => {
    const data = validProfileData();
    (data.topicAffinities as Record<string, unknown>)["bad"] = "string";
    expect(isValidProfile(data)).toBe(false);
  });

  it("rejects topicAffinities as array", () => {
    const data = validProfileData();
    (data as Record<string, unknown>).topicAffinities = [1, 2];
    expect(isValidProfile(data)).toBe(false);
  });

  it("rejects topicAffinities as null", () => {
    const data = validProfileData();
    (data as Record<string, unknown>).topicAffinities = null;
    expect(isValidProfile(data)).toBe(false);
  });

  it("accepts empty topicAffinities", () => {
    const data = validProfileData();
    data.topicAffinities = {};
    expect(isValidProfile(data)).toBe(true);
  });

  it("rejects authorTrust with invalid entry", () => {
    const data = validProfileData();
    (data.authorTrust as Record<string, unknown>)["Bad"] = { validates: "not-number", flags: 0, trust: 0 };
    expect(isValidProfile(data)).toBe(false);
  });

  it("rejects authorTrust entry as array", () => {
    const data = validProfileData();
    (data.authorTrust as Record<string, unknown>)["Bad"] = [1, 2, 3];
    expect(isValidProfile(data)).toBe(false);
  });

  it("rejects authorTrust entry as null", () => {
    const data = validProfileData();
    (data.authorTrust as Record<string, unknown>)["Bad"] = null;
    expect(isValidProfile(data)).toBe(false);
  });

  it("rejects missing calibration", () => {
    const data = validProfileData();
    (data as Record<string, unknown>).calibration = undefined;
    expect(isValidProfile(data)).toBe(false);
  });

  it("rejects calibration without qualityThreshold", () => {
    const data = validProfileData();
    (data as Record<string, unknown>).calibration = { other: true };
    expect(isValidProfile(data)).toBe(false);
  });

  it("rejects recentTopics as non-array", () => {
    const data = validProfileData();
    (data as Record<string, unknown>).recentTopics = "not-array";
    expect(isValidProfile(data)).toBe(false);
  });

  it("rejects recentTopics entry without topic string", () => {
    const data = validProfileData();
    data.recentTopics = [{ topic: 123, timestamp: Date.now() } as unknown as { topic: string; timestamp: number }];
    expect(isValidProfile(data)).toBe(false);
  });

  it("rejects recentTopics entry without timestamp", () => {
    const data = validProfileData();
    data.recentTopics = [{ topic: "tech" } as unknown as { topic: string; timestamp: number }];
    expect(isValidProfile(data)).toBe(false);
  });

  it("rejects missing totalValidated", () => {
    const data = validProfileData();
    (data as Record<string, unknown>).totalValidated = "x";
    expect(isValidProfile(data)).toBe(false);
  });

  it("rejects missing lastUpdated", () => {
    const data = validProfileData();
    (data as Record<string, unknown>).lastUpdated = undefined;
    expect(isValidProfile(data)).toBe(false);
  });

  // Optional field validation
  it("accepts valid customFilterRules", () => {
    const data = validProfileData();
    (data as Record<string, unknown>).customFilterRules = [
      { id: "r1", pattern: "spam", field: "title", createdAt: Date.now() },
    ];
    expect(isValidProfile(data)).toBe(true);
  });

  it("rejects customFilterRules with invalid field", () => {
    const data = validProfileData();
    (data as Record<string, unknown>).customFilterRules = [
      { id: "r1", pattern: "spam", field: "body", createdAt: Date.now() },
    ];
    expect(isValidProfile(data)).toBe(false);
  });

  it("rejects customFilterRules missing id", () => {
    const data = validProfileData();
    (data as Record<string, unknown>).customFilterRules = [
      { pattern: "spam", field: "title", createdAt: Date.now() },
    ];
    expect(isValidProfile(data)).toBe(false);
  });

  it("accepts valid activityHistogram", () => {
    const data = validProfileData();
    (data as Record<string, unknown>).activityHistogram = {
      hourCounts: new Array(24).fill(0),
      lastActivityAt: Date.now(),
      totalEvents: 50,
    };
    expect(isValidProfile(data)).toBe(true);
  });

  it("rejects activityHistogram with wrong hourCounts length", () => {
    const data = validProfileData();
    (data as Record<string, unknown>).activityHistogram = {
      hourCounts: new Array(12).fill(0), // Should be 24
      lastActivityAt: Date.now(),
      totalEvents: 50,
    };
    expect(isValidProfile(data)).toBe(false);
  });

  it("rejects activityHistogram with non-number in hourCounts", () => {
    const data = validProfileData();
    const counts = new Array(24).fill(0);
    counts[5] = "bad";
    (data as Record<string, unknown>).activityHistogram = {
      hourCounts: counts,
      lastActivityAt: Date.now(),
      totalEvents: 50,
    };
    expect(isValidProfile(data)).toBe(false);
  });

  it("accepts valid bookmarkedIds", () => {
    const data = validProfileData();
    (data as Record<string, unknown>).bookmarkedIds = ["id1", "id2"];
    expect(isValidProfile(data)).toBe(true);
  });

  it("rejects bookmarkedIds with non-string entry", () => {
    const data = validProfileData();
    (data as Record<string, unknown>).bookmarkedIds = ["id1", 42];
    expect(isValidProfile(data)).toBe(false);
  });

  it("accepts valid notificationPrefs", () => {
    const data = validProfileData();
    (data as Record<string, unknown>).notificationPrefs = {
      topicAlerts: ["tech"],
      minScoreAlert: 7,
      d2aAlerts: true,
    };
    expect(isValidProfile(data)).toBe(true);
  });

  it("rejects notificationPrefs with non-string topicAlerts", () => {
    const data = validProfileData();
    (data as Record<string, unknown>).notificationPrefs = {
      topicAlerts: [123],
    };
    expect(isValidProfile(data)).toBe(false);
  });

  it("rejects notificationPrefs with non-number minScoreAlert", () => {
    const data = validProfileData();
    (data as Record<string, unknown>).notificationPrefs = {
      minScoreAlert: "high",
    };
    expect(isValidProfile(data)).toBe(false);
  });

  it("rejects notificationPrefs with non-boolean d2aAlerts", () => {
    const data = validProfileData();
    (data as Record<string, unknown>).notificationPrefs = {
      d2aAlerts: "yes",
    };
    expect(isValidProfile(data)).toBe(false);
  });
});

describe("loadProfile / saveProfile", () => {
  beforeEach(() => localStorage.clear());

  it("returns empty profile for unknown principal", () => {
    const profile = loadProfile("unknown-id");
    expect(profile.principalId).toBe("unknown-id");
    expect(profile.totalValidated).toBe(0);
  });

  it("roundtrips a saved profile", () => {
    const profile = createEmptyProfile("user-1");
    profile.totalValidated = 5;
    profile.topicAffinities = { ai: 0.7 };
    saveProfile(profile);

    const loaded = loadProfile("user-1");
    expect(loaded.totalValidated).toBe(5);
    expect(loaded.topicAffinities.ai).toBe(0.7);
  });

  it("returns empty profile for corrupted localStorage data", () => {
    localStorage.setItem("aegis_prefs_bad-user", "not-json");
    const profile = loadProfile("bad-user");
    expect(profile.principalId).toBe("bad-user");
    expect(profile.totalValidated).toBe(0);
  });

  it("returns empty profile for structurally invalid stored data", () => {
    localStorage.setItem("aegis_prefs_bad2", JSON.stringify({ version: 999 }));
    const profile = loadProfile("bad2");
    expect(profile.principalId).toBe("bad2");
    expect(profile.totalValidated).toBe(0);
  });

  it("returns empty profile if stored principalId mismatches", () => {
    const profile = createEmptyProfile("user-a");
    saveProfile(profile);
    // Try loading with different ID
    const loaded = loadProfile("user-b");
    expect(loaded.principalId).toBe("user-b");
  });
});

describe("mergeProfiles", () => {
  it("IC wins when local is empty", () => {
    const local = createEmptyProfile("user");
    const ic = { ...createEmptyProfile("user"), totalValidated: 10, lastUpdated: 100 };
    const result = mergeProfiles(local, ic);
    expect(result.totalValidated).toBe(10);
  });

  it("IC wins when it has newer lastUpdated", () => {
    const local = { ...createEmptyProfile("user"), totalValidated: 5, lastUpdated: 100, topicAffinities: { a: 1 } };
    const ic = { ...createEmptyProfile("user"), totalValidated: 10, lastUpdated: 200, topicAffinities: { b: 1 } };
    const result = mergeProfiles(local, ic);
    expect(result.totalValidated).toBe(10);
    expect(result.topicAffinities).toEqual({ b: 1 });
  });

  it("local wins when it has newer lastUpdated and data", () => {
    const local = { ...createEmptyProfile("user"), totalValidated: 5, lastUpdated: 200, topicAffinities: { a: 1 } };
    const ic = { ...createEmptyProfile("user"), totalValidated: 10, lastUpdated: 100 };
    const result = mergeProfiles(local, ic);
    expect(result.totalValidated).toBe(5);
  });

  it("preserves local principalId even when IC wins", () => {
    const local = createEmptyProfile("local-id");
    const ic = { ...createEmptyProfile("ic-id"), totalValidated: 10, lastUpdated: 200 };
    const result = mergeProfiles(local, ic);
    expect(result.principalId).toBe("local-id");
  });
});
