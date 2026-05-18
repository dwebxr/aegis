/**
 * Verifies PUSH_SERVER_PRIVATE_KEY parsing — the env var is the foundation of
 * the canister-authz check in /api/push/token, so a misconfigured key must
 * fail loudly (and the error must point operators at the runbook).
 */
import { Ed25519KeyIdentity } from "@dfinity/identity";
import { getServerIdentity } from "@/lib/ic/serverIdentity";

const ORIG = process.env.PUSH_SERVER_PRIVATE_KEY;

afterEach(() => {
  if (ORIG === undefined) delete process.env.PUSH_SERVER_PRIVATE_KEY;
  else process.env.PUSH_SERVER_PRIVATE_KEY = ORIG;
});

describe("getServerIdentity", () => {
  it("accepts a 32-byte base64 seed and returns a deterministic principal", () => {
    const seed = Buffer.from(new Uint8Array(32).fill(7)).toString("base64");
    process.env.PUSH_SERVER_PRIVATE_KEY = seed;

    const id1 = getServerIdentity();
    const id2 = getServerIdentity();
    expect(id1.getPrincipal().toText()).toBe(id2.getPrincipal().toText());
  });

  it("accepts a 32-byte secret from a generated identity (round-trip)", () => {
    const ed = Ed25519KeyIdentity.generate();
    const { secretKey } = ed.getKeyPair() as unknown as { secretKey: Uint8Array };
    expect(secretKey.length).toBe(32);
    process.env.PUSH_SERVER_PRIVATE_KEY = Buffer.from(secretKey).toString("base64");

    const id = getServerIdentity();
    expect(id.getPrincipal().toText()).toBe(ed.getPrincipal().toText());
  });

  it("throws with an actionable error when env var is missing", () => {
    delete process.env.PUSH_SERVER_PRIVATE_KEY;
    expect(() => getServerIdentity()).toThrow(/PUSH_SERVER_PRIVATE_KEY/);
    expect(() => getServerIdentity()).toThrow(/setup instructions/i);
  });

  it("throws on whitespace-only env var (treated as missing after trim)", () => {
    process.env.PUSH_SERVER_PRIVATE_KEY = "    ";
    expect(() => getServerIdentity()).toThrow(/PUSH_SERVER_PRIVATE_KEY/);
  });

  it("rejects a key that decodes to an unexpected length", () => {
    process.env.PUSH_SERVER_PRIVATE_KEY = Buffer.from(new Uint8Array(17)).toString("base64");
    expect(() => getServerIdentity()).toThrow(/32 or 64 bytes/);
  });
});
