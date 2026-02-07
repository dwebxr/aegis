import { scoreColor, relativeTime } from "@/lib/utils/scores";

describe("scoreColor", () => {
  it("returns green for high scores (>= 7)", () => {
    expect(scoreColor(7)).toBe("#34d399");
    expect(scoreColor(7.5)).toBe("#34d399");
    expect(scoreColor(10)).toBe("#34d399");
    expect(scoreColor(100)).toBe("#34d399"); // out-of-range still works
  });

  it("returns yellow for mid scores (4-6.9)", () => {
    expect(scoreColor(4)).toBe("#fbbf24");
    expect(scoreColor(5.5)).toBe("#fbbf24");
    expect(scoreColor(6.9)).toBe("#fbbf24");
  });

  it("returns red for low scores (< 4)", () => {
    expect(scoreColor(3.9)).toBe("#f87171");
    expect(scoreColor(0)).toBe("#f87171");
    expect(scoreColor(-1)).toBe("#f87171"); // negative
  });

  it("handles exact boundaries", () => {
    expect(scoreColor(4.0)).toBe("#fbbf24");
    expect(scoreColor(3.999)).toBe("#f87171");
    expect(scoreColor(7.0)).toBe("#34d399");
    expect(scoreColor(6.999)).toBe("#fbbf24");
  });
});

describe("relativeTime", () => {
  it("returns 'just now' for timestamps within the last minute", () => {
    expect(relativeTime(Date.now())).toBe("just now");
    expect(relativeTime(Date.now() - 30_000)).toBe("just now"); // 30 sec
    expect(relativeTime(Date.now() - 59_000)).toBe("just now"); // 59 sec
  });

  it("returns minutes for timestamps 1-59 minutes ago", () => {
    expect(relativeTime(Date.now() - 60_000)).toBe("1m ago");
    expect(relativeTime(Date.now() - 5 * 60_000)).toBe("5m ago");
    expect(relativeTime(Date.now() - 59 * 60_000)).toBe("59m ago");
  });

  it("returns hours for timestamps 1-23 hours ago", () => {
    expect(relativeTime(Date.now() - 60 * 60_000)).toBe("1h ago");
    expect(relativeTime(Date.now() - 12 * 60 * 60_000)).toBe("12h ago");
    expect(relativeTime(Date.now() - 23 * 60 * 60_000)).toBe("23h ago");
  });

  it("returns days for timestamps >= 24 hours ago", () => {
    expect(relativeTime(Date.now() - 24 * 60 * 60_000)).toBe("1d ago");
    expect(relativeTime(Date.now() - 7 * 24 * 60 * 60_000)).toBe("7d ago");
    expect(relativeTime(Date.now() - 30 * 24 * 60 * 60_000)).toBe("30d ago");
  });

  it("handles future timestamps gracefully", () => {
    // Future timestamps result in negative diff → minutes < 1 → "just now"
    expect(relativeTime(Date.now() + 60_000)).toBe("just now");
  });
});
