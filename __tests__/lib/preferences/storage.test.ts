/**
 * @jest-environment jsdom
 */
import { loadProfile, saveProfile, isValidProfile } from "@/lib/preferences/storage";
import { createEmptyProfile } from "@/lib/preferences/types";
import type { UserPreferenceProfile } from "@/lib/preferences/types";

describe("preferences/storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("loadProfile", () => {
    it("returns empty profile when no data stored", () => {
      const p = loadProfile("abc-123");
      expect(p.principalId).toBe("abc-123");
      expect(p.version).toBe(1);
      expect(p.totalValidated).toBe(0);
      expect(p.totalFlagged).toBe(0);
      expect(p.topicAffinities).toEqual({});
    });

    it("loads a previously saved profile", () => {
      const profile = createEmptyProfile("user-1");
      profile.totalValidated = 42;
      profile.topicAffinities = { ai: 0.8, crypto: -0.5 };
      saveProfile(profile);

      const loaded = loadProfile("user-1");
      expect(loaded.totalValidated).toBe(42);
      expect(loaded.topicAffinities.ai).toBe(0.8);
      expect(loaded.topicAffinities.crypto).toBe(-0.5);
    });

    it("rejects profile with wrong version", () => {
      const profile = createEmptyProfile("user-1") as unknown as Record<string, unknown>;
      profile.version = 99;
      localStorage.setItem("aegis_prefs_user-1", JSON.stringify(profile));

      const loaded = loadProfile("user-1");
      expect(loaded.totalValidated).toBe(0); // fresh empty profile
      expect(loaded.principalId).toBe("user-1");
    });

    it("rejects profile with mismatched principalId", () => {
      const profile = createEmptyProfile("other-user");
      localStorage.setItem("aegis_prefs_user-1", JSON.stringify(profile));

      const loaded = loadProfile("user-1");
      expect(loaded.principalId).toBe("user-1"); // returns new empty, not the stored one
    });

    it("returns empty profile on corrupted JSON", () => {
      localStorage.setItem("aegis_prefs_user-1", "not valid json{{{");
      const loaded = loadProfile("user-1");
      expect(loaded.principalId).toBe("user-1");
      expect(loaded.version).toBe(1);
    });

    it("returns empty profile on non-object JSON", () => {
      localStorage.setItem("aegis_prefs_user-1", '"just a string"');
      const loaded = loadProfile("user-1");
      expect(loaded.principalId).toBe("user-1");
    });

    it("returns empty profile when calibration is missing", () => {
      localStorage.setItem("aegis_prefs_user-1", JSON.stringify({
        version: 1,
        principalId: "user-1",
        topicAffinities: {},
        authorTrust: {},
        recentTopics: [],
        totalValidated: 0,
        totalFlagged: 0,
        lastUpdated: 1,
      }));
      const loaded = loadProfile("user-1");
      expect(loaded.calibration.qualityThreshold).toBe(4.0);
    });

    it("returns empty profile when recentTopics is not an array", () => {
      localStorage.setItem("aegis_prefs_user-1", JSON.stringify({
        version: 1,
        principalId: "user-1",
        topicAffinities: {},
        authorTrust: {},
        calibration: { qualityThreshold: 4 },
        recentTopics: "not an array",
        totalValidated: 0,
        totalFlagged: 0,
        lastUpdated: 1,
      }));
      const loaded = loadProfile("user-1");
      expect(loaded.recentTopics).toEqual([]);
    });

    it("rejects topicAffinities with non-number values", () => {
      localStorage.setItem("aegis_prefs_user-1", JSON.stringify({
        version: 1,
        principalId: "user-1",
        topicAffinities: { ai: "high" },
        authorTrust: {},
        calibration: { qualityThreshold: 4 },
        recentTopics: [],
        totalValidated: 0,
        totalFlagged: 0,
        lastUpdated: 1,
      }));
      const loaded = loadProfile("user-1");
      expect(loaded.topicAffinities).toEqual({}); // fresh empty
    });

    it("rejects authorTrust with invalid structure", () => {
      localStorage.setItem("aegis_prefs_user-1", JSON.stringify({
        version: 1,
        principalId: "user-1",
        topicAffinities: {},
        authorTrust: { alice: "trusted" },
        calibration: { qualityThreshold: 4 },
        recentTopics: [],
        totalValidated: 0,
        totalFlagged: 0,
        lastUpdated: 1,
      }));
      const loaded = loadProfile("user-1");
      expect(loaded.authorTrust).toEqual({});
    });

    it("rejects recentTopics with invalid elements", () => {
      localStorage.setItem("aegis_prefs_user-1", JSON.stringify({
        version: 1,
        principalId: "user-1",
        topicAffinities: {},
        authorTrust: {},
        calibration: { qualityThreshold: 4 },
        recentTopics: [{ topic: 123 }],
        totalValidated: 0,
        totalFlagged: 0,
        lastUpdated: 1,
      }));
      const loaded = loadProfile("user-1");
      expect(loaded.recentTopics).toEqual([]);
    });

    it("uses principal-specific storage keys", () => {
      const p1 = createEmptyProfile("user-a");
      p1.totalValidated = 10;
      saveProfile(p1);

      const p2 = createEmptyProfile("user-b");
      p2.totalValidated = 20;
      saveProfile(p2);

      expect(loadProfile("user-a").totalValidated).toBe(10);
      expect(loadProfile("user-b").totalValidated).toBe(20);
    });
  });

  describe("saveProfile", () => {
    it("returns true on success", () => {
      const profile = createEmptyProfile("user-1");
      expect(saveProfile(profile)).toBe(true);
    });

    it("persists data to localStorage", () => {
      const profile = createEmptyProfile("user-1");
      profile.totalValidated = 7;
      saveProfile(profile);

      const raw = localStorage.getItem("aegis_prefs_user-1");
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!) as UserPreferenceProfile;
      expect(parsed.totalValidated).toBe(7);
    });

    it("overwrites previous data", () => {
      const profile = createEmptyProfile("user-1");
      profile.totalValidated = 1;
      saveProfile(profile);

      profile.totalValidated = 2;
      saveProfile(profile);

      expect(loadProfile("user-1").totalValidated).toBe(2);
    });

    it("handles localStorage error gracefully", () => {
      const profile = createEmptyProfile("user-1");
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = () => { throw new Error("QuotaExceeded"); };

      expect(saveProfile(profile)).toBe(false);

      Storage.prototype.setItem = originalSetItem;
    });
  });

  describe("isValidProfile", () => {
    const validBase = {
      version: 1,
      principalId: "user-1",
      topicAffinities: { ai: 0.5 },
      authorTrust: { alice: { validates: 3, flags: 0, trust: 0.6 } },
      calibration: { qualityThreshold: 4 },
      recentTopics: [{ topic: "ai", timestamp: 1000 }],
      totalValidated: 10,
      totalFlagged: 2,
      lastUpdated: Date.now(),
    };

    it("accepts a valid profile", () => {
      expect(isValidProfile(validBase)).toBe(true);
    });

    it("accepts empty collections", () => {
      expect(isValidProfile({ ...validBase, topicAffinities: {}, authorTrust: {}, recentTopics: [] })).toBe(true);
    });

    it("rejects null", () => expect(isValidProfile(null)).toBe(false));
    it("rejects string", () => expect(isValidProfile("hello")).toBe(false));
    it("rejects array", () => expect(isValidProfile([])).toBe(false));

    it("rejects topicAffinities with string value", () => {
      expect(isValidProfile({ ...validBase, topicAffinities: { ai: "high" } })).toBe(false);
    });

    it("rejects authorTrust with string value", () => {
      expect(isValidProfile({ ...validBase, authorTrust: { alice: "trusted" } })).toBe(false);
    });

    it("rejects authorTrust missing trust field", () => {
      expect(isValidProfile({ ...validBase, authorTrust: { alice: { validates: 1, flags: 0 } } })).toBe(false);
    });

    it("rejects recentTopics with invalid element", () => {
      expect(isValidProfile({ ...validBase, recentTopics: [{ topic: 123 }] })).toBe(false);
    });

    it("rejects missing totalValidated", () => {
      const { totalValidated: _, ...rest } = validBase;
      expect(isValidProfile(rest)).toBe(false);
    });

    it("rejects missing lastUpdated", () => {
      const { lastUpdated: _, ...rest } = validBase;
      expect(isValidProfile(rest)).toBe(false);
    });
  });

  describe("roundtrip integrity", () => {
    it("preserves all profile fields through save/load", () => {
      const profile = createEmptyProfile("roundtrip-user");
      profile.topicAffinities = { ml: 0.9, politics: -0.3 };
      profile.authorTrust = { alice: { validates: 5, flags: 1, trust: 0.6 } };
      profile.calibration = { qualityThreshold: 5.0 };
      profile.recentTopics = [{ topic: "ai", timestamp: 1000 }];
      profile.totalValidated = 100;
      profile.totalFlagged = 25;

      saveProfile(profile);
      const loaded = loadProfile("roundtrip-user");

      expect(loaded.topicAffinities).toEqual(profile.topicAffinities);
      expect(loaded.authorTrust).toEqual(profile.authorTrust);
      expect(loaded.calibration).toEqual(profile.calibration);
      expect(loaded.recentTopics).toEqual(profile.recentTopics);
      expect(loaded.totalValidated).toBe(100);
      expect(loaded.totalFlagged).toBe(25);
    });
  });
});
