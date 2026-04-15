/**
 * Wire-format constants for D2A v1.0.
 *
 * Mirrored from https://github.com/dwebxr/aegis/blob/main/lib/agent/protocol.ts.
 * Any change to a value here is a wire-format change and MUST bump the spec
 * version in docs/D2A_PROTOCOL.md (see the Compatibility & extension policy
 * section of that doc).
 */

// Nostr event kinds used by the D2A protocol.
export const KIND_AGENT_PROFILE = 30078; // NIP-78 application-specific replaceable
export const KIND_EPHEMERAL = 21078;     // NIP-01 ephemeral
export const KIND_TEXT_NOTE = 1;

// Default Nostr relays an Aegis-compatible agent SHOULD reach to maximize
// interoperability with live agents. An implementation MAY accept additional
// user-supplied relays via mergeRelays().
export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
] as const;

export function mergeRelays(hintRelays?: readonly string[] | null): string[] {
  if (!hintRelays || hintRelays.length === 0) return [...DEFAULT_RELAYS];
  return Array.from(new Set([...hintRelays, ...DEFAULT_RELAYS]));
}

// Tag values used in the presence event and message events.
export const TAG_D2A_PROFILE = "aegis-agent-profile";
export const TAG_D2A_INTEREST = "interest";
export const TAG_D2A_CAPACITY = "capacity";
export const TAG_D2A_PRINCIPAL = "principal";
export const TAG_D2A_OFFER = "aegis-d2a-offer";
export const TAG_D2A_ACCEPT = "aegis-d2a-accept";
export const TAG_D2A_REJECT = "aegis-d2a-reject";
export const TAG_D2A_DELIVER = "aegis-d2a-deliver";
export const TAG_D2A_COMMENT = "aegis-d2a-comment";

// Size limits enforced by validators on inbound messages and clamps on
// outbound messages.
export const MAX_COMMENT_LENGTH = 280;
export const MAX_PREVIEW_LENGTH = 500;
export const MAX_DELIVER_TEXT_LENGTH = 5000;
export const MAX_TOPIC_LENGTH = 100;
export const MAX_TOPICS_COUNT = 20;

// Cadence and timeout constants. All values are milliseconds.
export const PRESENCE_BROADCAST_INTERVAL_MS = 5 * 60 * 1000;
export const PEER_EXPIRY_MS = 60 * 60 * 1000;
export const HANDSHAKE_TIMEOUT_MS = 30 * 1000;
export const DISCOVERY_POLL_INTERVAL_MS = 60 * 1000;

// Resonance and offer thresholds.
export const INTEREST_BROADCAST_THRESHOLD = 0.2;
export const RESONANCE_THRESHOLD = 0.15;
export const MIN_OFFER_SCORE = 7.0;

// x402 fee schedule (e8s, where 1 ICP = 100,000,000 e8s).
export const D2A_FEE_TRUSTED = 0;
export const D2A_FEE_KNOWN = 100_000;       // 0.001 ICP
export const D2A_FEE_UNKNOWN = 200_000;     // 0.002 ICP
export const D2A_APPROVE_AMOUNT = 10_000_000; // 0.1 ICP
