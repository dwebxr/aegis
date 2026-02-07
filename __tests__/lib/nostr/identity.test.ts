import { deriveNostrKeypair, deriveNostrKeypairFromText } from "@/lib/nostr/identity";

describe("deriveNostrKeypair", () => {
  it("produces a 32-byte secret key", () => {
    const bytes = new TextEncoder().encode("test-principal");
    const { sk } = deriveNostrKeypair(bytes);
    expect(sk).toBeInstanceOf(Uint8Array);
    expect(sk.length).toBe(32);
  });

  it("produces a hex public key string", () => {
    const bytes = new TextEncoder().encode("test-principal");
    const { pk } = deriveNostrKeypair(bytes);
    expect(typeof pk).toBe("string");
    expect(pk).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same input always produces same output", () => {
    const bytes = new TextEncoder().encode("same-principal");
    const result1 = deriveNostrKeypair(bytes);
    const result2 = deriveNostrKeypair(bytes);
    expect(result1.pk).toBe(result2.pk);
    expect(Array.from(result1.sk)).toEqual(Array.from(result2.sk));
  });

  it("produces different keys for different principals", () => {
    const bytes1 = new TextEncoder().encode("principal-A");
    const bytes2 = new TextEncoder().encode("principal-B");
    const result1 = deriveNostrKeypair(bytes1);
    const result2 = deriveNostrKeypair(bytes2);
    expect(result1.pk).not.toBe(result2.pk);
  });

  it("handles empty input bytes", () => {
    const { sk, pk } = deriveNostrKeypair(new Uint8Array(0));
    expect(sk.length).toBe(32);
    expect(pk).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles large input bytes", () => {
    const bytes = new Uint8Array(1024).fill(42);
    const { sk, pk } = deriveNostrKeypair(bytes);
    expect(sk.length).toBe(32);
    expect(pk).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("deriveNostrKeypairFromText", () => {
  it("delegates to deriveNostrKeypair via TextEncoder", () => {
    const text = "rn4iz-vaaaa-aaaab-qadma-cai";
    const result1 = deriveNostrKeypairFromText(text);
    const result2 = deriveNostrKeypair(new TextEncoder().encode(text));
    expect(result1.pk).toBe(result2.pk);
    expect(Array.from(result1.sk)).toEqual(Array.from(result2.sk));
  });

  it("handles empty string", () => {
    const { sk, pk } = deriveNostrKeypairFromText("");
    expect(sk.length).toBe(32);
    expect(pk).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles unicode in principal text", () => {
    const { sk, pk } = deriveNostrKeypairFromText("日本語テスト");
    expect(sk.length).toBe(32);
    expect(pk).toMatch(/^[0-9a-f]{64}$/);
  });
});
