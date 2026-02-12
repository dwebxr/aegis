import { scoreColor, relativeTime } from "@/lib/utils/scores";

describe("scoreColor — edge cases", () => {
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
  it("returns large day count for very old timestamps", () => {
    const oneYearAgo = Date.now() - 365 * 24 * 60 * 60_000;
    expect(relativeTime(oneYearAgo)).toBe("365d ago");
  });

  it("returns 'just now' for future timestamps", () => {
    expect(relativeTime(Date.now() + 60_000)).toBe("just now");
  });

  it("returns days for epoch timestamp", () => {
    const result = relativeTime(0);
    expect(result).toMatch(/\d+d ago/);
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
