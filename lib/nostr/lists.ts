import { finalizeEvent } from "nostr-tools/pure";
import { KIND_CATEGORIZED_LIST, DEFAULT_RELAYS } from "./types";
import { publishAndPartition } from "./publish";

const AEGIS_GROUP_PREFIX = "aegis-group-";

export interface CurationListEvent {
  dTag: string;
  name: string;
  description: string;
  members: string[];
  topics: string[];
  ownerPk: string;
  createdAt: number;
}

export async function publishCurationList(
  sk: Uint8Array,
  list: CurationListEvent,
  relayUrls?: string[],
): Promise<{ published: string[]; failed: string[] }> {
  const tags: string[][] = [
    ["d", list.dTag],
    ["name", list.name],
    ["description", list.description],
  ];
  for (const m of list.members) {
    tags.push(["p", m]);
  }
  for (const t of list.topics) {
    tags.push(["t", t]);
  }

  const signed = finalizeEvent(
    {
      kind: KIND_CATEGORIZED_LIST,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: "",
    },
    sk,
  );

  const urls = relayUrls?.length ? relayUrls : DEFAULT_RELAYS;
  return publishAndPartition(signed, urls);
}

export function parseCurationListEvent(event: {
  kind: number;
  pubkey: string;
  created_at: number;
  tags: string[][];
  content: string;
}): CurationListEvent | null {
  if (event.kind !== KIND_CATEGORIZED_LIST) return null;

  const dTag = event.tags.find(t => t[0] === "d")?.[1];
  if (!dTag || !dTag.startsWith(AEGIS_GROUP_PREFIX)) return null;

  const name = event.tags.find(t => t[0] === "name")?.[1] ?? "";
  const description = event.tags.find(t => t[0] === "description")?.[1] ?? "";
  const members = event.tags.filter(t => t[0] === "p").map(t => t[1]).filter(Boolean);
  const topics = event.tags.filter(t => t[0] === "t").map(t => t[1]).filter(Boolean);

  return {
    dTag,
    name,
    description,
    members,
    topics,
    ownerPk: event.pubkey,
    createdAt: event.created_at * 1000,
  };
}

