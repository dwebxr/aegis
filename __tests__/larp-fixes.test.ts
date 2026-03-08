/**
 * @jest-environment jsdom
 *
 * Tests for LARP evaluation fixes — verifying real code paths
 * that were previously untested or insufficiently validated.
 *
 * @module
 */

if (typeof globalThis.TextEncoder === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextEncoder, TextDecoder } = require("util");
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}

if (typeof globalThis.structuredClone === "undefined") {
  globalThis.structuredClone = <T>(val: T): T => JSON.parse(JSON.stringify(val));
}

/*
 * Covers:
 * 1. parseD2AMessage sender pubkey verification
 * 2. isValidDeliverPayload scores validation
 * 3. validateContentItems score bounds
 * 4. CORS origin validation
 * 5. Heuristic scoring correctness (data inspection)
 * 6. Preference engine real logic (no mocks)
 */

import { parseD2AMessage } from "@/lib/agent/handshake";
import { encryptMessage } from "@/lib/nostr/encrypt";
import { getPublicKey } from "nostr-tools/pure";
import type { D2AMessage } from "@/lib/agent/types";
import { loadCachedContent, _resetContentCache } from "@/contexts/content/cache";
import { heuristicScores } from "@/lib/ingestion/quickFilter";
import { learn, getContext, hasEnoughData } from "@/lib/preferences/engine";
import type { UserPreferenceProfile } from "@/lib/preferences/types";

function makeProfile(): UserPreferenceProfile {
  return {
    version: 1,
    principalId: "test-principal",
    topicAffinities: {},
    authorTrust: {},
    recentTopics: [],
    totalValidated: 0,
    totalFlagged: 0,
    calibration: { qualityThreshold: 4.0 },
    bookmarkedIds: [],
    lastUpdated: Date.now(),
  };
}

// ─── Keypairs ───

const sk1 = new Uint8Array(32).fill(1);
const pk1 = getPublicKey(sk1);
const sk2 = new Uint8Array(32).fill(2);
const pk2 = getPublicKey(sk2);
const sk3 = new Uint8Array(32).fill(3);
const pk3 = getPublicKey(sk3);

function encrypt(msg: unknown) {
  return encryptMessage(JSON.stringify(msg), sk1, pk2);
}

// ─── 1. Sender pubkey verification ───

describe("parseD2AMessage — sender pubkey verification", () => {
  it("rejects message where payload.fromPubkey differs from senderPk", () => {
    const msg: D2AMessage = {
      type: "offer",
      fromPubkey: pk3, // claims to be pk3
      toPubkey: pk2,
      payload: { topic: "ai", score: 7, contentPreview: "spoofed" },
    };
    // Encrypt with sk1 (pk1's key) but claim fromPubkey is pk3
    const encrypted = encryptMessage(JSON.stringify(msg), sk1, pk2);
    // senderPk from Nostr event is pk1, but payload claims pk3
    const parsed = parseD2AMessage(encrypted, sk2, pk1);
    expect(parsed).toBeNull();
  });

  it("accepts message where payload.fromPubkey matches senderPk", () => {
    const msg: D2AMessage = {
      type: "offer",
      fromPubkey: pk1,
      toPubkey: pk2,
      payload: { topic: "ai", score: 7, contentPreview: "legit" },
    };
    const encrypted = encryptMessage(JSON.stringify(msg), sk1, pk2);
    const parsed = parseD2AMessage(encrypted, sk2, pk1);
    expect(parsed).not.toBeNull();
    expect(parsed!.fromPubkey).toBe(pk1);
  });

  it("rejects accept message with spoofed sender", () => {
    const msg = { type: "accept", fromPubkey: pk3, toPubkey: pk2, payload: {} };
    const encrypted = encryptMessage(JSON.stringify(msg), sk1, pk2);
    expect(parseD2AMessage(encrypted, sk2, pk1)).toBeNull();
  });

  it("rejects deliver message with spoofed sender", () => {
    const msg = {
      type: "deliver", fromPubkey: pk3, toPubkey: pk2,
      payload: {
        text: "content", author: "A",
        scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
        verdict: "quality", topics: ["ai"],
      },
    };
    const encrypted = encryptMessage(JSON.stringify(msg), sk1, pk2);
    expect(parseD2AMessage(encrypted, sk2, pk1)).toBeNull();
  });
});

