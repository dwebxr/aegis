export interface AegisNostrEvent {
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
}

export interface PublishedSignalData {
  id: string;
  text: string;
  nostrEventId: string | null;
  nostrPubkey: string;
  scores: {
    originality: number;
    insight: number;
    credibility: number;
    composite: number;
  };
  verdict: "quality" | "slop";
  topics: string[];
  createdAt: number;
}

// Nostr Kind constants
export const KIND_TEXT_NOTE = 1;
export const KIND_AGENT_PROFILE = 30078;
export const KIND_EPHEMERAL = 21078;
