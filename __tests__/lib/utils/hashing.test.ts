import { hexFromBytes, computeContentFingerprint, hashContent } from "@/lib/utils/hashing";

describe("hexFromBytes", () => {
  it("converts empty Uint8Array to empty string", () => {
    expect(hexFromBytes(new Uint8Array([]))).toBe("");
  });

  it("converts single byte to 2-char hex", () => {
    expect(hexFromBytes(new Uint8Array([0]))).toBe("00");
    expect(hexFromBytes(new Uint8Array([255]))).toBe("ff");
    expect(hexFromBytes(new Uint8Array([16]))).toBe("10");
    expect(hexFromBytes(new Uint8Array([1]))).toBe("01");
  });

  it("pads single-digit hex values with leading zero", () => {
    // Values 0-15 should be 00-0f
    expect(hexFromBytes(new Uint8Array([0x0a]))).toBe("0a");
    expect(hexFromBytes(new Uint8Array([0x0f]))).toBe("0f");
  });

  it("converts multi-byte arrays correctly", () => {
    expect(hexFromBytes(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBe("deadbeef");
    expect(hexFromBytes(new Uint8Array([0xca, 0xfe, 0xba, 0xbe]))).toBe("cafebabe");
  });

  it("handles all 256 byte values", () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    const hex = hexFromBytes(bytes);
    expect(hex).toHaveLength(512); // 256 bytes × 2 chars each
    expect(hex.slice(0, 4)).toBe("0001");
    expect(hex.slice(-4)).toBe("feff");
    expect(hex).toMatch(/^[0-9a-f]+$/);
  });

  it("produces lowercase hex only", () => {
    const hex = hexFromBytes(new Uint8Array([0xAB, 0xCD, 0xEF]));
    expect(hex).toBe("abcdef");
    expect(hex).not.toMatch(/[A-F]/);
  });
});

describe("computeContentFingerprint", () => {
  it("returns a 32-character hex string", () => {
    const fp = computeContentFingerprint("Hello World");
    expect(fp).toHaveLength(32);
    expect(fp).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is deterministic — same input yields same output", () => {
    const fp1 = computeContentFingerprint("test content");
    const fp2 = computeContentFingerprint("test content");
    expect(fp1).toBe(fp2);
  });

  it("normalizes to lowercase", () => {
    const fp1 = computeContentFingerprint("Hello World");
    const fp2 = computeContentFingerprint("hello world");
    expect(fp1).toBe(fp2);
  });

  it("strips punctuation", () => {
    const fp1 = computeContentFingerprint("Hello, World!");
    const fp2 = computeContentFingerprint("Hello World");
    expect(fp1).toBe(fp2);
  });

  it("collapses whitespace", () => {
    const fp1 = computeContentFingerprint("word1   word2\t\tword3\n\nword4");
    const fp2 = computeContentFingerprint("word1 word2 word3 word4");
    expect(fp1).toBe(fp2);
  });

  it("trims leading and trailing whitespace", () => {
    const fp1 = computeContentFingerprint("  hello  ");
    const fp2 = computeContentFingerprint("hello");
    expect(fp1).toBe(fp2);
  });

  it("truncates to first 500 characters of normalized text", () => {
    const base = "a".repeat(500);
    const extended = base + "ZZZZZ extra content that should be ignored";
    const fp1 = computeContentFingerprint(base);
    const fp2 = computeContentFingerprint(extended);
    expect(fp1).toBe(fp2);
  });

  it("uses full text when under 500 chars", () => {
    const short = "a".repeat(499);
    const shortPlus = short + "b";
    const fp1 = computeContentFingerprint(short);
    const fp2 = computeContentFingerprint(shortPlus);
    // 499 chars vs 500 chars — different fingerprints
    expect(fp1).not.toBe(fp2);
  });

  it("handles empty string", () => {
    const fp = computeContentFingerprint("");
    expect(fp).toHaveLength(32);
    expect(fp).toMatch(/^[0-9a-f]{32}$/);
  });

  it("handles string of only whitespace", () => {
    const fp1 = computeContentFingerprint("   \t\n  ");
    const fp2 = computeContentFingerprint("");
    // Both normalize to empty string after trim
    expect(fp1).toBe(fp2);
  });

  it("handles string of only punctuation", () => {
    const fp = computeContentFingerprint("!@#$%^&*()");
    // All punctuation is stripped, then trimmed → empty string
    const fpEmpty = computeContentFingerprint("");
    expect(fp).toBe(fpEmpty);
  });

  it("handles Unicode text (Japanese)", () => {
    const fp = computeContentFingerprint("これはテストです");
    expect(fp).toHaveLength(32);
    expect(fp).toMatch(/^[0-9a-f]{32}$/);
  });

  it("handles emoji in text", () => {
    const fp = computeContentFingerprint("Hello 🌍 World");
    expect(fp).toHaveLength(32);
  });

  it("produces different fingerprints for different content", () => {
    const fp1 = computeContentFingerprint("Article about quantum computing");
    const fp2 = computeContentFingerprint("Article about classical music");
    expect(fp1).not.toBe(fp2);
  });

  it("treats content differing only after 500 chars as identical", () => {
    const prefix = "x".repeat(500);
    const fp1 = computeContentFingerprint(prefix + " version A");
    const fp2 = computeContentFingerprint(prefix + " version B");
    expect(fp1).toBe(fp2);
  });

  it("normalizes before truncating (punctuation removal shortens text)", () => {
    // "a,".repeat(250) = 500 chars. After normalization:
    // strip punct → "aaa..." (250 chars), collapse ws → same, trim → same
    // So the effective text is only 250 chars, not 500.
    // Adding different suffix beyond 250 chars should still produce same hash
    // because the normalized text is only 250 chars (well under 500).
    const withPunct = "a,".repeat(250); // normalizes to "a" x 250
    const withPunctExtra = "a,".repeat(250) + "ZZZZZ"; // normalizes to "a" x 250 + "zzzzz"
    const fp1 = computeContentFingerprint(withPunct);
    const fp2 = computeContentFingerprint(withPunctExtra);
    // These should be DIFFERENT because normalized text is under 500 chars
    expect(fp1).not.toBe(fp2);
  });
});

describe("hashContent", () => {
  it("returns a 32-character hex string", () => {
    const hash = hashContent("Hello World");
    expect(hash).toHaveLength(32);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is deterministic", () => {
    const h1 = hashContent("test");
    const h2 = hashContent("test");
    expect(h1).toBe(h2);
  });

  it("does NOT normalize — case matters", () => {
    const h1 = hashContent("Hello");
    const h2 = hashContent("hello");
    expect(h1).not.toBe(h2);
  });

  it("does NOT strip punctuation", () => {
    const h1 = hashContent("Hello, World!");
    const h2 = hashContent("Hello World");
    expect(h1).not.toBe(h2);
  });

  it("does NOT collapse whitespace", () => {
    const h1 = hashContent("a  b");
    const h2 = hashContent("a b");
    expect(h1).not.toBe(h2);
  });

  it("does NOT truncate long strings", () => {
    const base = "a".repeat(1000);
    const extended = base + "b";
    const h1 = hashContent(base);
    const h2 = hashContent(extended);
    expect(h1).not.toBe(h2);
  });

  it("handles empty string", () => {
    const hash = hashContent("");
    expect(hash).toHaveLength(32);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("produces different hashes for different inputs", () => {
    const h1 = hashContent("input A");
    const h2 = hashContent("input B");
    expect(h1).not.toBe(h2);
  });

  it("differs from computeContentFingerprint for same raw input", () => {
    // hashContent does not normalize, so for most inputs the results differ
    const raw = "Hello, World!";
    const h = hashContent(raw);
    const fp = computeContentFingerprint(raw);
    expect(h).not.toBe(fp);
  });
});
