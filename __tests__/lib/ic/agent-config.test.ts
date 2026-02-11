// Mock @dfinity/agent to avoid BLS12-381 BigInt errors in test environment
jest.mock("@dfinity/agent", () => ({
  HttpAgent: {
    createSync: jest.fn().mockReturnValue({
      fetchRootKey: jest.fn().mockResolvedValue(undefined),
    }),
  },
}));

const originalEnv = { ...process.env };

// Since the module evaluates `isLocal` at import time using `window`,
// we use jest.isolateModules for fresh imports per test.
function importAgentModule() {
  let mod: typeof import("@/lib/ic/agent");
  jest.isolateModules(() => {
    mod = require("@/lib/ic/agent");
  });
  return mod!;
}

afterEach(() => {
  process.env = { ...originalEnv };
  if (typeof globalThis.window !== "undefined") {
    // @ts-expect-error -- test cleanup
    delete globalThis.window;
  }
});

describe("getHost", () => {
  it("returns NEXT_PUBLIC_IC_HOST when set", () => {
    process.env.NEXT_PUBLIC_IC_HOST = "https://custom-host.example.com";
    const { getHost } = importAgentModule();
    expect(getHost()).toBe("https://custom-host.example.com");
  });

  it("trims whitespace and newlines from env var", () => {
    process.env.NEXT_PUBLIC_IC_HOST = "  https://custom.com  \n";
    const { getHost } = importAgentModule();
    expect(getHost()).toBe("https://custom.com");
  });

  it("returns production IC host when no env var and not local", () => {
    delete process.env.NEXT_PUBLIC_IC_HOST;
    const { getHost } = importAgentModule();
    expect(getHost()).toBe("https://icp-api.io");
  });

  it("returns localhost when window.location.hostname is localhost", () => {
    delete process.env.NEXT_PUBLIC_IC_HOST;
    // @ts-expect-error -- mock window for test
    globalThis.window = { location: { hostname: "localhost" } };
    const { getHost } = importAgentModule();
    expect(getHost()).toBe("http://127.0.0.1:4943");
  });

  it("returns localhost when window.location.hostname is 127.0.0.1", () => {
    delete process.env.NEXT_PUBLIC_IC_HOST;
    // @ts-expect-error -- mock window for test
    globalThis.window = { location: { hostname: "127.0.0.1" } };
    const { getHost } = importAgentModule();
    expect(getHost()).toBe("http://127.0.0.1:4943");
  });

  it("returns production host for non-local hostname", () => {
    delete process.env.NEXT_PUBLIC_IC_HOST;
    // @ts-expect-error -- mock window for test
    globalThis.window = { location: { hostname: "aegis.dwebxr.xyz" } };
    const { getHost } = importAgentModule();
    expect(getHost()).toBe("https://icp-api.io");
  });
});

describe("getInternetIdentityUrl", () => {
  it("returns env var when set", () => {
    process.env.NEXT_PUBLIC_INTERNET_IDENTITY_URL = "https://custom-ii.example.com";
    const { getInternetIdentityUrl } = importAgentModule();
    expect(getInternetIdentityUrl()).toBe("https://custom-ii.example.com");
  });

  it("trims whitespace from env var", () => {
    process.env.NEXT_PUBLIC_INTERNET_IDENTITY_URL = "  https://ii.com  ";
    const { getInternetIdentityUrl } = importAgentModule();
    expect(getInternetIdentityUrl()).toBe("https://ii.com");
  });

  it("returns production II URL when not local", () => {
    delete process.env.NEXT_PUBLIC_INTERNET_IDENTITY_URL;
    const { getInternetIdentityUrl } = importAgentModule();
    expect(getInternetIdentityUrl()).toBe("https://identity.ic0.app");
  });

  it("returns local II URL when on localhost", () => {
    delete process.env.NEXT_PUBLIC_INTERNET_IDENTITY_URL;
    // @ts-expect-error -- mock window
    globalThis.window = { location: { hostname: "localhost" } };
    const { getInternetIdentityUrl } = importAgentModule();
    expect(getInternetIdentityUrl()).toContain("127.0.0.1:4943");
    expect(getInternetIdentityUrl()).toContain("rdmx6-jaaaa-aaaaa-aaadq-cai");
  });
});

describe("getCanisterId", () => {
  it("returns env var when set", () => {
    process.env.NEXT_PUBLIC_CANISTER_ID = "abc-123-canister";
    const { getCanisterId } = importAgentModule();
    expect(getCanisterId()).toBe("abc-123-canister");
  });

  it("trims whitespace from env var", () => {
    process.env.NEXT_PUBLIC_CANISTER_ID = "  abc-123  \n";
    const { getCanisterId } = importAgentModule();
    expect(getCanisterId()).toBe("abc-123");
  });

  it("returns default canister ID when env var not set", () => {
    delete process.env.NEXT_PUBLIC_CANISTER_ID;
    const { getCanisterId } = importAgentModule();
    expect(getCanisterId()).toBe("rluf3-eiaaa-aaaam-qgjuq-cai");
  });
});

describe("getDerivationOrigin", () => {
  it("returns undefined when on localhost", () => {
    // @ts-expect-error -- mock window
    globalThis.window = { location: { hostname: "localhost" } };
    const { getDerivationOrigin } = importAgentModule();
    expect(getDerivationOrigin()).toBeUndefined();
  });

  it("returns canister URL when not local", () => {
    delete process.env.NEXT_PUBLIC_CANISTER_ID;
    const { getDerivationOrigin } = importAgentModule();
    expect(getDerivationOrigin()).toBe("https://rluf3-eiaaa-aaaam-qgjuq-cai.icp0.io");
  });

  it("uses custom canister ID in derivation origin", () => {
    process.env.NEXT_PUBLIC_CANISTER_ID = "custom-canister-id";
    const { getDerivationOrigin } = importAgentModule();
    expect(getDerivationOrigin()).toBe("https://custom-canister-id.icp0.io");
  });
});

describe("createAgent", () => {
  it("creates an agent with specified host", () => {
    const { HttpAgent } = require("@dfinity/agent");
    process.env.NEXT_PUBLIC_IC_HOST = "https://test-host.com";
    const { createAgent } = importAgentModule();
    createAgent();
    expect(HttpAgent.createSync).toHaveBeenCalledWith(
      expect.objectContaining({ host: "https://test-host.com" }),
    );
  });

  it("calls fetchRootKey when local", () => {
    // @ts-expect-error -- mock window
    globalThis.window = { location: { hostname: "localhost" } };
    const mockFetchRootKey = jest.fn().mockResolvedValue(undefined);
    const { HttpAgent } = require("@dfinity/agent");
    HttpAgent.createSync.mockReturnValue({ fetchRootKey: mockFetchRootKey });

    const { createAgent } = importAgentModule();
    createAgent();

    expect(mockFetchRootKey).toHaveBeenCalled();
  });

  it("does not call fetchRootKey when not local", () => {
    delete process.env.NEXT_PUBLIC_IC_HOST;
    const mockFetchRootKey = jest.fn().mockResolvedValue(undefined);
    const { HttpAgent } = require("@dfinity/agent");
    HttpAgent.createSync.mockReturnValue({ fetchRootKey: mockFetchRootKey });

    const { createAgent } = importAgentModule();
    createAgent();

    expect(mockFetchRootKey).not.toHaveBeenCalled();
  });
});
