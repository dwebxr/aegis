import { decode, npubEncode } from "nostr-tools/nip19";
import { SimplePool } from "nostr-tools/pool";
import { DEFAULT_RELAYS } from "./types";
import { clearWoTCache } from "@/lib/wot/cache";
import { withTimeout } from "@/lib/utils/timeout";

const STORAGE_KEY = "aegis-linked-nostr";

export interface LinkedNostrAccount {
  npub: string;
  pubkeyHex: string;
  displayName?: string;
  linkedAt: number;
  followCount: number;
}

export function getLinkedAccount(): LinkedNostrAccount | null {
  if (typeof globalThis.localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LinkedNostrAccount;
  } catch {
    return null;
  }
}

export function saveLinkedAccount(account: LinkedNostrAccount): boolean {
  if (typeof globalThis.localStorage === "undefined") return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
    return true;
  } catch {
    return false;
  }
}

export function clearLinkedAccount(): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

export function maskNpub(npub: string): string {
  if (npub.length <= 16) return npub;
  return `${npub.slice(0, 10)}…${npub.slice(-6)}`;
}

export function resolveNostrInput(input: string): { pubkeyHex: string; npub: string } {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Input is empty");

  // Security: never accept secret keys
  if (trimmed.startsWith("nsec1")) {
    throw new Error("Secret keys (nsec) are not accepted. Use your public key (npub).");
  }

  if (trimmed.startsWith("npub1")) {
    try {
      const decoded = decode(trimmed);
      if (decoded.type !== "npub") {
        throw new Error(`Expected npub, got ${decoded.type}`);
      }
      return { pubkeyHex: decoded.data, npub: trimmed };
    } catch (e) {
      if (e instanceof Error && e.message.includes("npub")) throw e;
      throw new Error("Invalid npub format");
    }
  }

  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    const hex = trimmed.toLowerCase();
    return { pubkeyHex: hex, npub: npubEncode(hex) };
  }

  throw new Error("Invalid input: expected npub1… or 64-char hex pubkey");
}

export async function fetchNostrProfile(
  pubkeyHex: string,
): Promise<{ displayName?: string; followCount: number }> {
  const pool = new SimplePool();
  try {
    const events = await withTimeout(
      pool.querySync(DEFAULT_RELAYS, {
        authors: [pubkeyHex],
        kinds: [0, 3],
      }),
      10_000,
      "Relay query timed out",
    );

    let displayName: string | undefined;
    let followCount = 0;

    for (const ev of events) {
      if (ev.kind === 0) {
        try {
          const meta = JSON.parse(ev.content);
          displayName = meta.display_name || meta.name || undefined;
        } catch {}
      }
      if (ev.kind === 3) {
        followCount = ev.tags.filter((t: string[]) => t[0] === "p").length;
      }
    }

    return { displayName, followCount };
  } finally {
    pool.destroy();
  }
}

export async function linkNostrAccount(
  input: string,
  onProgress?: (status: string) => void,
): Promise<LinkedNostrAccount> {
  const { pubkeyHex, npub } = resolveNostrInput(input);

  onProgress?.("Fetching profile…");
  const { displayName, followCount } = await fetchNostrProfile(pubkeyHex);

  const account: LinkedNostrAccount = {
    npub,
    pubkeyHex,
    displayName,
    linkedAt: Date.now(),
    followCount,
  };

  const saved = saveLinkedAccount(account);
  if (!saved) {
    throw new Error("Failed to save linked account — localStorage may be full");
  }
  clearWoTCache();

  return account;
}
