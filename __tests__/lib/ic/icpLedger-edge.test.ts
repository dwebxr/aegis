/**
 * Edge case tests for lib/ic/icpLedger.ts — formatICP precision boundaries.
 */
jest.mock("@dfinity/agent", () => ({}));

import { formatICP, E8S, ICP_FEE } from "@/lib/ic/icpLedger";

describe("formatICP — edge cases", () => {
  it("formats smallest possible unit (1 e8s = 0.00000001 ICP)", () => {
    expect(formatICP(BigInt(1))).toBe("0.00000001");
  });

  it("formats 2 e8s", () => {
    expect(formatICP(BigInt(2))).toBe("0.00000002");
  });

  it("formats 99,999,999 e8s (just under 1 ICP)", () => {
    expect(formatICP(BigInt(99_999_999))).toBe("0.99999999");
  });

  it("formats exactly 1 ICP", () => {
    expect(formatICP(E8S)).toBe("1.0");
  });

  it("formats 1 ICP + 1 e8s", () => {
    expect(formatICP(E8S + BigInt(1))).toBe("1.00000001");
  });

  it("formats powers of 10 correctly", () => {
    expect(formatICP(BigInt(10))).toBe("0.0000001");
    expect(formatICP(BigInt(100))).toBe("0.000001");
    expect(formatICP(BigInt(1_000))).toBe("0.00001");
    expect(formatICP(BigInt(10_000))).toBe("0.0001");
    expect(formatICP(BigInt(100_000))).toBe("0.001");
    expect(formatICP(BigInt(1_000_000))).toBe("0.01");
    expect(formatICP(BigInt(10_000_000))).toBe("0.1");
  });

  it("strips trailing zeros", () => {
    // 0.10000000 → "0.1"
    expect(formatICP(BigInt(10_000_000))).toBe("0.1");
    // 0.50000000 → "0.5"
    expect(formatICP(BigInt(50_000_000))).toBe("0.5");
    // 2.00000000 → "2.0" (keeps at least one decimal)
    expect(formatICP(BigInt(200_000_000))).toBe("2.0");
  });

  it("handles very large amounts (10,000 ICP)", () => {
    expect(formatICP(BigInt(10_000) * E8S)).toBe("10000.0");
  });

  it("handles amount with mixed significant digits", () => {
    // 1.23456789 ICP
    expect(formatICP(BigInt(123_456_789))).toBe("1.23456789");
  });

  it("ICP_FEE + remainder preserves precision", () => {
    // 0.0001 ICP + 1 e8s = 10,001 e8s
    expect(formatICP(ICP_FEE + BigInt(1))).toBe("0.00010001");
  });

  it("handles zero", () => {
    expect(formatICP(BigInt(0))).toBe("0.0");
  });

  it("formats exact half amounts", () => {
    expect(formatICP(E8S / BigInt(2))).toBe("0.5");
    expect(formatICP(E8S / BigInt(4))).toBe("0.25");
    expect(formatICP(E8S / BigInt(8))).toBe("0.125");
  });
});
