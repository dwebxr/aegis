import { v2 as nip44 } from "nostr-tools/nip44";

/** NIP-44 encryption — relay operators cannot read D2A exchanges. */
export function encryptMessage(
  plaintext: string,
  senderSk: Uint8Array,
  recipientPk: string,
): string {
  const conversationKey = nip44.utils.getConversationKey(senderSk, recipientPk);
  return nip44.encrypt(plaintext, conversationKey);
}

export function decryptMessage(
  ciphertext: string,
  recipientSk: Uint8Array,
  senderPk: string,
): string {
  const conversationKey = nip44.utils.getConversationKey(recipientSk, senderPk);
  return nip44.decrypt(ciphertext, conversationKey);
}
