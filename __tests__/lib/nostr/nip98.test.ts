import { createNIP98AuthHeader } from "@/lib/nostr/nip98";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

describe("createNIP98AuthHeader", () => {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);

  it("returns a string starting with 'Nostr '", () => {
    const header = createNIP98AuthHeader(sk, "https://nostr.build/api/v2/upload/files", "POST");
    expect(header).toMatch(/^Nostr /);
  });

  it("produces a valid base64-encoded JSON event", () => {
    const header = createNIP98AuthHeader(sk, "https://nostr.build/api/v2/upload/files", "POST");
    const b64 = header.slice("Nostr ".length);
    const event = JSON.parse(atob(b64));
    expect(event.kind).toBe(27235);
    expect(event.pubkey).toBe(pk);
    expect(event.content).toBe("");
    expect(event.sig).toBeDefined();
  });

  it("includes correct u and method tags", () => {
    const url = "https://nostr.build/api/v2/upload/files";
    const header = createNIP98AuthHeader(sk, url, "POST");
    const event = JSON.parse(atob(header.slice("Nostr ".length)));
    const tags = new Map(event.tags.map((t: string[]) => [t[0], t[1]]));
    expect(tags.get("u")).toBe(url);
    expect(tags.get("method")).toBe("POST");
  });

  it("uppercases the method", () => {
    const header = createNIP98AuthHeader(sk, "https://example.com", "get");
    const event = JSON.parse(atob(header.slice("Nostr ".length)));
    const methodTag = event.tags.find((t: string[]) => t[0] === "method");
    expect(methodTag[1]).toBe("GET");
  });

  it("sets created_at within the last 10 seconds", () => {
    const now = Math.floor(Date.now() / 1000);
    const header = createNIP98AuthHeader(sk, "https://example.com", "POST");
    const event = JSON.parse(atob(header.slice("Nostr ".length)));
    expect(event.created_at).toBeGreaterThanOrEqual(now - 10);
    expect(event.created_at).toBeLessThanOrEqual(now + 1);
  });
});
