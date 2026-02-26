import {
  createEmptyProfile,
  DEFAULT_CALIBRATION,
} from "@/lib/preferences/types";

describe("createEmptyProfile", () => {
  it("creates a valid profile with given principalId", () => {
    const profile = createEmptyProfile("test-principal-123");
    expect(profile.principalId).toBe("test-principal-123");
    expect(profile.version).toBe(1);
  });

  it("initializes with empty collections", () => {
    const profile = createEmptyProfile("p1");
    expect(profile.topicAffinities).toEqual({});
    expect(profile.authorTrust).toEqual({});
    expect(profile.recentTopics).toEqual([]);
  });

  it("initializes counters at zero", () => {
    const profile = createEmptyProfile("p1");
    expect(profile.totalValidated).toBe(0);
    expect(profile.totalFlagged).toBe(0);
  });

  it("applies default calibration", () => {
    const profile = createEmptyProfile("p1");
    expect(profile.calibration.qualityThreshold).toBe(4.0);
  });

  it("does not share calibration reference with DEFAULT_CALIBRATION", () => {
    const profile = createEmptyProfile("p1");
    profile.calibration.qualityThreshold = 9;
    expect(DEFAULT_CALIBRATION.qualityThreshold).toBe(4.0);
  });

  it("sets lastUpdated to current time", () => {
    const before = Date.now();
    const profile = createEmptyProfile("p1");
    const after = Date.now();
    expect(profile.lastUpdated).toBeGreaterThanOrEqual(before);
    expect(profile.lastUpdated).toBeLessThanOrEqual(after);
  });

  it("handles empty string principalId", () => {
    const profile = createEmptyProfile("");
    expect(profile.principalId).toBe("");
  });
});

describe("constants", () => {
  it("DEFAULT_CALIBRATION has valid qualityThreshold", () => {
    expect(DEFAULT_CALIBRATION.qualityThreshold).toBeGreaterThan(0);
    expect(DEFAULT_CALIBRATION.qualityThreshold).toBeLessThan(10);
  });
});
