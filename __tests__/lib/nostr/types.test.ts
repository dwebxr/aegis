/**
 * Tests for lib/nostr/types.ts — constants and mergeRelays utility.
 */
import {
  KIND_TEXT_NOTE,
  KIND_LONG_FORM,
  KIND_AGENT_PROFILE,
  KIND_EPHEMERAL,
  DEFAULT_RELAYS,
  mergeRelays,
} from "@/lib/nostr/types";

describe("Nostr kind constants", () => {
  it("KIND_TEXT_NOTE is 1 (NIP-01)", () => {
    expect(KIND_TEXT_NOTE).toBe(1);
  });

  it("KIND_LONG_FORM is 30023 (NIP-23)", () => {
    expect(KIND_LONG_FORM).toBe(30023);
  });

  it("KIND_AGENT_PROFILE is 30078 (application-specific)", () => {
    expect(KIND_AGENT_PROFILE).toBe(30078);
  });

  it("KIND_EPHEMERAL is 21078 (D2A ephemeral messaging)", () => {
    expect(KIND_EPHEMERAL).toBe(21078);
  });
});

describe("DEFAULT_RELAYS", () => {
  it("contains at least 3 relays", () => {
    expect(DEFAULT_RELAYS.length).toBeGreaterThanOrEqual(3);
  });

  it("all relays use wss:// protocol", () => {
    DEFAULT_RELAYS.forEach(relay => {
      expect(relay).toMatch(/^wss:\/\//);
    });
  });

  it("has no duplicates", () => {
    const unique = new Set(DEFAULT_RELAYS);
    expect(unique.size).toBe(DEFAULT_RELAYS.length);
  });
});

describe("mergeRelays", () => {
  it("returns DEFAULT_RELAYS when no hints provided", () => {
    expect(mergeRelays()).toEqual(DEFAULT_RELAYS);
  });

  it("returns DEFAULT_RELAYS when hints is undefined", () => {
    expect(mergeRelays(undefined)).toEqual(DEFAULT_RELAYS);
  });

  it("returns DEFAULT_RELAYS when hints is empty array", () => {
    expect(mergeRelays([])).toEqual(DEFAULT_RELAYS);
  });

  it("merges hint relays with defaults", () => {
    const hints = ["wss://custom.relay.com"];
    const result = mergeRelays(hints);
    expect(result).toContain("wss://custom.relay.com");
    DEFAULT_RELAYS.forEach(relay => {
      expect(result).toContain(relay);
    });
  });

  it("deduplicates when hint overlaps with default", () => {
    const hints = [DEFAULT_RELAYS[0], "wss://custom.relay.com"];
    const result = mergeRelays(hints);
    const countOfFirst = result.filter(r => r === DEFAULT_RELAYS[0]).length;
    expect(countOfFirst).toBe(1);
  });

  it("puts hint relays first", () => {
    const hints = ["wss://priority.relay.com"];
    const result = mergeRelays(hints);
    expect(result[0]).toBe("wss://priority.relay.com");
  });

  it("handles many hint relays", () => {
    const hints = Array.from({ length: 10 }, (_, i) => `wss://relay${i}.example.com`);
    const result = mergeRelays(hints);
    expect(result.length).toBe(10 + DEFAULT_RELAYS.length); // no overlap
    hints.forEach(h => expect(result).toContain(h));
  });

  it("deduplicates all-overlapping hints", () => {
    // All hints are defaults
    const result = mergeRelays([...DEFAULT_RELAYS]);
    expect(result.length).toBe(DEFAULT_RELAYS.length);
  });
});
