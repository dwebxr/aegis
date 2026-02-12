export { KIND_AGENT_PROFILE, KIND_EPHEMERAL, KIND_TEXT_NOTE } from "@/lib/nostr/types";

// D2A event tag constants
export const TAG_D2A_PROFILE = "aegis-agent-profile";
export const TAG_D2A_INTEREST = "interest";
export const TAG_D2A_CAPACITY = "capacity";
export const TAG_D2A_PRINCIPAL = "principal"; // IC principal for on-chain fee settlement
export const TAG_D2A_OFFER = "aegis-d2a-offer";
export const TAG_D2A_ACCEPT = "aegis-d2a-accept";
export const TAG_D2A_REJECT = "aegis-d2a-reject";
export const TAG_D2A_DELIVER = "aegis-d2a-deliver";

export const PRESENCE_BROADCAST_INTERVAL_MS = 5 * 60 * 1000; // 5 min
export const PEER_EXPIRY_MS = 15 * 60 * 1000; // 15 min
export const HANDSHAKE_TIMEOUT_MS = 30 * 1000; // 30 sec
export const DISCOVERY_POLL_INTERVAL_MS = 60 * 1000; // 1 min

export const RESONANCE_THRESHOLD = 0.3;
export const MIN_OFFER_SCORE = 7.0;

// D2A match fee: 0.001 ICP (100_000 e8s) per successful content delivery
export const D2A_MATCH_FEE = 100_000;
// Blanket ICRC-2 approve amount: 0.1 ICP covers ~100 matches
export const D2A_APPROVE_AMOUNT = 10_000_000;
