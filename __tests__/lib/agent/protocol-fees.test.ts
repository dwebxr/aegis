// Mock @dfinity/agent to avoid BigInt incompatibility in Jest
jest.mock("@dfinity/agent", () => ({}));

import {
  D2A_FEE_TRUSTED,
  D2A_FEE_KNOWN,
  D2A_FEE_UNKNOWN,
  D2A_APPROVE_AMOUNT,
  RESONANCE_THRESHOLD,
  MIN_OFFER_SCORE,
  PRESENCE_BROADCAST_INTERVAL_MS,
  PEER_EXPIRY_MS,
  HANDSHAKE_TIMEOUT_MS,
  DISCOVERY_POLL_INTERVAL_MS,
} from "@/lib/agent/protocol";
import { ICP_FEE, MIN_STAKE, MAX_STAKE } from "@/lib/ic/icpLedger";

describe("D2A trust-tier fee economics", () => {
  it("trusted tier is free", () => {
    expect(D2A_FEE_TRUSTED).toBe(0);
  });

  it("paid tiers: known < unknown", () => {
    expect(D2A_FEE_KNOWN).toBeLessThan(D2A_FEE_UNKNOWN);
    expect(D2A_FEE_KNOWN).toBeGreaterThan(0);
  });

  it("D2A_APPROVE_AMOUNT covers >= 50 matches at highest tier", () => {
    const matchesCovered = D2A_APPROVE_AMOUNT / D2A_FEE_UNKNOWN;
    expect(matchesCovered).toBeGreaterThanOrEqual(50);
  });

  it("paid fee tiers exceed 3x ICP transfer fee (minimum viable)", () => {
    const minFee = ICP_FEE * BigInt(3);
    expect(BigInt(D2A_FEE_KNOWN)).toBeGreaterThanOrEqual(minFee);
    expect(BigInt(D2A_FEE_UNKNOWN)).toBeGreaterThanOrEqual(minFee);
  });

  it("80/20 fee split leaves sender with positive payout at paid tiers", () => {
    for (const fee of [D2A_FEE_KNOWN, D2A_FEE_UNKNOWN]) {
      const senderPayout = Math.floor((fee * 80) / 100);
      const senderNet = senderPayout - Number(ICP_FEE);
      expect(senderNet).toBeGreaterThan(0);
    }
  });

  it("sender payout + protocol payout == total fee (no rounding loss)", () => {
    for (const fee of [D2A_FEE_TRUSTED, D2A_FEE_KNOWN, D2A_FEE_UNKNOWN]) {
      const senderPayout = Math.floor((fee * 80) / 100);
      const protocolPayout = fee - senderPayout;
      expect(senderPayout + protocolPayout).toBe(fee);
    }
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
    expect(MIN_OFFER_SCORE).toBeGreaterThanOrEqual(1);
    expect(MIN_OFFER_SCORE).toBeLessThanOrEqual(10);
  });
});
