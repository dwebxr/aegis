/**
 * Tests for D2A protocol fee constants, staking thresholds,
 * and fee distribution math.
 */
// Mock @dfinity/agent to avoid BigInt incompatibility in Jest
jest.mock("@dfinity/agent", () => ({}));

import {
  D2A_MATCH_FEE,
  D2A_APPROVE_AMOUNT,
  RESONANCE_THRESHOLD,
  MIN_OFFER_SCORE,
  PRESENCE_BROADCAST_INTERVAL_MS,
  PEER_EXPIRY_MS,
  HANDSHAKE_TIMEOUT_MS,
  DISCOVERY_POLL_INTERVAL_MS,
} from "@/lib/agent/protocol";
import { ICP_FEE, MIN_STAKE, MAX_STAKE } from "@/lib/ic/icpLedger";

describe("D2A match fee economics", () => {
  it("D2A_MATCH_FEE is 100,000 e8s (0.001 ICP)", () => {
    expect(D2A_MATCH_FEE).toBe(100_000);
  });

  it("D2A_APPROVE_AMOUNT covers ~100 matches", () => {
    const matchesCovered = D2A_APPROVE_AMOUNT / D2A_MATCH_FEE;
    expect(matchesCovered).toBe(100);
  });

  it("match fee exceeds 3x ICP transfer fee (minimum viable)", () => {
    // The canister requires feeAmount >= ICP_FEE * 3
    expect(BigInt(D2A_MATCH_FEE)).toBeGreaterThanOrEqual(ICP_FEE * BigInt(3));
  });

  it("80/20 fee split leaves sender with positive payout after transfer fee", () => {
    const senderPayout = Math.floor((D2A_MATCH_FEE * 80) / 100);
    const senderNet = senderPayout - Number(ICP_FEE);
    expect(senderNet).toBeGreaterThan(0);
  });

  it("protocol receives 20% of match fee", () => {
    const senderPayout = Math.floor((D2A_MATCH_FEE * 80) / 100);
    const protocolPayout = D2A_MATCH_FEE - senderPayout;
    expect(protocolPayout).toBe(20_000); // 20% of 100,000
  });

  it("sender payout + protocol payout == total fee (no rounding loss)", () => {
    const senderPayout = Math.floor((D2A_MATCH_FEE * 80) / 100);
    const protocolPayout = D2A_MATCH_FEE - senderPayout;
    expect(senderPayout + protocolPayout).toBe(D2A_MATCH_FEE);
  });
});

describe("staking boundaries", () => {
  it("MIN_STAKE is within a reasonable range (0.0001 - 0.01 ICP)", () => {
    expect(Number(MIN_STAKE)).toBeGreaterThanOrEqual(10_000);
    expect(Number(MIN_STAKE)).toBeLessThanOrEqual(1_000_000);
  });

  it("MAX_STAKE is reasonable (0.1 - 10 ICP)", () => {
    expect(Number(MAX_STAKE)).toBeGreaterThanOrEqual(10_000_000);
    expect(Number(MAX_STAKE)).toBeLessThanOrEqual(1_000_000_000);
  });

  it("stake range covers at least 2 orders of magnitude", () => {
    const ratio = Number(MAX_STAKE) / Number(MIN_STAKE);
    expect(ratio).toBeGreaterThanOrEqual(100);
  });

  it("MIN_STAKE covers fee overhead for stake return", () => {
    // When stake is returned, ICP_FEE is deducted
    // MIN_STAKE must be > ICP_FEE so owner receives something
    expect(MIN_STAKE - ICP_FEE).toBeGreaterThan(BigInt(0));
  });
});

describe("timing constants consistency", () => {
  it("peer expiry > 2x broadcast interval (peers don't expire between broadcasts)", () => {
    expect(PEER_EXPIRY_MS).toBeGreaterThan(PRESENCE_BROADCAST_INTERVAL_MS * 2);
  });

  it("handshake timeout < discovery poll (handshake resolves before next poll)", () => {
    expect(HANDSHAKE_TIMEOUT_MS).toBeLessThan(DISCOVERY_POLL_INTERVAL_MS);
  });

  it("discovery poll < peer expiry (discover before peers go stale)", () => {
    expect(DISCOVERY_POLL_INTERVAL_MS).toBeLessThan(PEER_EXPIRY_MS);
  });

  it("resonance threshold is in (0, 1)", () => {
    expect(RESONANCE_THRESHOLD).toBeGreaterThan(0);
    expect(RESONANCE_THRESHOLD).toBeLessThan(1);
  });

  it("MIN_OFFER_SCORE is in [0, 10]", () => {
    expect(MIN_OFFER_SCORE).toBeGreaterThanOrEqual(0);
    expect(MIN_OFFER_SCORE).toBeLessThanOrEqual(10);
  });
});
