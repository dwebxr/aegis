import { sha256 } from "@noble/hashes/sha2.js";
import { getPublicKey } from "nostr-tools/pure";

const DERIVATION_CONTEXT = new TextEncoder().encode("aegis-nostr-v1");

function deriveNostrKeypair(principalBytes: Uint8Array): { sk: Uint8Array; pk: string } {
  const material = new Uint8Array(principalBytes.length + DERIVATION_CONTEXT.length);
  material.set(principalBytes);
  material.set(DERIVATION_CONTEXT, principalBytes.length);

  const sk = sha256(material);
  const pk = getPublicKey(sk);
  return { sk, pk };
}

export function deriveNostrKeypairFromText(principalText: string): { sk: Uint8Array; pk: string } {
  return deriveNostrKeypair(new TextEncoder().encode(principalText));
}
