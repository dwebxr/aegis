/**
 * Thorough tests for publish gate — reputation scoring, deposit thresholds,
 * natural recovery, and gate decisions with boundary values.
 */
import {
  recordPublishValidation,
  recordPublishFlag,
  checkPublishGate,
  applyReputationRecovery,
  getPublishReputation,
  loadPublishReputations,
  PUBLISH_DEPOSIT_THRESHOLD,
  PUBLISH_BLOCK_THRESHOLD,
  type PublishReputation,
} from "@/lib/reputation/publishGate";

const store: Record<string, string> = {};
beforeAll(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    },
    writable: true,
  });
});
beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
});

describe("publishGate scoring: score = validated - flagged * 2", () => {
  it("first validation gives score 1", () => {
    const rep = recordPublishValidation("pub-a");
    expect(rep.score).toBe(1);
    expect(rep.validated).toBe(1);
  });

  it("first flag gives score -2", () => {
    const rep = recordPublishFlag("pub-b");
    expect(rep.score).toBe(-2);
    expect(rep.flagged).toBe(1);
  });

  it("3 validated + 2 flagged = 3 - 4 = -1", () => {
    recordPublishValidation("pub-c");
    recordPublishValidation("pub-c");
    recordPublishValidation("pub-c");
    recordPublishFlag("pub-c");
    const rep = recordPublishFlag("pub-c");
    expect(rep.score).toBe(-1);
  });
});

describe("checkPublishGate — boundary decisions", () => {
  it("unknown pubkey can publish freely", () => {
    const decision = checkPublishGate("unknown-pub");
    expect(decision.canPublish).toBe(true);
    expect(decision.requiresDeposit).toBe(false);
  });

  it("score at deposit threshold (-3): still free", () => {
    // score = validated - flagged * 2 = 0 - 3*2 = -6? No.
    // We need score = -3. validated=1, flagged=2: 1-4=-3
    recordPublishValidation("pub-thresh");
    recordPublishFlag("pub-thresh");
    recordPublishFlag("pub-thresh");
    const rep = getPublishReputation("pub-thresh")!;
    expect(rep.score).toBe(-3); // exactly at threshold
    // >= threshold means no deposit
    const decision = checkPublishGate("pub-thresh");
    expect(decision.canPublish).toBe(true);
    expect(decision.requiresDeposit).toBe(false);
  });

  it("score just below deposit threshold (-4): requires deposit", () => {
    // score = 0 - 2*2 = -4
    recordPublishFlag("pub-deposit");
    recordPublishFlag("pub-deposit");
    const rep = getPublishReputation("pub-deposit")!;
    expect(rep.score).toBe(-4); // below -3 threshold
    const decision = checkPublishGate("pub-deposit");
    expect(decision.canPublish).toBe(true);
    expect(decision.requiresDeposit).toBe(true);
  });

  it("score at block threshold (-10): requires deposit but not blocked", () => {
    // Need score = -10: 0 - 5*2 = -10
    for (let i = 0; i < 5; i++) recordPublishFlag("pub-block-edge");
    const rep = getPublishReputation("pub-block-edge")!;
    expect(rep.score).toBe(-10);
    // >= PUBLISH_BLOCK_THRESHOLD means can still publish (with deposit)
    const decision = checkPublishGate("pub-block-edge");
    expect(decision.canPublish).toBe(true);
    expect(decision.requiresDeposit).toBe(true);
  });

  it("score below block threshold (-11): blocked", () => {
    // Need score < -10: validated=1, flagged=6: 1-12=-11
    recordPublishValidation("pub-blocked");
    for (let i = 0; i < 6; i++) recordPublishFlag("pub-blocked");
    const rep = getPublishReputation("pub-blocked")!;
    expect(rep.score).toBe(-11);
    const decision = checkPublishGate("pub-blocked");
    expect(decision.canPublish).toBe(false);
  });
});

describe("applyReputationRecovery", () => {
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  it("no recovery if score already at max (0)", () => {
    const rep: PublishReputation = {
      pubkey: "rec-a", validated: 5, flagged: 0, score: 0,
      lastActionAt: Date.now() - SEVEN_DAYS_MS * 10, updatedAt: Date.now(),
    };
    const result = applyReputationRecovery(rep);
    expect(result.score).toBe(0);
  });

  it("no recovery if less than 7 days elapsed", () => {
    const rep: PublishReputation = {
      pubkey: "rec-b", validated: 0, flagged: 3, score: -6,
      lastActionAt: Date.now() - SEVEN_DAYS_MS + 1000, updatedAt: Date.now(),
    };
    const result = applyReputationRecovery(rep);
    expect(result.score).toBe(-6); // unchanged
  });

  it("+1 per 7-day period, capped at 0", () => {
    const rep: PublishReputation = {
      pubkey: "rec-c", validated: 0, flagged: 2, score: -4,
      lastActionAt: Date.now() - SEVEN_DAYS_MS * 3, updatedAt: Date.now(),
    };
    const result = applyReputationRecovery(rep);
    expect(result.score).toBe(-1); // -4 + 3 = -1
  });

  it("caps at 0 even with many recovery periods", () => {
    const rep: PublishReputation = {
      pubkey: "rec-d", validated: 0, flagged: 1, score: -2,
      lastActionAt: Date.now() - SEVEN_DAYS_MS * 100, updatedAt: Date.now(),
    };
    const result = applyReputationRecovery(rep);
    expect(result.score).toBe(0); // capped at 0
  });

  it("positive score (edge case) returns unchanged", () => {
    const rep: PublishReputation = {
      pubkey: "rec-e", validated: 10, flagged: 0, score: 10,
      lastActionAt: Date.now() - SEVEN_DAYS_MS * 5, updatedAt: Date.now(),
    };
    const result = applyReputationRecovery(rep);
    expect(result.score).toBe(10);
  });
});

describe("publishGate persistence", () => {
  it("corrupted store returns empty map", () => {
    store["aegis_publish_reputations"] = "{invalid json";
    const map = loadPublishReputations();
    expect(map.size).toBe(0);
    // Corrupted data should be cleared
    expect(store["aegis_publish_reputations"]).toBeUndefined();
  });

  it("wrong version returns empty map", () => {
    store["aegis_publish_reputations"] = JSON.stringify({ version: 2, entries: [] });
    const map = loadPublishReputations();
    expect(map.size).toBe(0);
  });
});

describe("threshold constants", () => {
  it("deposit threshold is -3", () => {
    expect(PUBLISH_DEPOSIT_THRESHOLD).toBe(-3);
  });

  it("block threshold is -10", () => {
    expect(PUBLISH_BLOCK_THRESHOLD).toBe(-10);
  });
});
