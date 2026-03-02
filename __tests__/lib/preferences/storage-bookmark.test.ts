import { isValidProfile } from "@/lib/preferences/storage";
import { createEmptyProfile } from "@/lib/preferences/types";

describe("isValidProfile — bookmarkedIds", () => {
  it("accepts profile without bookmarkedIds", () => {
    const p = createEmptyProfile("user1");
    expect(isValidProfile(p)).toBe(true);
  });

  it("accepts profile with empty bookmarkedIds array", () => {
    const p = { ...createEmptyProfile("user1"), bookmarkedIds: [] };
    expect(isValidProfile(p)).toBe(true);
  });

  it("accepts profile with valid bookmarkedIds", () => {
    const p = { ...createEmptyProfile("user1"), bookmarkedIds: ["id-1", "id-2", "id-3"] };
    expect(isValidProfile(p)).toBe(true);
  });

  it("rejects bookmarkedIds that is not an array", () => {
    const p = { ...createEmptyProfile("user1"), bookmarkedIds: "not-array" };
    expect(isValidProfile(p)).toBe(false);
  });

  it("rejects bookmarkedIds with non-string elements", () => {
    const p = { ...createEmptyProfile("user1"), bookmarkedIds: ["id-1", 42] };
    expect(isValidProfile(p)).toBe(false);
  });

  it("rejects bookmarkedIds with null elements", () => {
    const p = { ...createEmptyProfile("user1"), bookmarkedIds: [null] };
    expect(isValidProfile(p)).toBe(false);
  });
});

describe("isValidProfile — notificationPrefs", () => {
  it("accepts profile without notificationPrefs", () => {
    expect(isValidProfile(createEmptyProfile("user1"))).toBe(true);
  });

  it("accepts valid notificationPrefs with all fields", () => {
    const p = {
      ...createEmptyProfile("user1"),
      notificationPrefs: { topicAlerts: ["bitcoin", "defi"], minScoreAlert: 7, d2aAlerts: true },
    };
    expect(isValidProfile(p)).toBe(true);
  });

  it("accepts notificationPrefs with only topicAlerts", () => {
    const p = { ...createEmptyProfile("user1"), notificationPrefs: { topicAlerts: ["eth"] } };
    expect(isValidProfile(p)).toBe(true);
  });

  it("accepts notificationPrefs with only minScoreAlert", () => {
    const p = { ...createEmptyProfile("user1"), notificationPrefs: { minScoreAlert: 5 } };
    expect(isValidProfile(p)).toBe(true);
  });

  it("accepts empty notificationPrefs object", () => {
    const p = { ...createEmptyProfile("user1"), notificationPrefs: {} };
    expect(isValidProfile(p)).toBe(true);
  });

  it("rejects notificationPrefs that is not an object", () => {
    const p = { ...createEmptyProfile("user1"), notificationPrefs: "bad" };
    expect(isValidProfile(p)).toBe(false);
  });

  it("rejects notificationPrefs that is an array", () => {
    const p = { ...createEmptyProfile("user1"), notificationPrefs: [] };
    expect(isValidProfile(p)).toBe(false);
  });

  it("rejects topicAlerts with non-string elements", () => {
    const p = { ...createEmptyProfile("user1"), notificationPrefs: { topicAlerts: [123] } };
    expect(isValidProfile(p)).toBe(false);
  });

  it("rejects non-number minScoreAlert", () => {
    const p = { ...createEmptyProfile("user1"), notificationPrefs: { minScoreAlert: "high" } };
    expect(isValidProfile(p)).toBe(false);
  });

  it("rejects non-boolean d2aAlerts", () => {
    const p = { ...createEmptyProfile("user1"), notificationPrefs: { d2aAlerts: "yes" } };
    expect(isValidProfile(p)).toBe(false);
  });
});