// ─── 2. Deliver payload scores validation ───

describe("parseD2AMessage — deliver scores validation", () => {
  function deliverMsg(scores: unknown): unknown {
    return {
      type: "deliver", fromPubkey: pk1, toPubkey: pk2,
      payload: { text: "content", author: "Author", verdict: "quality", topics: ["ai"], scores },
    };
  }

  it("rejects deliver with missing scores object", () => {
    const msg = {
      type: "deliver", fromPubkey: pk1, toPubkey: pk2,
      payload: { text: "content", author: "Author", verdict: "quality", topics: ["ai"] },
    };
    expect(parseD2AMessage(encrypt(msg), sk2, pk1)).toBeNull();
  });

  it("rejects deliver with scores as string", () => {
    expect(parseD2AMessage(encrypt(deliverMsg("high")), sk2, pk1)).toBeNull();
  });

  it("rejects deliver with scores missing originality", () => {
    expect(parseD2AMessage(encrypt(deliverMsg({ insight: 5, credibility: 5, composite: 5 })), sk2, pk1)).toBeNull();
  });

  it("rejects deliver with scores missing composite", () => {
    expect(parseD2AMessage(encrypt(deliverMsg({ originality: 5, insight: 5, credibility: 5 })), sk2, pk1)).toBeNull();
  });

  it("rejects deliver with NaN score", () => {
    expect(parseD2AMessage(encrypt(deliverMsg({ originality: NaN, insight: 5, credibility: 5, composite: 5 })), sk2, pk1)).toBeNull();
  });

  it("rejects deliver with score > 10", () => {
    expect(parseD2AMessage(encrypt(deliverMsg({ originality: 11, insight: 5, credibility: 5, composite: 5 })), sk2, pk1)).toBeNull();
  });

  it("rejects deliver with negative score", () => {
    expect(parseD2AMessage(encrypt(deliverMsg({ originality: -1, insight: 5, credibility: 5, composite: 5 })), sk2, pk1)).toBeNull();
  });

  it("accepts deliver with boundary scores (0 and 10)", () => {
    const valid = deliverMsg({ originality: 0, insight: 10, credibility: 0, composite: 10 });
    const parsed = parseD2AMessage(encrypt(valid), sk2, pk1);
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe("deliver");
  });

  it("accepts deliver with valid decimal scores", () => {
    const valid = deliverMsg({ originality: 7.5, insight: 8.2, credibility: 6.1, composite: 7.3 });
    const parsed = parseD2AMessage(encrypt(valid), sk2, pk1);
    expect(parsed).not.toBeNull();
  });
});

// ─── 3. validateContentItems score bounds ───

describe("validateContentItems — score bounds via loadCachedContent", () => {
  beforeEach(() => {
    _resetContentCache();
    localStorage.clear();
  });

  function cacheItems(items: unknown[]) {
    localStorage.setItem("aegis-content-cache", JSON.stringify(items));
  }

  const validItem = {
    id: "v1", text: "hello", source: "rss", createdAt: 1000,
    verdict: "quality", validated: false, flagged: false,
    scores: { originality: 5, insight: 5, credibility: 5, composite: 5 },
  };

  it("accepts item with valid scores in range 0-10", async () => {
    cacheItems([validItem]);
    const items = await loadCachedContent();
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("v1");
  });

  it("rejects item with score > 10", async () => {
    cacheItems([{ ...validItem, id: "bad1", scores: { originality: 11, insight: 5, credibility: 5, composite: 5 } }]);
    const items = await loadCachedContent();
    expect(items).toHaveLength(0);
  });

  it("rejects item with negative score", async () => {
    cacheItems([{ ...validItem, id: "bad2", scores: { originality: -1, insight: 5, credibility: 5, composite: 5 } }]);
    const items = await loadCachedContent();
    expect(items).toHaveLength(0);
  });

  it("rejects item with NaN score", async () => {
    cacheItems([{ ...validItem, id: "bad3", scores: { originality: NaN, insight: 5, credibility: 5, composite: 5 } }]);
    const items = await loadCachedContent();
    expect(items).toHaveLength(0);
  });

  it("rejects item with Infinity score", async () => {
    cacheItems([{ ...validItem, id: "bad4", scores: { originality: Infinity, insight: 5, credibility: 5, composite: 5 } }]);
    const items = await loadCachedContent();
    expect(items).toHaveLength(0);
  });

  it("rejects item with missing originality field", async () => {
    cacheItems([{ ...validItem, id: "bad5", scores: { insight: 5, credibility: 5, composite: 5 } }]);
    const items = await loadCachedContent();
    expect(items).toHaveLength(0);
  });

  it("accepts boundary scores (0 and 10)", async () => {
    cacheItems([{ ...validItem, id: "boundary", scores: { originality: 0, insight: 10, credibility: 0, composite: 10 } }]);
    const items = await loadCachedContent();
    expect(items).toHaveLength(1);
  });

  it("filters out bad items while keeping good ones", async () => {
    cacheItems([
      validItem,
      { ...validItem, id: "bad", scores: { originality: 99, insight: 5, credibility: 5, composite: 5 } },
      { ...validItem, id: "v2", scores: { originality: 3, insight: 4, credibility: 5, composite: 4 } },
    ]);
    const items = await loadCachedContent();
    expect(items).toHaveLength(2);
    expect(items.map(i => i.id).sort()).toEqual(["v1", "v2"]);
  });
});

