import {
  KIND_AGENT_PROFILE,
  KIND_EPHEMERAL,
  KIND_TEXT_NOTE,
  TAG_D2A_PROFILE,
  TAG_D2A_INTEREST,
  TAG_D2A_CAPACITY,
  TAG_D2A_OFFER,
  TAG_D2A_ACCEPT,
  TAG_D2A_REJECT,
  TAG_D2A_DELIVER,
  PRESENCE_BROADCAST_INTERVAL_MS,
  PEER_EXPIRY_MS,
  HANDSHAKE_TIMEOUT_MS,
  DISCOVERY_POLL_INTERVAL_MS,
  RESONANCE_THRESHOLD,
  MIN_OFFER_SCORE,
} from "@/lib/agent/protocol";

describe("protocol constants", () => {
  describe("Nostr kind constants", () => {
    it("exports correct kind values", () => {
      expect(KIND_TEXT_NOTE).toBe(1);
      expect(KIND_AGENT_PROFILE).toBe(30078); // NIP-78 replaceable
      expect(KIND_EPHEMERAL).toBe(21078);
    });
  });

  describe("tag constants", () => {
    it("has unique tag values for each message type", () => {
      const tags = [TAG_D2A_OFFER, TAG_D2A_ACCEPT, TAG_D2A_REJECT, TAG_D2A_DELIVER];
      const unique = new Set(tags);
      expect(unique.size).toBe(4);
    });

    it("uses correct tag prefixes", () => {
      expect(TAG_D2A_PROFILE).toBe("aegis-agent-profile");
      expect(TAG_D2A_INTEREST).toBe("interest");
      expect(TAG_D2A_CAPACITY).toBe("capacity");
      expect(TAG_D2A_OFFER).toContain("aegis-d2a");
      expect(TAG_D2A_ACCEPT).toContain("aegis-d2a");
      expect(TAG_D2A_REJECT).toContain("aegis-d2a");
      expect(TAG_D2A_DELIVER).toContain("aegis-d2a");
    });
  });

  describe("timing constants", () => {
    it("has reasonable interval values", () => {
      expect(PRESENCE_BROADCAST_INTERVAL_MS).toBe(5 * 60 * 1000); // 5 min
      expect(PEER_EXPIRY_MS).toBe(15 * 60 * 1000); // 15 min
      expect(HANDSHAKE_TIMEOUT_MS).toBe(30 * 1000); // 30 sec
      expect(DISCOVERY_POLL_INTERVAL_MS).toBe(60 * 1000); // 1 min
    });

    it("peer expiry > presence broadcast (peers survive between broadcasts)", () => {
      expect(PEER_EXPIRY_MS).toBeGreaterThan(PRESENCE_BROADCAST_INTERVAL_MS);
    });

    it("handshake timeout < discovery poll (handshakes resolve between polls)", () => {
      expect(HANDSHAKE_TIMEOUT_MS).toBeLessThan(DISCOVERY_POLL_INTERVAL_MS);
    });
  });

  describe("threshold constants", () => {
    it("has correct threshold values", () => {
      expect(RESONANCE_THRESHOLD).toBe(0.3);
      expect(MIN_OFFER_SCORE).toBe(7.0);
    });

    it("resonance threshold is in valid range (0-1)", () => {
      expect(RESONANCE_THRESHOLD).toBeGreaterThan(0);
      expect(RESONANCE_THRESHOLD).toBeLessThan(1);
    });

    it("min offer score is in valid range (0-10)", () => {
      expect(MIN_OFFER_SCORE).toBeGreaterThanOrEqual(0);
      expect(MIN_OFFER_SCORE).toBeLessThanOrEqual(10);
    });
  });
});
