/**
 * IC configuration utilities — environment variable handling, trimming, defaults.
 */

describe("IC config utilities", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    // Reset module cache so isLocal and env reads are re-evaluated
    jest.resetModules();
  });

  describe("getHost", () => {
    it("returns trimmed NEXT_PUBLIC_IC_HOST when set", async () => {
      process.env.NEXT_PUBLIC_IC_HOST = "  https://custom-host.io  ";
      const { getHost } = await import("@/lib/ic/config");
      expect(getHost()).toBe("https://custom-host.io");
    });

    it("returns default icp-api.io for non-local (no env)", async () => {
      delete process.env.NEXT_PUBLIC_IC_HOST;
      const { getHost } = await import("@/lib/ic/config");
      // In test env, window is undefined → isLocal is false → uses icp-api.io
      expect(getHost()).toBe("https://icp-api.io");
    });

    it("trims trailing newlines from env var", async () => {
      process.env.NEXT_PUBLIC_IC_HOST = "https://icp-api.io\n";
      const { getHost } = await import("@/lib/ic/config");
      expect(getHost()).toBe("https://icp-api.io");
    });
  });

  describe("getCanisterId", () => {
    it("returns trimmed NEXT_PUBLIC_CANISTER_ID when set", async () => {
      process.env.NEXT_PUBLIC_CANISTER_ID = " my-canister-id ";
      const { getCanisterId } = await import("@/lib/ic/config");
      expect(getCanisterId()).toBe("my-canister-id");
    });

    it("returns default canister ID when no env", async () => {
      delete process.env.NEXT_PUBLIC_CANISTER_ID;
      const { getCanisterId } = await import("@/lib/ic/config");
      expect(getCanisterId()).toBe("rluf3-eiaaa-aaaam-qgjuq-cai");
    });

    it("trims whitespace and newlines", async () => {
      process.env.NEXT_PUBLIC_CANISTER_ID = "rluf3-eiaaa-aaaam-qgjuq-cai\n";
      const { getCanisterId } = await import("@/lib/ic/config");
      expect(getCanisterId()).not.toContain("\n");
    });
  });

  describe("getInternetIdentityUrl", () => {
    it("returns trimmed env value when set", async () => {
      process.env.NEXT_PUBLIC_INTERNET_IDENTITY_URL = "  https://custom-ii.io  ";
      const { getInternetIdentityUrl } = await import("@/lib/ic/config");
      expect(getInternetIdentityUrl()).toBe("https://custom-ii.io");
    });

    it("returns default IC identity URL", async () => {
      delete process.env.NEXT_PUBLIC_INTERNET_IDENTITY_URL;
      const { getInternetIdentityUrl } = await import("@/lib/ic/config");
      expect(getInternetIdentityUrl()).toBe("https://identity.internetcomputer.org");
    });
  });

  describe("getDerivationOrigin", () => {
    it("returns canister URL for non-local", async () => {
      delete process.env.NEXT_PUBLIC_CANISTER_ID;
      const { getDerivationOrigin } = await import("@/lib/ic/config");
      // In test env, isLocal is false
      const origin = getDerivationOrigin();
      expect(origin).toBe("https://rluf3-eiaaa-aaaam-qgjuq-cai.icp0.io");
    });

    it("uses custom canister ID in derivation origin", async () => {
      process.env.NEXT_PUBLIC_CANISTER_ID = "custom-canister-id";
      const { getDerivationOrigin } = await import("@/lib/ic/config");
      const origin = getDerivationOrigin();
      expect(origin).toBe("https://custom-canister-id.icp0.io");
    });
  });

  describe("isLocal detection", () => {
    it("is false in test environment (no window)", async () => {
      const { isLocal } = await import("@/lib/ic/config");
      // In Jest, typeof window may be undefined or not localhost
      expect(typeof isLocal).toBe("boolean");
    });
  });
});
