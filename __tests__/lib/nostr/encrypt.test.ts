import { encryptMessage, decryptMessage } from "@/lib/nostr/encrypt";
import { deriveNostrKeypairFromText } from "@/lib/nostr/identity";

describe("NIP-44 encrypt/decrypt roundtrip", () => {
  const alice = deriveNostrKeypairFromText("alice-principal");
  const bob = deriveNostrKeypairFromText("bob-principal");

  it("encrypts and decrypts a simple message", () => {
    const plaintext = "Hello, Bob!";
    const encrypted = encryptMessage(plaintext, alice.sk, bob.pk);
    expect(typeof encrypted).toBe("string");
    expect(encrypted).not.toBe(plaintext);

    const decrypted = decryptMessage(encrypted, bob.sk, alice.pk);
    expect(decrypted).toBe(plaintext);
  });

  it("encrypts and decrypts JSON payloads", () => {
    const payload = JSON.stringify({
      type: "offer",
      topic: "ai",
      score: 8.5,
    });
    const encrypted = encryptMessage(payload, alice.sk, bob.pk);
    const decrypted = decryptMessage(encrypted, bob.sk, alice.pk);
    expect(JSON.parse(decrypted)).toEqual({
      type: "offer",
      topic: "ai",
      score: 8.5,
    });
  });

  it("produces different ciphertext for same plaintext (randomized nonce)", () => {
    const msg = "Same message";
    const c1 = encryptMessage(msg, alice.sk, bob.pk);
    const c2 = encryptMessage(msg, alice.sk, bob.pk);
    // NIP-44 uses random nonce, so ciphertexts should differ
    expect(c1).not.toBe(c2);
    // But both decrypt to the same plaintext
    expect(decryptMessage(c1, bob.sk, alice.pk)).toBe(msg);
    expect(decryptMessage(c2, bob.sk, alice.pk)).toBe(msg);
  });

  it("fails to decrypt with wrong key", () => {
    const charlie = deriveNostrKeypairFromText("charlie-principal");
    const encrypted = encryptMessage("secret", alice.sk, bob.pk);
    expect(() => {
      decryptMessage(encrypted, charlie.sk, alice.pk);
    }).toThrow();
  });

  it("rejects empty string (NIP-44 requires 1-65535 bytes)", () => {
    expect(() => encryptMessage("", alice.sk, bob.pk)).toThrow();
  });

  it("handles single character (minimum valid plaintext)", () => {
    const encrypted = encryptMessage("x", alice.sk, bob.pk);
    const decrypted = decryptMessage(encrypted, bob.sk, alice.pk);
    expect(decrypted).toBe("x");
  });

  it("handles unicode content", () => {
    const msg = "日本語のメッセージ 🔑🛡️";
    const encrypted = encryptMessage(msg, alice.sk, bob.pk);
    const decrypted = decryptMessage(encrypted, bob.sk, alice.pk);
    expect(decrypted).toBe(msg);
  });

  it("handles long messages", () => {
    const msg = "x".repeat(5000);
    const encrypted = encryptMessage(msg, alice.sk, bob.pk);
    const decrypted = decryptMessage(encrypted, bob.sk, alice.pk);
    expect(decrypted).toBe(msg);
  });
});
