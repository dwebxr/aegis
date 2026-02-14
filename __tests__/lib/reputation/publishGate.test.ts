/**
 * @jest-environment jsdom
 */
import {
  loadPublishReputations,
  savePublishReputations,
  getPublishReputation,
  applyReputationRecovery,
  checkPublishGate,
  recordPublishValidation,
  recordPublishFlag,
  PUBLISH_DEPOSIT_THRESHOLD,
  PUBLISH_BLOCK_THRESHOLD,
  type PublishReputation,
} from "@/lib/reputation/publishGate";

beforeEach(() => localStorage.clear());

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

describe("loadPublishReputations / savePublishReputations", () => {
  it("returns empty map when nothing stored", () => {
    expect(loadPublishReputations().size).toBe(0);
  });

  it("round-trips a map through localStorage", () => {
    const rep: PublishReputation = {
      pubkey: "pk1",
      validated: 3,
      flagged: 1,
      score: 1,
      lastActionAt: 1000,
      updatedAt: 1000,
    };
    const map = new Map([["pk1", rep]]);
    savePublishReputations(map);
    const loaded = loadPublishReputations();
    expect(loaded.size).toBe(1);
    expect(loaded.get("pk1")).toEqual(rep);
  });

  it("returns empty map for malformed data", () => {
    localStorage.setItem("aegis_publish_reputations", JSON.stringify({ version: 2, entries: [] }));
    expect(loadPublishReputations().size).toBe(0);
  });

  it("returns empty map for non-array entries", () => {
    localStorage.setItem("aegis_publish_reputations", JSON.stringify({ version: 1, entries: "bad" }));
    expect(loadPublishReputations().size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// checkPublishGate
// ---------------------------------------------------------------------------

describe("checkPublishGate", () => {
  it("new user (no reputation) can publish freely", () => {
    const gate = checkPublishGate("newuser");
    expect(gate.canPublish).toBe(true);
    expect(gate.requiresDeposit).toBe(false);
  });

  it("user with positive score can publish freely", () => {
    const map = new Map([["pk1", makeRep("pk1", { validated: 5, flagged: 0, score: 5 })]]);
    savePublishReputations(map);
    const gate = checkPublishGate("pk1");
    expect(gate.canPublish).toBe(true);
    expect(gate.requiresDeposit).toBe(false);
  });

  it("score exactly at PUBLISH_DEPOSIT_THRESHOLD (-3) is free", () => {
    const map = new Map([["pk1", makeRep("pk1", { validated: 0, flagged: 0, score: PUBLISH_DEPOSIT_THRESHOLD })]]);
    savePublishReputations(map);
    const gate = checkPublishGate("pk1");
    expect(gate.canPublish).toBe(true);
    expect(gate.requiresDeposit).toBe(false);
  });

  it("score -4 requires deposit", () => {
    const map = new Map([["pk1", makeRep("pk1", { score: -4 })]]);
    savePublishReputations(map);
    const gate = checkPublishGate("pk1");
    expect(gate.canPublish).toBe(true);
    expect(gate.requiresDeposit).toBe(true);
  });

  it("score at PUBLISH_BLOCK_THRESHOLD (-10) requires deposit (not blocked)", () => {
    const map = new Map([["pk1", makeRep("pk1", { score: PUBLISH_BLOCK_THRESHOLD })]]);
    savePublishReputations(map);
    const gate = checkPublishGate("pk1");
    expect(gate.canPublish).toBe(true);
    expect(gate.requiresDeposit).toBe(true);
  });

  it("score -11 blocks publishing entirely", () => {
    const map = new Map([["pk1", makeRep("pk1", { score: -11 })]]);
    savePublishReputations(map);
    const gate = checkPublishGate("pk1");
    expect(gate.canPublish).toBe(false);
    expect(gate.requiresDeposit).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// recordPublishValidation / recordPublishFlag
// ---------------------------------------------------------------------------

describe("recordPublishValidation", () => {
  it("creates new reputation with score +1", () => {
    const rep = recordPublishValidation("pk1");
    expect(rep.validated).toBe(1);
    expect(rep.flagged).toBe(0);
    expect(rep.score).toBe(1);
  });

  it("increments validated count and persists", () => {
    recordPublishValidation("pk1");
    const rep = recordPublishValidation("pk1");
    expect(rep.validated).toBe(2);
    expect(rep.score).toBe(2);
    expect(getPublishReputation("pk1")?.score).toBe(2);
  });
});

describe("recordPublishFlag", () => {
  it("creates new reputation with score -2", () => {
    const rep = recordPublishFlag("pk1");
    expect(rep.flagged).toBe(1);
    expect(rep.score).toBe(-2);
  });

  it("2 flags = score -4 (deposit required)", () => {
    recordPublishFlag("pk1");
    recordPublishFlag("pk1");
    const gate = checkPublishGate("pk1");
    expect(gate.requiresDeposit).toBe(true);
  });

  it("validation offsets flags: 2 flags (-4) + 3 validates (+3) = -1 (free)", () => {
    recordPublishFlag("pk1");
    recordPublishFlag("pk1");
    recordPublishValidation("pk1");
    recordPublishValidation("pk1");
    recordPublishValidation("pk1");
    const gate = checkPublishGate("pk1");
    expect(gate.canPublish).toBe(true);
    expect(gate.requiresDeposit).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyReputationRecovery
// ---------------------------------------------------------------------------

describe("applyReputationRecovery", () => {
  const WEEK = 7 * 24 * 60 * 60 * 1000;

  it("no recovery within 7 days", () => {
    const rep = makeRep("pk1", { score: -5, lastActionAt: Date.now() - WEEK + 1000 });
    const recovered = applyReputationRecovery(rep);
    expect(recovered.score).toBe(-5);
  });

  it("+1 recovery after 7 days", () => {
    const rep = makeRep("pk1", { score: -5, lastActionAt: Date.now() - WEEK });
    const recovered = applyReputationRecovery(rep);
    expect(recovered.score).toBe(-4);
  });

  it("+2 recovery after 14 days", () => {
    const rep = makeRep("pk1", { score: -5, lastActionAt: Date.now() - WEEK * 2 });
    const recovered = applyReputationRecovery(rep);
    expect(recovered.score).toBe(-3);
  });

  it("recovery caps at 0", () => {
    const rep = makeRep("pk1", { score: -2, lastActionAt: Date.now() - WEEK * 10 });
    const recovered = applyReputationRecovery(rep);
    expect(recovered.score).toBe(0);
  });

  it("does not mutate the input object", () => {
    const rep = makeRep("pk1", { score: -5, lastActionAt: Date.now() - WEEK * 3 });
    const recovered = applyReputationRecovery(rep);
    expect(rep.score).toBe(-5);
    expect(recovered.score).toBe(-2);
  });

  it("no-ops when score is already >= 0", () => {
    const rep = makeRep("pk1", { score: 3, lastActionAt: Date.now() - WEEK * 5 });
    const recovered = applyReputationRecovery(rep);
    expect(recovered.score).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// D2A independence
// ---------------------------------------------------------------------------

describe("D2A independence", () => {
  it("publish reputation does not affect D2A reputation storage", () => {
    recordPublishFlag("pk1");
    // D2A uses "aegis-d2a-reputation" key
    const d2aRaw = localStorage.getItem("aegis-d2a-reputation");
    expect(d2aRaw).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRep(pubkey: string, overrides: Partial<PublishReputation> = {}): PublishReputation {
  return {
    pubkey,
    validated: 0,
    flagged: 0,
    score: 0,
    lastActionAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}
