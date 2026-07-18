import { calculateSettleStats } from "@/scripts/settle-stats";

function metrics(successes: number): string[] {
  return Array.from({ length: 20 }, (_, index) =>
    `${index}:${index < successes ? "success" : "failure"}:attempt-${index}`);
}

describe("calculateSettleStats", () => {
  it("does not request rollback at 16 successes out of 20", () => {
    expect(calculateSettleStats("eip155:8453", metrics(16))).toEqual(
      expect.objectContaining({ successes: 16, rollback: false, windowComplete: true }),
    );
  });

  it("requests rollback below 16 successes out of 20", () => {
    expect(calculateSettleStats("eip155:8453", metrics(15))).toEqual(
      expect.objectContaining({ successes: 15, rollback: true, windowComplete: true }),
    );
  });

  it("shows verify failures without letting them poison the rollback window", () => {
    const verifyFailures = Array.from({ length: 20 }, (_, index) =>
      `${index}:failure:verify-${index}`);

    expect(calculateSettleStats("eip155:8453", [], verifyFailures)).toEqual(
      expect.objectContaining({
        attempts: 0,
        rollback: false,
        windowComplete: false,
        verification: { attempts: 20, failures: 20, failureRate: 1 },
      }),
    );
  });
});
