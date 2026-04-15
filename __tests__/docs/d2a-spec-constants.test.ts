/**
 * Drift guard for docs/D2A_PROTOCOL.md.
 *
 * The spec's "Constants inventory" table is the canonical reference for any
 * external D2A implementation. If the code changes a constant without the
 * spec being updated in lockstep, this test fails so CI catches the drift.
 */

import { readFileSync } from "fs";
import { join } from "path";
import * as protocol from "@/lib/agent/protocol";

const SPEC_PATH = join(__dirname, "..", "..", "docs", "D2A_PROTOCOL.md");
const SPEC = readFileSync(SPEC_PATH, "utf8");

interface Expectation {
  name: keyof typeof protocol;
  expected: string | number;
  /** Override the literal that appears in the spec table when it differs from `String(expected)`. */
  literal?: string;
}

/** Each row of Section 8 ("Constants inventory") in the spec. */
const EXPECTATIONS: Expectation[] = [
  { name: "KIND_AGENT_PROFILE", expected: 30078 },
  { name: "KIND_EPHEMERAL", expected: 21078 },
  { name: "TAG_D2A_PROFILE", expected: "aegis-agent-profile" },
  { name: "TAG_D2A_INTEREST", expected: "interest" },
  { name: "TAG_D2A_CAPACITY", expected: "capacity" },
  { name: "TAG_D2A_PRINCIPAL", expected: "principal" },
  { name: "TAG_D2A_OFFER", expected: "aegis-d2a-offer" },
  { name: "TAG_D2A_ACCEPT", expected: "aegis-d2a-accept" },
  { name: "TAG_D2A_REJECT", expected: "aegis-d2a-reject" },
  { name: "TAG_D2A_DELIVER", expected: "aegis-d2a-deliver" },
  { name: "TAG_D2A_COMMENT", expected: "aegis-d2a-comment" },
  { name: "MAX_COMMENT_LENGTH", expected: 280 },
  { name: "MAX_PREVIEW_LENGTH", expected: 500 },
  { name: "MAX_DELIVER_TEXT_LENGTH", expected: 5000 },
  { name: "MAX_TOPIC_LENGTH", expected: 100 },
  { name: "MAX_TOPICS_COUNT", expected: 20 },
  { name: "PRESENCE_BROADCAST_INTERVAL_MS", expected: 300_000, literal: "300_000" },
  { name: "PEER_EXPIRY_MS", expected: 3_600_000, literal: "3_600_000" },
  { name: "HANDSHAKE_TIMEOUT_MS", expected: 30_000, literal: "30_000" },
  { name: "DISCOVERY_POLL_INTERVAL_MS", expected: 60_000, literal: "60_000" },
  { name: "INTEREST_BROADCAST_THRESHOLD", expected: 0.2 },
  { name: "RESONANCE_THRESHOLD", expected: 0.15 },
  { name: "MIN_OFFER_SCORE", expected: 7.0, literal: "7.0" },
  { name: "MAX_ACTIVITY_LOG", expected: 50 },
  { name: "D2A_FEE_TRUSTED", expected: 0 },
  { name: "D2A_FEE_KNOWN", expected: 100_000, literal: "100_000" },
  { name: "D2A_FEE_UNKNOWN", expected: 200_000, literal: "200_000" },
  { name: "D2A_APPROVE_AMOUNT", expected: 10_000_000, literal: "10_000_000" },
];

describe("docs/D2A_PROTOCOL.md spec drift guard", () => {
  describe.each(EXPECTATIONS)("$name", ({ name, expected, literal }) => {
    it("matches the value in lib/agent/protocol.ts", () => {
      expect(protocol[name]).toBe(expected);
    });

    it("appears verbatim in the spec's Constants inventory table", () => {
      // String constants are quoted in the spec for clarity (e.g. `"aegis-agent-profile"`);
      // numeric constants are bare (e.g. `30078`).
      const literalForSearch =
        literal ?? (typeof expected === "string" ? `"${expected}"` : String(expected));
      const cell = `\`${name}\` | \`${literalForSearch}\``;
      expect(SPEC).toContain(cell);
    });
  });

  it("documents MAX_MANIFEST_ENTRIES = 50 in lockstep with lib/d2a/manifest.ts", () => {
    // MAX_MANIFEST_ENTRIES is local to manifest.ts (not exported) — read it from source directly.
    const manifestSrc = readFileSync(
      join(__dirname, "..", "..", "lib", "d2a", "manifest.ts"),
      "utf8",
    );
    const match = manifestSrc.match(/const MAX_MANIFEST_ENTRIES\s*=\s*(\d+)/);
    expect(match).not.toBeNull();
    const codeValue = parseInt(match![1], 10);
    expect(codeValue).toBe(50);
    expect(SPEC).toContain("`MAX_MANIFEST_ENTRIES` | `50`");
  });

  it("documents the three default Nostr relays from lib/nostr/types.ts", () => {
    const relays = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"];
    for (const relay of relays) {
      expect(SPEC).toContain(relay);
    }
  });

  it("declares spec version 1.0", () => {
    expect(SPEC).toContain("**Version**: 1.0");
    expect(SPEC).toContain("| 1.0 | 2026-04-15 |");
  });
});
