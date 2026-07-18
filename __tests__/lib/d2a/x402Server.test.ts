jest.mock("@/lib/d2a/cdpFacilitator", () => ({
  createCdpFacilitatorConfig: jest.fn(() => ({ url: "https://cdp.test/x402" })),
}));

describe("x402Server exports", () => {
  const origEnv = process.env;

  afterEach(() => {
    process.env = origEnv;
    jest.resetModules();
  });

  it("exports X402_NETWORK with default value", () => {
    jest.isolateModules(() => {
      const { X402_NETWORK } = require("@/lib/d2a/x402Server");
      expect(X402_NETWORK).toBe("eip155:84532");
    });
  });

  it("exports X402_PRICE with default value", () => {
    jest.isolateModules(() => {
      const { X402_PRICE } = require("@/lib/d2a/x402Server");
      expect(X402_PRICE).toBe("$0.01");
    });
  });

  it("exports empty X402_RECEIVER when env not set", () => {
    jest.isolateModules(() => {
      const { X402_RECEIVER } = require("@/lib/d2a/x402Server");
      expect(X402_RECEIVER).toBe("");
    });
  });

  it("trims whitespace from X402_NETWORK", () => {
    process.env = {
      ...origEnv,
      X402_NETWORK: "  eip155:8453  ",
      CDP_API_KEY_ID: "key-id",
      CDP_API_KEY_SECRET: "key-secret",
    };
    jest.isolateModules(() => {
      const { X402_NETWORK } = require("@/lib/d2a/x402Server");
      expect(X402_NETWORK).toBe("eip155:8453");
    });
  });

  it("trims whitespace from X402_PRICE", () => {
    process.env = { ...origEnv, X402_PRICE: " $0.05\n" };
    jest.isolateModules(() => {
      const { X402_PRICE } = require("@/lib/d2a/x402Server");
      expect(X402_PRICE).toBe("$0.05");
    });
  });

  it("trims whitespace from X402_RECEIVER_ADDRESS", () => {
    process.env = { ...origEnv, X402_RECEIVER_ADDRESS: " 0xabc123\n" };
    jest.isolateModules(() => {
      const { X402_RECEIVER } = require("@/lib/d2a/x402Server");
      expect(X402_RECEIVER).toBe("0xabc123");
    });
  });

  it("reads custom X402_NETWORK from env", () => {
    process.env = { ...origEnv, X402_NETWORK: "eip155:1" };
    jest.isolateModules(() => {
      const { X402_NETWORK } = require("@/lib/d2a/x402Server");
      expect(X402_NETWORK).toBe("eip155:1");
    });
  });

  it("reads custom X402_PRICE from env", () => {
    process.env = { ...origEnv, X402_PRICE: "$1.00" };
    jest.isolateModules(() => {
      const { X402_PRICE } = require("@/lib/d2a/x402Server");
      expect(X402_PRICE).toBe("$1.00");
    });
  });

  it("exports resourceServer object", () => {
    jest.isolateModules(() => {
      const { resourceServer } = require("@/lib/d2a/x402Server");
      expect(resourceServer).toBeDefined();
      expect(typeof resourceServer).toBe("object");
    });
  });

  it("X402_NETWORK has CAIP-2 format (contains colon)", () => {
    jest.isolateModules(() => {
      const { X402_NETWORK } = require("@/lib/d2a/x402Server");
      expect(X402_NETWORK).toMatch(/^[a-z0-9]+:\d+$/);
    });
  });
});

describe("x402Server CDP fail-fast configuration", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it("throws during dynamic import when only CDP_API_KEY_ID exists", async () => {
    process.env = { ...originalEnv, CDP_API_KEY_ID: "key-id" };
    delete process.env.CDP_API_KEY_SECRET;
    jest.resetModules();

    await expect(import("@/lib/d2a/x402Server"))
      .rejects.toThrow("must be configured together");
  });

  it("throws during dynamic import when only CDP_API_KEY_SECRET exists", async () => {
    process.env = { ...originalEnv, CDP_API_KEY_SECRET: "key-secret" };
    delete process.env.CDP_API_KEY_ID;
    jest.resetModules();

    await expect(import("@/lib/d2a/x402Server"))
      .rejects.toThrow("must be configured together");
  });

  it("throws during dynamic import for Base mainnet without CDP keys", async () => {
    process.env = { ...originalEnv, X402_NETWORK: "eip155:8453" };
    delete process.env.CDP_API_KEY_ID;
    delete process.env.CDP_API_KEY_SECRET;
    jest.resetModules();

    await expect(import("@/lib/d2a/x402Server"))
      .rejects.toThrow("Base mainnet requires");
  });

  it("uses CDP credentials and ignores X402_FACILITATOR_URL", async () => {
    const createCdpFacilitatorConfig = jest.fn(() => ({ url: "https://cdp.test/x402" }));
    jest.doMock("@/lib/d2a/cdpFacilitator", () => ({ createCdpFacilitatorConfig }));
    process.env = {
      ...originalEnv,
      CDP_API_KEY_ID: " key-id ",
      CDP_API_KEY_SECRET: " key-secret ",
      X402_FACILITATOR_URL: "https://must-be-ignored.example",
    };
    jest.resetModules();

    await import("@/lib/d2a/x402Server");

    expect(createCdpFacilitatorConfig).toHaveBeenCalledWith("key-id", "key-secret");
  });
});
