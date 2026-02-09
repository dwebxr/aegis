/**
 * Tests for calculateResonance edge cases — real code, no mocking.
 */
import { calculateResonance } from "@/lib/agent/discovery";
import { createEmptyProfile } from "@/lib/preferences/types";
import type { AgentProfile } from "@/lib/agent/types";

function makePeer(interests: string[], extra?: Partial<AgentProfile>): AgentProfile {
  return {
    nostrPubkey: "peer-" + Math.random().toString(36).slice(2, 8),
    interests,
    capacity: 5,
    lastSeen: Date.now(),
    ...extra,
  };
}

describe("calculateResonance — edge cases", () => {
  it("returns 0 for completely empty profile (no topic affinities)", () => {
    const prefs = createEmptyProfile("empty");
    const peer = makePeer(["ai", "ml"]);
    expect(calculateResonance(prefs, peer)).toBe(0);
  });

  it("returns 0 when all affinities are below threshold (0.3)", () => {
    const prefs = { ...createEmptyProfile("low"), topicAffinities: { ai: 0.29, ml: 0.1, crypto: 0.2 } };
    const peer = makePeer(["ai", "ml", "crypto"]);
    expect(calculateResonance(prefs, peer)).toBe(0);
  });

  it("returns 0 for peer with empty interests array", () => {
    const prefs = { ...createEmptyProfile("t"), topicAffinities: { ai: 0.9 } };
    const peer = makePeer([]);
    expect(calculateResonance(prefs, peer)).toBe(0);
  });

  it("exact threshold 0.3 is included", () => {
    const prefs = { ...createEmptyProfile("t"), topicAffinities: { ai: 0.3 } };
    const peer = makePeer(["ai"]);
    // 1 overlap, union = 1 → resonance = 1.0
    expect(calculateResonance(prefs, peer)).toBe(1);
  });

  it("0.299 is excluded from high-affinity", () => {
    const prefs = { ...createEmptyProfile("t"), topicAffinities: { ai: 0.299 } };
    const peer = makePeer(["ai"]);
    expect(calculateResonance(prefs, peer)).toBe(0);
  });

  it("handles case-sensitive topic matching (ai ≠ AI)", () => {
    const prefs = { ...createEmptyProfile("t"), topicAffinities: { ai: 0.9 } };
    const peer = makePeer(["AI"]);
    // "ai" and "AI" are different strings — no overlap
    expect(calculateResonance(prefs, peer)).toBe(0);
  });

  it("handles peer with duplicate interests", () => {
    const prefs = { ...createEmptyProfile("t"), topicAffinities: { ai: 0.9, ml: 0.8 } };
    const peer = makePeer(["ai", "ai", "ai"]);
    // Jaccard: overlap=1 (ai), union = Set(["ai","ml","ai","ai","ai"]).size = 2
    const result = calculateResonance(prefs, peer);
    expect(result).toBeCloseTo(0.5, 5); // 1/2
  });

  it("handles many topics efficiently", () => {
    const affinities: Record<string, number> = {};
    for (let i = 0; i < 100; i++) affinities[`topic-${i}`] = 0.5;
    const prefs = { ...createEmptyProfile("t"), topicAffinities: affinities };

    const interests = Array.from({ length: 100 }, (_, i) => `topic-${i}`);
    const peer = makePeer(interests);
    expect(calculateResonance(prefs, peer)).toBe(1); // Perfect overlap
  });

  it("returns value in [0, 1] for arbitrary inputs", () => {
    const affinities: Record<string, number> = { a: 0.4, b: 0.5, c: 0.6, d: 0.7 };
    const prefs = { ...createEmptyProfile("t"), topicAffinities: affinities };
    const peer = makePeer(["b", "d", "e", "f"]);
    const result = calculateResonance(prefs, peer);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
    // overlap = {b, d} = 2, union = {a,b,c,d,e,f} = 6 → 2/6 ≈ 0.333
    expect(result).toBeCloseTo(2 / 6, 5);
  });

  it("single topic match yields correct Jaccard", () => {
    const prefs = { ...createEmptyProfile("t"), topicAffinities: { ai: 0.9, ml: 0.8, crypto: 0.5 } };
    const peer = makePeer(["ai", "defi", "nft"]);
    // overlap = {ai} = 1, union = {ai, ml, crypto, defi, nft} = 5
    expect(calculateResonance(prefs, peer)).toBeCloseTo(1 / 5, 5);
  });

  it("returns 0 for disjoint sets", () => {
    const prefs = { ...createEmptyProfile("t"), topicAffinities: { alpha: 0.5, beta: 0.5 } };
    const peer = makePeer(["gamma", "delta"]);
    expect(calculateResonance(prefs, peer)).toBe(0);
  });
});
