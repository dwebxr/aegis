import { buildAegisTags, publishAndPartition } from "@/lib/nostr/publish";
import { finalizeEvent } from "nostr-tools/pure";
import { deriveNostrKeypairFromText } from "@/lib/nostr/identity";

describe("buildAegisTags — imageUrl (NIP-92 imeta)", () => {
  it("adds imeta tag when imageUrl is provided", () => {
    const tags = buildAegisTags(7.0, undefined, [], "https://nostr.build/i/abc.jpg");
    const imeta = tags.find(t => t[0] === "imeta");
    expect(imeta).toBeDefined();
    expect(imeta![1]).toBe("url https://nostr.build/i/abc.jpg");
  });

  it("omits imeta tag when imageUrl is undefined", () => {
    const tags = buildAegisTags(7.0, undefined, []);
    expect(tags.find(t => t[0] === "imeta")).toBeUndefined();
  });

  it("omits imeta tag when imageUrl is empty string", () => {
    const tags = buildAegisTags(7.0, undefined, [], "");
    expect(tags.find(t => t[0] === "imeta")).toBeUndefined();
  });

  it("total tag count with all options", () => {
    // 3 base + 1 vSignal + 2 topics + 1 imeta = 7
    const tags = buildAegisTags(8.0, 9, ["ai", "ml"], "https://img.com/test.png");
    expect(tags).toHaveLength(7);
  });

  it("preserves full URL in imeta tag", () => {
    const url = "https://nostr.build/i/very-long-path/image-with-special-chars_123.webp";
    const tags = buildAegisTags(5.0, undefined, [], url);
    const imeta = tags.find(t => t[0] === "imeta")!;
    expect(imeta[1]).toBe(`url ${url}`);
  });
});

describe("buildAegisTags — boundary conditions", () => {
  it("handles composite score of 0", () => {
    const tags = buildAegisTags(0, undefined, []);
    expect(tags).toContainEqual(["aegis-score", "0.0"]);
  });

  it("handles composite score of 10", () => {
    const tags = buildAegisTags(10, undefined, []);
    expect(tags).toContainEqual(["aegis-score", "10.0"]);
  });

  it("handles composite with many decimal places", () => {
    const tags = buildAegisTags(7.123456789, undefined, []);
    expect(tags).toContainEqual(["aegis-score", "7.1"]);
  });

  it("handles negative vSignal (should still be included)", () => {
    const tags = buildAegisTags(5.0, -1, []);
    expect(tags).toContainEqual(["aegis-vsignal", "-1"]);
  });

  it("handles empty string topic", () => {
    const tags = buildAegisTags(5.0, undefined, [""]);
    expect(tags).toContainEqual(["t", ""]);
  });
});

describe("publishAndPartition — relay distribution", () => {
  const keys = deriveNostrKeypairFromText("test-publish-partition");

  it("returns published and failed lists", async () => {
    const signed = finalizeEvent(
      { kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: "test" },
      keys.sk,
    );

    // Without real relays, all should fail
    const result = await publishAndPartition(signed, ["wss://fake-relay.example.com"]);
    // We can't guarantee the result since it depends on network, but structure should be correct
    expect(result).toHaveProperty("published");
    expect(result).toHaveProperty("failed");
    expect(Array.isArray(result.published)).toBe(true);
    expect(Array.isArray(result.failed)).toBe(true);
    // Total should equal input relay count
    expect(result.published.length + result.failed.length).toBe(1);
  });

  it("handles empty relay list", async () => {
    const signed = finalizeEvent(
      { kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: "test" },
      keys.sk,
    );

    const result = await publishAndPartition(signed, []);
    expect(result.published).toEqual([]);
    expect(result.failed).toEqual([]);
  });
});
