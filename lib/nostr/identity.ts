import { sha256 } from "@noble/hashes/sha2.js";
import { getPublicKey } from "nostr-tools/pure";

const DERIVATION_CONTEXT = new TextEncoder().encode("aegis-nostr-v1");

export function deriveNostrKeypairFromText(principalText: string): { sk: Uint8Array; pk: string } {
  const principalBytes = new TextEncoder().encode(principalText);
  const material = new Uint8Array(principalBytes.length + DERIVATION_CONTEXT.length);
  material.set(principalBytes);
  material.set(DERIVATION_CONTEXT, principalBytes.length);

  const sk = sha256(material);
  const pk = getPublicKey(sk);
  return { sk, pk };
}
