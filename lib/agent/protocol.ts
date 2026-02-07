// Re-export Nostr Kind constants from canonical source
export { KIND_AGENT_PROFILE, KIND_EPHEMERAL, KIND_TEXT_NOTE } from "@/lib/nostr/types";

// D2A event tag constants
export const TAG_D2A_PROFILE = "aegis-agent-profile";
export const TAG_D2A_INTEREST = "interest";
export const TAG_D2A_CAPACITY = "capacity";
export const TAG_D2A_OFFER = "aegis-d2a-offer";
export const TAG_D2A_ACCEPT = "aegis-d2a-accept";
export const TAG_D2A_REJECT = "aegis-d2a-reject";
export const TAG_D2A_DELIVER = "aegis-d2a-deliver";

// Timing
export const PRESENCE_BROADCAST_INTERVAL_MS = 5 * 60 * 1000; // 5 min
export const PEER_EXPIRY_MS = 15 * 60 * 1000; // 15 min
export const HANDSHAKE_TIMEOUT_MS = 30 * 1000; // 30 sec
export const DISCOVERY_POLL_INTERVAL_MS = 60 * 1000; // 1 min

// Thresholds
export const RESONANCE_THRESHOLD = 0.3;
export const MIN_OFFER_SCORE = 7.0;
