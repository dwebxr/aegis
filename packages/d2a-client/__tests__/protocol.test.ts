import {
  KIND_AGENT_PROFILE,
  KIND_EPHEMERAL,
  TAG_D2A_PROFILE,
  TAG_D2A_OFFER,
  TAG_D2A_ACCEPT,
  TAG_D2A_REJECT,
  TAG_D2A_DELIVER,
  TAG_D2A_COMMENT,
  MAX_COMMENT_LENGTH,
  MAX_PREVIEW_LENGTH,
  MAX_DELIVER_TEXT_LENGTH,
  MAX_TOPIC_LENGTH,
  MAX_TOPICS_COUNT,
  MIN_OFFER_SCORE,
  RESONANCE_THRESHOLD,
  INTEREST_BROADCAST_THRESHOLD,
  HANDSHAKE_TIMEOUT_MS,
  PEER_EXPIRY_MS,
  PRESENCE_BROADCAST_INTERVAL_MS,
  DISCOVERY_POLL_INTERVAL_MS,
  D2A_FEE_TRUSTED,
  D2A_FEE_KNOWN,
  D2A_FEE_UNKNOWN,
  D2A_APPROVE_AMOUNT,
  DEFAULT_RELAYS,
  mergeRelays,
} from "../src/protocol";

describe("protocol constants — wire-format anchors", () => {
  it("uses kind 30078 for presence and 21078 for ephemeral D2A messages", () => {
    expect(KIND_AGENT_PROFILE).toBe(30078);
    expect(KIND_EPHEMERAL).toBe(21078);
  });

  it("matches every tag value from the D2A v1.0 spec", () => {
    expect(TAG_D2A_PROFILE).toBe("aegis-agent-profile");
    expect(TAG_D2A_OFFER).toBe("aegis-d2a-offer");
    expect(TAG_D2A_ACCEPT).toBe("aegis-d2a-accept");
    expect(TAG_D2A_REJECT).toBe("aegis-d2a-reject");
    expect(TAG_D2A_DELIVER).toBe("aegis-d2a-deliver");
    expect(TAG_D2A_COMMENT).toBe("aegis-d2a-comment");
  });

  it("matches all size limits from the spec Section 8 inventory", () => {
    expect(MAX_COMMENT_LENGTH).toBe(280);
    expect(MAX_PREVIEW_LENGTH).toBe(500);
    expect(MAX_DELIVER_TEXT_LENGTH).toBe(5000);
    expect(MAX_TOPIC_LENGTH).toBe(100);
    expect(MAX_TOPICS_COUNT).toBe(20);
  });

  it("matches all timing constants from the spec", () => {
    expect(PRESENCE_BROADCAST_INTERVAL_MS).toBe(5 * 60 * 1000);
    expect(PEER_EXPIRY_MS).toBe(60 * 60 * 1000);
    expect(HANDSHAKE_TIMEOUT_MS).toBe(30 * 1000);
    expect(DISCOVERY_POLL_INTERVAL_MS).toBe(60 * 1000);
  });

  it("matches all threshold constants", () => {
    expect(MIN_OFFER_SCORE).toBe(7.0);
    expect(RESONANCE_THRESHOLD).toBe(0.15);
    expect(INTEREST_BROADCAST_THRESHOLD).toBe(0.2);
  });

  it("matches the x402 fee schedule", () => {
    expect(D2A_FEE_TRUSTED).toBe(0);
    expect(D2A_FEE_KNOWN).toBe(100_000);
    expect(D2A_FEE_UNKNOWN).toBe(200_000);
    expect(D2A_APPROVE_AMOUNT).toBe(10_000_000);
  });
});

describe("DEFAULT_RELAYS + mergeRelays", () => {
  it("default list contains the three documented relays", () => {
    expect(DEFAULT_RELAYS).toEqual([
      "wss://relay.damus.io",
      "wss://nos.lol",
      "wss://relay.nostr.band",
    ]);
  });

  it("returns the defaults when no hint is supplied", () => {
    expect(mergeRelays()).toEqual([...DEFAULT_RELAYS]);
    expect(mergeRelays(null)).toEqual([...DEFAULT_RELAYS]);
    expect(mergeRelays([])).toEqual([...DEFAULT_RELAYS]);
  });

  it("union-merges hint relays with defaults, deduped, hint-first", () => {
    const merged = mergeRelays(["wss://relay.example", "wss://nos.lol"]);
    expect(merged[0]).toBe("wss://relay.example");
    expect(merged).toContain("wss://relay.damus.io");
    // Dedup: nos.lol appears only once.
    expect(merged.filter(r => r === "wss://nos.lol").length).toBe(1);
  });
});
