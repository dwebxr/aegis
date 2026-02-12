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
    process.env = { ...origEnv, X402_NETWORK: "  eip155:8453  " };
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
