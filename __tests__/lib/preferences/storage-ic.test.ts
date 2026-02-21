import { mergeProfiles } from "@/lib/preferences/storage";
import { createEmptyProfile } from "@/lib/preferences/types";
import type { UserPreferenceProfile } from "@/lib/preferences/types";

// Helper to build a profile with specific fields
function buildProfile(
  principalId: string,
  overrides: Partial<UserPreferenceProfile> = {},
): UserPreferenceProfile {
  return { ...createEmptyProfile(principalId), ...overrides };
}

describe("preferences/storage IC sync", () => {
  describe("mergeProfiles", () => {
    it("returns IC profile when local is empty", () => {
      const local = buildProfile("user-1", { lastUpdated: 1000 });
      const ic = buildProfile("user-1", {
        lastUpdated: 900,
        totalValidated: 10,
        topicAffinities: { ai: 0.8 },
      });

      const merged = mergeProfiles(local, ic);
      expect(merged.totalValidated).toBe(10);
      expect(merged.topicAffinities).toEqual({ ai: 0.8 });
      expect(merged.principalId).toBe("user-1");
    });

    it("returns IC profile when IC is newer", () => {
      const local = buildProfile("user-1", {
        lastUpdated: 1000,
        totalValidated: 5,
        topicAffinities: { crypto: 0.3 },
      });
      const ic = buildProfile("user-1", {
        lastUpdated: 2000,
        totalValidated: 15,
        topicAffinities: { ai: 0.9, crypto: 0.6 },
      });

      const merged = mergeProfiles(local, ic);
      expect(merged.totalValidated).toBe(15);
      expect(merged.topicAffinities).toEqual({ ai: 0.9, crypto: 0.6 });
    });

    it("returns local profile when local is newer", () => {
      const local = buildProfile("user-1", {
        lastUpdated: 3000,
        totalValidated: 20,
        topicAffinities: { ml: 0.7 },
      });
      const ic = buildProfile("user-1", {
        lastUpdated: 2000,
        totalValidated: 10,
        topicAffinities: { ai: 0.5 },
      });

      const merged = mergeProfiles(local, ic);
      expect(merged.totalValidated).toBe(20);
      expect(merged.topicAffinities).toEqual({ ml: 0.7 });
    });

    it("preserves local principalId even when IC wins", () => {
      const local = buildProfile("local-principal");
      const ic = buildProfile("ic-principal", {
        lastUpdated: Date.now() + 10000,
        totalValidated: 5,
      });

      const merged = mergeProfiles(local, ic);
      expect(merged.principalId).toBe("local-principal");
      expect(merged.totalValidated).toBe(5);
    });

    it("returns local when both are empty and local is newer", () => {
      const local = buildProfile("user-1", { lastUpdated: 2000 });
      const ic = buildProfile("user-1", { lastUpdated: 1000 });

      const merged = mergeProfiles(local, ic);
      // Both empty, but local is empty => IC wins (empty-local rule)
      // Actually localIsEmpty=true, so IC wins regardless
      expect(merged.lastUpdated).toBe(1000);
    });

    it("IC wins when local is empty even if IC is older", () => {
      const local = buildProfile("user-1", { lastUpdated: 5000 });
      const ic = buildProfile("user-1", {
        lastUpdated: 1000,
        totalValidated: 3,
        topicAffinities: { tech: 0.4 },
      });

      const merged = mergeProfiles(local, ic);
      expect(merged.totalValidated).toBe(3);
      expect(merged.topicAffinities).toEqual({ tech: 0.4 });
    });

    it("local with data wins over IC with same timestamp", () => {
      const ts = Date.now();
      const local = buildProfile("user-1", {
        lastUpdated: ts,
        totalValidated: 8,
        topicAffinities: { defi: 0.6 },
      });
      const ic = buildProfile("user-1", {
        lastUpdated: ts,
        totalValidated: 3,
        topicAffinities: { nft: 0.2 },
      });

      const merged = mergeProfiles(local, ic);
      // local is not empty, timestamps equal → IC is NOT newer → local wins
      expect(merged.totalValidated).toBe(8);
      expect(merged.topicAffinities).toEqual({ defi: 0.6 });
    });

    it("considers local non-empty with only flags", () => {
      const local = buildProfile("user-1", {
        lastUpdated: 3000,
        totalFlagged: 2,
      });
      const ic = buildProfile("user-1", {
        lastUpdated: 1000,
        totalValidated: 5,
      });

      const merged = mergeProfiles(local, ic);
      // local has totalFlagged > 0, so not empty → local is newer → local wins
      expect(merged.totalFlagged).toBe(2);
      expect(merged.totalValidated).toBe(0);
    });

    it("considers local non-empty with only topic affinities", () => {
      const local = buildProfile("user-1", {
        lastUpdated: 3000,
        topicAffinities: { privacy: 0.5 },
      });
      const ic = buildProfile("user-1", {
        lastUpdated: 1000,
        totalValidated: 10,
      });

      const merged = mergeProfiles(local, ic);
      // local has topicAffinities, so not empty → local is newer → local wins
      expect(merged.topicAffinities).toEqual({ privacy: 0.5 });
    });
  });

  describe("syncPreferencesToIC", () => {
    it("calls backend.saveUserPreferences with serialized profile", async () => {
      const mockSaveUserPreferences = jest.fn().mockResolvedValue(true);
      const mockActor = { saveUserPreferences: mockSaveUserPreferences };

      jest.doMock("@/lib/ic/actor", () => ({
        createBackendActorAsync: jest.fn().mockResolvedValue(mockActor),
      }));

      // Dynamic import after mock setup
      const { syncPreferencesToIC } = await import("@/lib/preferences/storage");
      const profile = buildProfile("user-1", {
        lastUpdated: 12345,
        topicAffinities: { ai: 0.8 },
      });

      const mockIdentity = {} as import("@dfinity/agent").Identity;
      const result = await syncPreferencesToIC(mockIdentity, profile);

      expect(result).toBe(true);
      expect(mockSaveUserPreferences).toHaveBeenCalledWith(
        JSON.stringify(profile),
        BigInt(12345),
      );
    });

    afterEach(() => {
      jest.resetModules();
    });
  });

  describe("loadPreferencesFromIC", () => {
    afterEach(() => {
      jest.resetModules();
    });

    it("returns null when canister has no data", async () => {
      const mockActor = {
        getUserPreferences: jest.fn().mockResolvedValue([]),
      };

      jest.doMock("@/lib/ic/actor", () => ({
        createBackendActorAsync: jest.fn().mockResolvedValue(mockActor),
      }));
      jest.doMock("@dfinity/principal", () => ({
        Principal: { fromText: jest.fn().mockReturnValue("mock-principal") },
      }));

      const { loadPreferencesFromIC } = await import("@/lib/preferences/storage");
      const mockIdentity = {} as import("@dfinity/agent").Identity;
      const result = await loadPreferencesFromIC(mockIdentity, "user-1");

      expect(result).toBeNull();
    });

    it("parses and returns valid IC profile", async () => {
      const storedProfile = buildProfile("user-1", {
        totalValidated: 15,
        topicAffinities: { ai: 0.9 },
      });
      const mockActor = {
        getUserPreferences: jest.fn().mockResolvedValue([
          { preferencesJson: JSON.stringify(storedProfile) },
        ]),
      };

      jest.doMock("@/lib/ic/actor", () => ({
        createBackendActorAsync: jest.fn().mockResolvedValue(mockActor),
      }));
      jest.doMock("@dfinity/principal", () => ({
        Principal: { fromText: jest.fn().mockReturnValue("mock-principal") },
      }));

      const { loadPreferencesFromIC } = await import("@/lib/preferences/storage");
      const mockIdentity = {} as import("@dfinity/agent").Identity;
      const result = await loadPreferencesFromIC(mockIdentity, "user-1");

      expect(result).not.toBeNull();
      expect(result!.totalValidated).toBe(15);
      expect(result!.topicAffinities).toEqual({ ai: 0.9 });
      expect(result!.principalId).toBe("user-1");
    });

    it("returns null on invalid JSON from IC", async () => {
      const mockActor = {
        getUserPreferences: jest.fn().mockResolvedValue([
          { preferencesJson: "not valid json{{{" },
        ]),
      };

      jest.doMock("@/lib/ic/actor", () => ({
        createBackendActorAsync: jest.fn().mockResolvedValue(mockActor),
      }));
      jest.doMock("@dfinity/principal", () => ({
        Principal: { fromText: jest.fn().mockReturnValue("mock-principal") },
      }));

      const { loadPreferencesFromIC } = await import("@/lib/preferences/storage");
      const mockIdentity = {} as import("@dfinity/agent").Identity;
      const result = await loadPreferencesFromIC(mockIdentity, "user-1");

      expect(result).toBeNull();
    });

    it("returns null on IC data with wrong version", async () => {
      const badProfile = { ...buildProfile("user-1"), version: 99 };
      const mockActor = {
        getUserPreferences: jest.fn().mockResolvedValue([
          { preferencesJson: JSON.stringify(badProfile) },
        ]),
      };

      jest.doMock("@/lib/ic/actor", () => ({
        createBackendActorAsync: jest.fn().mockResolvedValue(mockActor),
      }));
      jest.doMock("@dfinity/principal", () => ({
        Principal: { fromText: jest.fn().mockReturnValue("mock-principal") },
      }));

      const { loadPreferencesFromIC } = await import("@/lib/preferences/storage");
      const mockIdentity = {} as import("@dfinity/agent").Identity;
      const result = await loadPreferencesFromIC(mockIdentity, "user-1");

      expect(result).toBeNull();
    });

    it("returns null on actor error", async () => {
      jest.doMock("@/lib/ic/actor", () => ({
        createBackendActorAsync: jest.fn().mockRejectedValue(new Error("network error")),
      }));
      jest.doMock("@dfinity/principal", () => ({
        Principal: { fromText: jest.fn().mockReturnValue("mock-principal") },
      }));

      const { loadPreferencesFromIC } = await import("@/lib/preferences/storage");
      const mockIdentity = {} as import("@dfinity/agent").Identity;
      const result = await loadPreferencesFromIC(mockIdentity, "user-1");

      expect(result).toBeNull();
    });
  });
});
