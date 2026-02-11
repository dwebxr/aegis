// Mock @dfinity/agent to avoid BigInt incompatibility in Jest
jest.mock("@dfinity/agent", () => ({}));

import { formatICP, ICP_FEE, MIN_STAKE, MAX_STAKE, E8S } from "@/lib/ic/icpLedger";

describe("formatICP", () => {
  it("formats zero", () => {
    expect(formatICP(BigInt(0))).toBe("0.0");
  });

  it("formats 1 ICP exactly", () => {
    expect(formatICP(E8S)).toBe("1.0");
  });

  it("formats fractional amounts", () => {
    expect(formatICP(BigInt(50_000_000))).toBe("0.5");
  });

  it("formats ICP_FEE (0.0001 ICP = 10,000 e8s)", () => {
    expect(formatICP(ICP_FEE)).toBe("0.0001");
  });

  it("formats MIN_STAKE (0.001 ICP = 100,000 e8s)", () => {
    expect(formatICP(MIN_STAKE)).toBe("0.001");
  });

  it("formats MAX_STAKE (1.0 ICP)", () => {
    expect(formatICP(MAX_STAKE)).toBe("1.0");
  });

  it("formats multi-ICP amounts", () => {
    expect(formatICP(BigInt(250_000_000))).toBe("2.5");
  });

  it("formats amounts with all 8 decimal places", () => {
    expect(formatICP(BigInt(1))).toBe("0.00000001");
  });

  it("formats large amounts (1000 ICP)", () => {
    expect(formatICP(BigInt(1000) * E8S)).toBe("1000.0");
  });

  it("formats 0.001 + fee correctly", () => {
    const amount = MIN_STAKE + ICP_FEE;
    expect(formatICP(amount)).toBe("0.0011");
  });

  it("handles typical D2A match fee (0.001 ICP)", () => {
    expect(formatICP(BigInt(100_000))).toBe("0.001");
  });

  it("handles D2A approve amount (0.1 ICP)", () => {
    expect(formatICP(BigInt(10_000_000))).toBe("0.1");
  });

  it("formats trailing zeros correctly (strips them)", () => {
    // 0.10000000 should display as 0.1, not 0.10000000
    expect(formatICP(BigInt(10_000_000))).toBe("0.1");
    // 0.50000000 → 0.5
    expect(formatICP(BigInt(50_000_000))).toBe("0.5");
  });
});

describe("ICP ledger constants", () => {
  it("ICP_FEE is 10,000 e8s (0.0001 ICP)", () => {
    expect(ICP_FEE).toBe(BigInt(10_000));
  });

  it("MIN_STAKE is 100,000 e8s (0.001 ICP)", () => {
    expect(MIN_STAKE).toBe(BigInt(100_000));
  });

  it("MAX_STAKE is 100,000,000 e8s (1.0 ICP)", () => {
    expect(MAX_STAKE).toBe(BigInt(100_000_000));
  });

  it("E8S is 100,000,000 (conversion factor)", () => {
    expect(E8S).toBe(BigInt(100_000_000));
  });

  it("MIN_STAKE >= ICP_FEE (stake must cover at least one fee)", () => {
    expect(MIN_STAKE).toBeGreaterThan(ICP_FEE);
  });

  it("MAX_STAKE == E8S (max stake is 1 ICP)", () => {
    expect(MAX_STAKE).toBe(E8S);
  });

  it("MIN_STAKE < MAX_STAKE (valid range)", () => {
    expect(MIN_STAKE).toBeLessThan(MAX_STAKE);
  });
});