// ─── 4. Heuristic scoring data inspection ───

describe("heuristicScores — real output verification", () => {
  it("scores are within 0-10 range", () => {
    const texts = [
      "",
      "hi",
      "This is a normal sentence about technology.",
      "BREAKING!!! 🔥🔥🔥 BUY NOW!!!",
      "According to the analysis by Dr. Smith, the dataset shows a 23.5% correlation between variables, suggesting a novel framework for understanding the methodology behind the algorithm's implementation.",
    ];
    for (const text of texts) {
      const s = heuristicScores(text);
      expect(s.originality).toBeGreaterThanOrEqual(0);
      expect(s.originality).toBeLessThanOrEqual(10);
      expect(s.insight).toBeGreaterThanOrEqual(0);
      expect(s.insight).toBeLessThanOrEqual(10);
      expect(s.credibility).toBeGreaterThanOrEqual(0);
      expect(s.credibility).toBeLessThanOrEqual(10);
      expect(s.composite).toBeGreaterThanOrEqual(0);
      expect(s.composite).toBeLessThanOrEqual(10);
    }
  });

  it("composite formula matches 0.4*O + 0.35*I + 0.25*C", () => {
    const s = heuristicScores("A normal article about machine learning and AI developments.");
    const expected = parseFloat((s.originality * 0.4 + s.insight * 0.35 + s.credibility * 0.25).toFixed(1));
    expect(s.composite).toBe(expected);
  });

  it("spammy content scores lower than analytical content", () => {
    const spam = heuristicScores("BUY NOW!!! 🔥🔥🔥 AMAZING DEAL!!!");
    const analysis = heuristicScores(
      "According to recent analysis, the dataset shows a 15.3% improvement. " +
      "The methodology uses a novel framework for benchmarking algorithm performance. " +
      "Source: https://example.com/paper Evidence suggests this correlation is significant."
    );
    expect(analysis.composite).toBeGreaterThan(spam.composite);
  });

  it("verdict reflects composite threshold", () => {
    const quality = heuristicScores("This detailed analysis of the framework methodology shows evidence of a 25% correlation.");
    const slop = heuristicScores("BUY!!! 🔥🔥🔥 AMAZING!!! WOW!!!");
    expect(quality.verdict).toBe("quality");
    expect(slop.verdict).toBe("slop");
  });
});

// ─── 5. Preference engine real logic ───

