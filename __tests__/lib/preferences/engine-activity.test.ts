import { learn } from "@/lib/preferences/engine";
import { createEmptyProfile } from "@/lib/preferences/types";

function makeEvent(overrides: Partial<Parameters<typeof learn>[1]> = {}) {
  return {
    action: "validate" as const,
    topics: ["test"],
    author: "Author",
    composite: 7,
    verdict: "quality" as const,
    ...overrides,
  };
}

describe("learn() — activity histogram", () => {
  it("initialises histogram on first event", () => {
    const profile = createEmptyProfile("user1");
    const result = learn(profile, makeEvent());
    expect(result.activityHistogram).toBeDefined();
    expect(result.activityHistogram!.hourCounts).toHaveLength(24);
    expect(result.activityHistogram!.totalEvents).toBe(1);
  });

  it("increments the correct hour bucket", () => {
    const profile = createEmptyProfile("user1");
    const now = new Date("2026-03-02T14:30:00").getTime(); // hour 14
    jest.spyOn(Date, "now").mockReturnValue(now);

    const result = learn(profile, makeEvent());
    expect(result.activityHistogram!.hourCounts[14]).toBe(1);
    // Other buckets should be 0
    expect(result.activityHistogram!.hourCounts[0]).toBe(0);
    expect(result.activityHistogram!.hourCounts[23]).toBe(0);

    jest.restoreAllMocks();
  });

  it("accumulates events in the same hour", () => {
    const now = new Date("2026-03-02T09:00:00").getTime();
    jest.spyOn(Date, "now").mockReturnValue(now);

    let profile = createEmptyProfile("user1");
    profile = learn(profile, makeEvent());
    profile = learn(profile, makeEvent({ action: "flag", verdict: "slop" }));
    profile = learn(profile, makeEvent());

    expect(profile.activityHistogram!.hourCounts[9]).toBe(3);
    expect(profile.activityHistogram!.totalEvents).toBe(3);

    jest.restoreAllMocks();
  });

  it("distributes events across different hours", () => {
    let profile = createEmptyProfile("user1");

    jest.spyOn(Date, "now").mockReturnValue(new Date("2026-03-02T08:00:00").getTime());
    profile = learn(profile, makeEvent());

    jest.spyOn(Date, "now").mockReturnValue(new Date("2026-03-02T20:00:00").getTime());
    profile = learn(profile, makeEvent());

    expect(profile.activityHistogram!.hourCounts[8]).toBe(1);
    expect(profile.activityHistogram!.hourCounts[20]).toBe(1);
    expect(profile.activityHistogram!.totalEvents).toBe(2);

    jest.restoreAllMocks();
  });

  it("updates lastActivityAt on each event", () => {
    const t1 = new Date("2026-03-02T10:00:00").getTime();
    const t2 = new Date("2026-03-02T15:00:00").getTime();

    jest.spyOn(Date, "now").mockReturnValue(t1);
    let profile = learn(createEmptyProfile("user1"), makeEvent());
    expect(profile.activityHistogram!.lastActivityAt).toBe(t1);

    jest.spyOn(Date, "now").mockReturnValue(t2);
    profile = learn(profile, makeEvent());
    expect(profile.activityHistogram!.lastActivityAt).toBe(t2);

    jest.restoreAllMocks();
  });

  it("works with both validate and flag actions", () => {
    const now = new Date("2026-03-02T12:00:00").getTime();
    jest.spyOn(Date, "now").mockReturnValue(now);

    let profile = createEmptyProfile("user1");
    profile = learn(profile, makeEvent({ action: "validate" }));
    profile = learn(profile, makeEvent({ action: "flag", verdict: "slop" }));

    expect(profile.activityHistogram!.hourCounts[12]).toBe(2);
    expect(profile.activityHistogram!.totalEvents).toBe(2);

    jest.restoreAllMocks();
  });

  it("preserves existing histogram when present", () => {
    const profile = createEmptyProfile("user1");
    profile.activityHistogram = {
      hourCounts: new Array(24).fill(0),
      lastActivityAt: 1000,
      totalEvents: 5,
    };
    profile.activityHistogram.hourCounts[3] = 5;

    const now = new Date("2026-03-02T03:00:00").getTime();
    jest.spyOn(Date, "now").mockReturnValue(now);

    const result = learn(profile, makeEvent());
    expect(result.activityHistogram!.hourCounts[3]).toBe(6);
    expect(result.activityHistogram!.totalEvents).toBe(6);

    jest.restoreAllMocks();
  });

  it("does not mutate the original profile", () => {
    const profile = createEmptyProfile("user1");
    const result = learn(profile, makeEvent());
    expect(profile.activityHistogram).toBeUndefined();
    expect(result.activityHistogram).toBeDefined();
  });
});
