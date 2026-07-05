import { decode, npubEncode } from "nostr-tools/nip19";
import { SimplePool } from "nostr-tools/pool";
import { DEFAULT_RELAYS } from "./types";
import { clearWoTCache } from "@/lib/wot/cache";
import { withTimeout } from "@/lib/utils/timeout";
import { errMsg } from "@/lib/utils/errors";
import { nsToMs } from "@/lib/utils/icTime";

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
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.npub !== "string" || typeof parsed.pubkeyHex !== "string") {
      console.warn("[linkAccount] Corrupted linked account data, clearing");
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    // Provide defaults for fields that may be missing in older stored data
    return {
      npub: parsed.npub,
      pubkeyHex: parsed.pubkeyHex,
      displayName: typeof parsed.displayName === "string" ? parsed.displayName : undefined,
      linkedAt: typeof parsed.linkedAt === "number" ? parsed.linkedAt : 0,
      followCount: typeof parsed.followCount === "number" ? parsed.followCount : 0,
    };
  } catch (err) {
    console.warn("[linkAccount] Failed to parse linked account:", errMsg(err));
    return null;
  }
}

export function saveLinkedAccount(account: LinkedNostrAccount): boolean {
  if (typeof globalThis.localStorage === "undefined") return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
    return true;
  } catch (err) {
    console.warn("[linkAccount] Failed to save linked account:", errMsg(err));
    return false;
  }
}

export function clearLinkedAccount(): void {
  if (typeof globalThis.localStorage === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { console.warn("[nostr-link] localStorage unavailable"); }
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
        } catch { console.warn("[linkAccount] Skipped malformed profile JSON for", pubkeyHex.slice(0, 8)); }
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
    throw new Error("Failed to save linked account");
  }
  await clearWoTCache();

  return account;
}

// Dynamic imports keep @dfinity/agent out of test bundles.
//
// The on-chain field is still named `d2aEnabled` (persistent Candid field) but
// it now means "public briefing sharing": the canister's only uses of it are
// gating saveLatestBriefing, filtering the public briefing reads, and purging
// the snapshot when set false. The briefing-sharing toggle is the only UI that
// should decide its value.
//
// Returns true only when the canister write succeeded — callers that flip
// client state on success (the briefing-share toggle) must check this, or
// they'd start publishing against a canister that still rejects it. Legacy
// fire-and-forget callers may ignore the result.
export async function syncLinkedAccountToIC(
  identity: import("@dfinity/agent").Identity,
  account: LinkedNostrAccount | null,
  briefingShareEnabled: boolean,
): Promise<boolean> {
  try {
    const { createBackendActorAsync } = await import("@/lib/ic/actor");
    const backend = await createBackendActorAsync(identity);
    await backend.saveUserSettings({
      linkedNostrNpub: account?.npub ? [account.npub] : [],
      linkedNostrPubkeyHex: account?.pubkeyHex ? [account.pubkeyHex] : [],
      d2aEnabled: briefingShareEnabled,
      updatedAt: BigInt(0), // Server overrides with Time.now()
    });
    return true;
  } catch (err) {
    console.warn("[nostr] Failed to sync settings to IC:", errMsg(err));
    return false;
  }
}

export function parseICSettings(
  settings: { linkedNostrNpub: string[]; linkedNostrPubkeyHex: string[]; d2aEnabled: boolean; updatedAt?: bigint },
): { account: LinkedNostrAccount | null; d2aEnabled: boolean } {
  const npub = settings.linkedNostrNpub.length > 0 ? settings.linkedNostrNpub[0] : null;
  const pubkeyHex = settings.linkedNostrPubkeyHex.length > 0 ? settings.linkedNostrPubkeyHex[0] : null;

  let account: LinkedNostrAccount | null = null;
  if (npub && pubkeyHex) {
    // Use IC's updatedAt (nanoseconds → ms) as linkedAt; fall back to 0 if unavailable
    const linkedAt = settings.updatedAt ? nsToMs(settings.updatedAt) : 0;
    account = {
      npub,
      pubkeyHex,
      linkedAt,
      followCount: 0, // Will be hydrated from relays
    };
  }

  return { account, d2aEnabled: settings.d2aEnabled };
}

/** Reads the caller's on-chain settings. The result distinguishes "the read
 *  FAILED" ({ok:false}) from "no settings saved yet" ({ok:true, settings:null})
 *  — the briefing-share toggle must abort its wholesale saveUserSettings write
 *  on a failed read, or a null local account could wipe an on-chain linked
 *  account it simply couldn't see. */
export type ICSettingsRead =
  | { ok: true; settings: { account: LinkedNostrAccount | null; d2aEnabled: boolean } | null }
  | { ok: false };

export async function loadSettingsFromIC(
  identity: import("@dfinity/agent").Identity,
  principalText: string,
): Promise<ICSettingsRead> {
  try {
    const { createBackendActorAsync } = await import("@/lib/ic/actor");
    const { Principal } = await import("@dfinity/principal");
    const backend = await createBackendActorAsync(identity);
    const principal = Principal.fromText(principalText);
    const result = await backend.getUserSettings(principal);

    if (result.length === 0) return { ok: true, settings: null };
    return { ok: true, settings: parseICSettings(result[0]) };
  } catch (err) {
    console.warn("[nostr] Failed to load settings from IC:", errMsg(err));
    return { ok: false };
  }
}
