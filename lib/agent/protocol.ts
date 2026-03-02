export { KIND_AGENT_PROFILE, KIND_EPHEMERAL, KIND_TEXT_NOTE } from "@/lib/nostr/types";

export const TAG_D2A_PROFILE = "aegis-agent-profile";
export const TAG_D2A_INTEREST = "interest";
export const TAG_D2A_CAPACITY = "capacity";
export const TAG_D2A_PRINCIPAL = "principal";
export const TAG_D2A_OFFER = "aegis-d2a-offer";
export const TAG_D2A_ACCEPT = "aegis-d2a-accept";
export const TAG_D2A_REJECT = "aegis-d2a-reject";
export const TAG_D2A_DELIVER = "aegis-d2a-deliver";
export const TAG_D2A_COMMENT = "aegis-d2a-comment";
export const MAX_COMMENT_LENGTH = 280;

export const PRESENCE_BROADCAST_INTERVAL_MS = 5 * 60 * 1000;
export const PEER_EXPIRY_MS = 15 * 60 * 1000;
export const HANDSHAKE_TIMEOUT_MS = 30 * 1000;
export const DISCOVERY_POLL_INTERVAL_MS = 60 * 1000;

export const RESONANCE_THRESHOLD = 0.3;
export const MIN_OFFER_SCORE = 7.0;

export const MAX_ACTIVITY_LOG = 50;

export const D2A_FEE_TRUSTED = 0;          // Free (WoT-backed peers)
export const D2A_FEE_KNOWN = 100_000;     // 0.001 ICP
export const D2A_FEE_UNKNOWN = 200_000;   // 0.002 ICP
export const D2A_APPROVE_AMOUNT = 10_000_000; // 0.1 ICP
