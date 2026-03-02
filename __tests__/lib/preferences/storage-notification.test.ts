import { isValidProfile } from "@/lib/preferences/storage";
import { createEmptyProfile } from "@/lib/preferences/types";

describe("isValidProfile — notificationPrefs deep validation", () => {
  it("accepts profile with full notificationPrefs", () => {
    const p = {
      ...createEmptyProfile("user1"),
      notificationPrefs: {
        topicAlerts: ["bitcoin", "defi"],
        minScoreAlert: 7,
        d2aAlerts: true,
      },
    };
    expect(isValidProfile(p)).toBe(true);
  });

  it("accepts profile with partial notificationPrefs", () => {
    const p = { ...createEmptyProfile("user1"), notificationPrefs: { minScoreAlert: 3 } };
    expect(isValidProfile(p)).toBe(true);
  });

  it("accepts profile with only d2aAlerts", () => {
    const p = { ...createEmptyProfile("user1"), notificationPrefs: { d2aAlerts: false } };
    expect(isValidProfile(p)).toBe(true);
  });

  it("rejects minScoreAlert as string", () => {
    const p = { ...createEmptyProfile("user1"), notificationPrefs: { minScoreAlert: "high" } };
    expect(isValidProfile(p)).toBe(false);
  });

  it("rejects d2aAlerts as number", () => {
    const p = { ...createEmptyProfile("user1"), notificationPrefs: { d2aAlerts: 1 } };
    expect(isValidProfile(p)).toBe(false);
  });

  it("rejects topicAlerts containing numbers", () => {
    const p = { ...createEmptyProfile("user1"), notificationPrefs: { topicAlerts: [42] } };
    expect(isValidProfile(p)).toBe(false);
  });

  it("rejects topicAlerts as string instead of array", () => {
    const p = { ...createEmptyProfile("user1"), notificationPrefs: { topicAlerts: "bitcoin" } };
    expect(isValidProfile(p)).toBe(false);
  });

  it("accepts empty topicAlerts array", () => {
    const p = { ...createEmptyProfile("user1"), notificationPrefs: { topicAlerts: [] } };
    expect(isValidProfile(p)).toBe(true);
  });

  it("rejects notificationPrefs as null", () => {
    const p = { ...createEmptyProfile("user1"), notificationPrefs: null };
    expect(isValidProfile(p)).toBe(false);
  });

  it("rejects notificationPrefs as number", () => {
    const p = { ...createEmptyProfile("user1"), notificationPrefs: 42 };
    expect(isValidProfile(p)).toBe(false);
  });
});
