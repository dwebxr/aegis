import { sha256 } from "@noble/hashes/sha2.js";
import { getPublicKey } from "nostr-tools/pure";

const DERIVATION_CONTEXT = new TextEncoder().encode("aegis-nostr-v1");

/**
 * Derive a deterministic Nostr keypair from an IC Principal.
 * This means the user never needs to manage a separate Nostr key —
 * their IC identity IS their Nostr identity.
 */
export function deriveNostrKeypair(principalBytes: Uint8Array): { sk: Uint8Array; pk: string } {
  // Concatenate principal bytes + derivation context
  const material = new Uint8Array(principalBytes.length + DERIVATION_CONTEXT.length);
  material.set(principalBytes);
  material.set(DERIVATION_CONTEXT, principalBytes.length);

  // SHA-256 produces 32 bytes → valid secp256k1 private key
  const sk = sha256(material);
  const pk = getPublicKey(sk);
  return { sk, pk };
}

/**
 * Derive from principal text (the common string form).
 */
export function deriveNostrKeypairFromText(principalText: string): { sk: Uint8Array; pk: string } {
  const bytes = new TextEncoder().encode(principalText);
  return deriveNostrKeypair(bytes);
}
