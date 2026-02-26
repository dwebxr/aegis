import { sha256 } from "@noble/hashes/sha2.js";

export function hexFromBytes(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Normalize text (lowercase, strip punctuation, collapse whitespace, first 500 chars) and SHA-256 → 32-char hex. */
export function computeContentFingerprint(text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  const hash = sha256(new TextEncoder().encode(normalized));
  return hexFromBytes(hash.slice(0, 16));
}

/** Raw SHA-256 of text → 32-char hex (no normalization). */
export function hashContent(text: string): string {
  const hash = sha256(new TextEncoder().encode(text));
  return hexFromBytes(hash.slice(0, 16));
}
