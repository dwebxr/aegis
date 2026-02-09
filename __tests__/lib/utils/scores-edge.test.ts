/**
 * Edge case tests for score utilities — boundary conditions, invalid inputs.
 */
import { scoreColor, relativeTime } from "@/lib/utils/scores";

describe("scoreColor — edge cases", () => {
  it("returns green for exactly 7.0", () => {
    expect(scoreColor(7.0)).toBe("#34d399");
  });

  it("returns yellow for 6.999", () => {
    expect(scoreColor(6.999)).toBe("#fbbf24");
  });

  it("returns yellow for exactly 4.0", () => {
    expect(scoreColor(4.0)).toBe("#fbbf24");
  });

  it("returns red for 3.999", () => {
    expect(scoreColor(3.999)).toBe("#f87171");
  });

  it("returns green for score of 10", () => {
    expect(scoreColor(10)).toBe("#34d399");
  });

  it("returns red for score of 0", () => {
    expect(scoreColor(0)).toBe("#f87171");
  });

  it("returns red for negative score", () => {
    expect(scoreColor(-1)).toBe("#f87171");
  });

  it("returns green for score exceeding 10", () => {
    expect(scoreColor(100)).toBe("#34d399");
  });

  it("handles NaN by returning red", () => {
    expect(scoreColor(NaN)).toBe("#f87171");
  });

  it("handles Infinity by returning green", () => {
    expect(scoreColor(Infinity)).toBe("#34d399");
  });

  it("handles -Infinity by returning red", () => {
    expect(scoreColor(-Infinity)).toBe("#f87171");
  });

  it("handles floating point precision", () => {
    // 0.1 + 0.2 = 0.30000000000000004 in JS
    expect(scoreColor(3.9 + 0.1)).toBe("#fbbf24"); // 4.0 → yellow
    expect(scoreColor(6.9 + 0.1)).toBe("#34d399"); // 7.0 → green
  });
});

describe("relativeTime — edge cases", () => {
  it("returns 'just now' for current timestamp", () => {
    expect(relativeTime(Date.now())).toBe("just now");
  });

  it("returns 'just now' for timestamp 59 seconds ago", () => {
    expect(relativeTime(Date.now() - 59_000)).toBe("just now");
  });

  it("returns '1m ago' for exactly 60 seconds ago", () => {
    expect(relativeTime(Date.now() - 60_000)).toBe("1m ago");
  });

  it("returns '59m ago' for 59 minutes ago", () => {
    expect(relativeTime(Date.now() - 59 * 60_000)).toBe("59m ago");
  });

  it("returns '1h ago' for exactly 60 minutes ago", () => {
    expect(relativeTime(Date.now() - 60 * 60_000)).toBe("1h ago");
  });

  it("returns '23h ago' for 23 hours ago", () => {
    expect(relativeTime(Date.now() - 23 * 60 * 60_000)).toBe("23h ago");
  });

  it("returns '1d ago' for 24 hours ago", () => {
    expect(relativeTime(Date.now() - 24 * 60 * 60_000)).toBe("1d ago");
  });

  it("returns large day count for very old timestamps", () => {
    const oneYearAgo = Date.now() - 365 * 24 * 60 * 60_000;
    expect(relativeTime(oneYearAgo)).toBe("365d ago");
  });

  it("returns 'just now' for future timestamps", () => {
    // Future timestamps produce negative diff → minutes < 1
    expect(relativeTime(Date.now() + 60_000)).toBe("just now");
  });

  it("returns 'just now' for timestamp 0 (epoch) returning large day value", () => {
    // timestamp 0 is very old — diff is huge
    const result = relativeTime(0);
    expect(result).toMatch(/\d+d ago/);
  });

  it("handles millisecond-precision boundary at exactly 1 minute", () => {
    // 60,000ms = exactly 1 minute
    const result = relativeTime(Date.now() - 60_000);
    expect(result).toBe("1m ago");
  });

  it("rounds down (floor) minutes", () => {
    // 90 seconds = 1.5 minutes → floor to 1
    expect(relativeTime(Date.now() - 90_000)).toBe("1m ago");
  });

  it("rounds down hours", () => {
    // 90 minutes = 1.5 hours → floor to 1
    expect(relativeTime(Date.now() - 90 * 60_000)).toBe("1h ago");
  });

  it("rounds down days", () => {
    // 36 hours = 1.5 days → floor to 1
    expect(relativeTime(Date.now() - 36 * 60 * 60_000)).toBe("1d ago");
  });
});
