import { deriveNostrKeypairFromText } from "@/lib/nostr/identity";

describe("deriveNostrKeypairFromText", () => {
  it("produces a 32-byte secret key", () => {
    const { sk } = deriveNostrKeypairFromText("test-principal");
    expect(sk).toBeInstanceOf(Uint8Array);
    expect(sk.length).toBe(32);
  });

  it("produces a hex public key string", () => {
    const { pk } = deriveNostrKeypairFromText("test-principal");
    expect(typeof pk).toBe("string");
    expect(pk).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same input always produces same output", () => {
    const result1 = deriveNostrKeypairFromText("same-principal");
    const result2 = deriveNostrKeypairFromText("same-principal");
    expect(result1.pk).toBe(result2.pk);
    expect(Array.from(result1.sk)).toEqual(Array.from(result2.sk));
  });

  it("produces different keys for different principals", () => {
    const result1 = deriveNostrKeypairFromText("principal-A");
    const result2 = deriveNostrKeypairFromText("principal-B");
    expect(result1.pk).not.toBe(result2.pk);
  });

  it("handles empty string", () => {
    const { sk, pk } = deriveNostrKeypairFromText("");
    expect(sk.length).toBe(32);
    expect(pk).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles large input text", () => {
    const { sk, pk } = deriveNostrKeypairFromText("x".repeat(1024));
    expect(sk.length).toBe(32);
    expect(pk).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles unicode in principal text", () => {
    const { sk, pk } = deriveNostrKeypairFromText("日本語テスト");
    expect(sk.length).toBe(32);
    expect(pk).toMatch(/^[0-9a-f]{64}$/);
  });

  it("different text produces different keys even for similar inputs", () => {
    const r1 = deriveNostrKeypairFromText("aaaaa-aa");
    const r2 = deriveNostrKeypairFromText("aaaaa-ab");
    expect(r1.pk).not.toBe(r2.pk);
  });

  it("IC principal format produces valid keys", () => {
    const { sk, pk } = deriveNostrKeypairFromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
    expect(sk.length).toBe(32);
    expect(pk).toMatch(/^[0-9a-f]{64}$/);
  });
});