describe("preference engine — real learning cycle", () => {
  let profile: UserPreferenceProfile;

  beforeEach(() => {
    profile = makeProfile();
  });

  it("learn(validate) increases topic affinity", () => {
    const next = learn(profile, { action: "validate", topics: ["ai"], author: "Bob", composite: 7, verdict: "quality" });
    expect(next.topicAffinities["ai"]).toBe(0.1);
  });

  it("learn(flag) decreases topic affinity", () => {
    const next = learn(profile, { action: "flag", topics: ["spam"], author: "Eve", composite: 3, verdict: "slop" });
    expect(next.topicAffinities["spam"]).toBe(-0.05);
  });

  it("multiple validates accumulate affinity up to cap (1.0)", () => {
    let p = profile;
    for (let i = 0; i < 15; i++) {
      p = learn(p, { action: "validate", topics: ["ai"], author: "Bob", composite: 7, verdict: "quality" });
    }
    expect(p.topicAffinities["ai"]).toBeLessThanOrEqual(1.0);
    expect(p.topicAffinities["ai"]).toBeGreaterThan(0.9);
  });

  it("multiple flags accumulate negative affinity down to floor (-1.0)", () => {
    let p = profile;
    for (let i = 0; i < 30; i++) {
      p = learn(p, { action: "flag", topics: ["spam"], author: "Eve", composite: 2, verdict: "slop" });
    }
    expect(p.topicAffinities["spam"]).toBeGreaterThanOrEqual(-1.0);
    expect(p.topicAffinities["spam"]).toBeLessThan(-0.5);
  });

  it("author trust increases on validate, decreases on flag", () => {
    const v = learn(profile, { action: "validate", topics: ["ai"], author: "Alice", composite: 7, verdict: "quality" });
    expect(v.authorTrust["Alice"].trust).toBe(0.2);
    expect(v.authorTrust["Alice"].validates).toBe(1);

    const f = learn(v, { action: "flag", topics: ["ai"], author: "Alice", composite: 3, verdict: "slop" });
    expect(f.authorTrust["Alice"].trust).toBe(0.2 - 0.3);
    expect(f.authorTrust["Alice"].flags).toBe(1);
  });

  it("borderline validate lowers quality threshold", () => {
    const next = learn(profile, { action: "validate", topics: ["ai"], author: "Bob", composite: 4.0, verdict: "quality" });
    expect(next.calibration.qualityThreshold).toBeLessThan(profile.calibration.qualityThreshold);
  });

  it("flagging quality-verdicted item raises threshold", () => {
    const next = learn(profile, { action: "flag", topics: ["ai"], author: "Bob", composite: 5, verdict: "quality" });
    expect(next.calibration.qualityThreshold).toBeGreaterThan(profile.calibration.qualityThreshold);
  });

  it("hasEnoughData returns false with < 3 interactions", () => {
    expect(hasEnoughData(profile)).toBe(false);
    const p1 = learn(profile, { action: "validate", topics: ["a"], author: "A", composite: 5, verdict: "quality" });
    const p2 = learn(p1, { action: "validate", topics: ["b"], author: "B", composite: 5, verdict: "quality" });
    expect(hasEnoughData(p2)).toBe(false);
  });

  it("hasEnoughData returns true with >= 3 interactions", () => {
    let p = profile;
    for (let i = 0; i < 3; i++) {
      p = learn(p, { action: "validate", topics: [`t${i}`], author: `A${i}`, composite: 5, verdict: "quality" });
    }
    expect(hasEnoughData(p)).toBe(true);
  });

  it("getContext returns high affinity topics above 0.3 threshold", () => {
    let p = profile;
    // 4 validates for 'ai' → 0.4 affinity (above 0.3)
    for (let i = 0; i < 4; i++) {
      p = learn(p, { action: "validate", topics: ["ai"], author: "Bob", composite: 7, verdict: "quality" });
    }
    const ctx = getContext(p);
    expect(ctx.highAffinityTopics).toContain("ai");
  });

  it("getContext returns low affinity topics below -0.2 threshold", () => {
    let p = profile;
    // 5 flags for 'spam' → -0.25 affinity (below -0.2)
    for (let i = 0; i < 5; i++) {
      p = learn(p, { action: "flag", topics: ["spam"], author: "Eve", composite: 2, verdict: "slop" });
    }
    const ctx = getContext(p);
    expect(ctx.lowAffinityTopics).toContain("spam");
  });

  it("getContext returns trusted authors above 0.3 trust", () => {
    let p = profile;
    // 2 validates for Alice → 0.4 trust (above 0.3)
    for (let i = 0; i < 2; i++) {
      p = learn(p, { action: "validate", topics: ["ai"], author: "Alice", composite: 7, verdict: "quality" });
    }
    const ctx = getContext(p);
    expect(ctx.trustedAuthors).toContain("Alice");
  });

  it("learn does not mutate original profile", () => {
    const original = makeProfile();
    const frozen = JSON.stringify(original);
    learn(original, { action: "validate", topics: ["ai"], author: "Bob", composite: 7, verdict: "quality" });
    expect(JSON.stringify(original)).toBe(frozen);
  });
});
