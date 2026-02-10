export const KIND_TEXT_NOTE = 1;
export const KIND_LONG_FORM = 30023;
export const KIND_AGENT_PROFILE = 30078;
export const KIND_EPHEMERAL = 21078;

export const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
];

/** Merge naddr hint relays with defaults, deduplicated */
export function mergeRelays(hintRelays?: string[]): string[] {
  if (!hintRelays?.length) return DEFAULT_RELAYS;
  return Array.from(new Set([...hintRelays, ...DEFAULT_RELAYS]));
}
