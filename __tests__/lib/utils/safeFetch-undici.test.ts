import { lookup as preCheckLookup } from "node:dns/promises";
import { lookup as connectLookup } from "node:dns";
import { safeFetch } from "@/lib/utils/safeFetch.server";

// Bypass moduleNameMapper, exercising the production dispatcher and real undici.
jest.mock("undici", () => jest.requireActual(`${process.cwd()}/node_modules/undici`));
jest.mock("node:dns", () => ({
  ...jest.requireActual("node:dns"),
  lookup: jest.fn(),
}));

type Address = { address: string; family: number };

describe("safeFetch — real undici connect-time DNS pinning", () => {
  const net = jest.requireActual<typeof import("node:net")>("node:net");
  const realConnect = net.connect;
  let handedToSocket: unknown[];

  beforeEach(() => {
    handedToSocket = [];
    (preCheckLookup as jest.Mock).mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    // Observe the last DNS-to-socket handoff. Never allow a successful lookup
    // through to the OS, even if the SSRF guard regresses: these tests do no I/O.
    jest.spyOn(net, "connect").mockImplementation(((options: import("node:net").NetConnectOpts) => {
      const opts = options as import("node:net").TcpNetConnectOpts;
      const guardedLookup = opts.lookup!;
      return realConnect({
        ...opts,
        lookup(hostname, lookupOptions, callback) {
          guardedLookup(hostname, lookupOptions, (error, address, family) => {
            if (!error) handedToSocket.push(address);
            callback(error ?? new Error("Test blocked unexpected socket address"), address, family);
          });
        },
      });
    }) as typeof net.connect);
  });

  afterEach(() => jest.restoreAllMocks());

  it("hands the verified connect-time public address to the socket", async () => {
    const publicAddress = { address: "1.1.1.1", family: 4 };
    jest.mocked(connectLookup).mockImplementation(((_host: string, _opts: unknown,
      callback: (error: Error | null, addresses: Address[]) => void) => {
      callback(null, [publicAddress]);
    }) as typeof connectLookup);

    await expect(safeFetch("http://public.example.test/")).rejects.toMatchObject({
      cause: { message: "Test blocked unexpected socket address" },
    });
    expect(preCheckLookup).toHaveBeenCalledWith("public.example.test", { all: true, verbatim: true });
    expect(connectLookup).toHaveBeenCalledWith("public.example.test", { all: true, verbatim: true }, expect.any(Function));
    expect(net.connect).toHaveBeenCalled();
    expect(handedToSocket).toEqual([[publicAddress]]);
  });

  it.each([
    ["public pre-check followed by private rebinding", [{ address: "10.0.0.5", family: 4 }], /SSRF blocked/],
    ["mixed A/AAAA with private IPv6", [{ address: "8.8.8.8", family: 4 }, { address: "fd00::5", family: 6 }], /SSRF blocked/],
    ["mixed A/AAAA with private IPv4", [{ address: "2606:4700:4700::1111", family: 6 }, { address: "10.0.0.5", family: 4 }], /SSRF blocked/],
    ["connect-time DNS failure", new Error("ENOTFOUND"), /ENOTFOUND/],
  ] as const)("refuses %s before an address reaches the socket", async (_label, result, expected) => {
    jest.mocked(connectLookup).mockImplementation(((_host: string, _opts: unknown,
      callback: (error: Error | null, addresses: readonly Address[]) => void) => {
      callback(result instanceof Error ? result : null, result instanceof Error ? [] : result);
    }) as typeof connectLookup);

    await expect(safeFetch("http://rebind.attacker.test/")).rejects.toMatchObject({
      cause: { message: expect.stringMatching(expected) },
    });
    expect(preCheckLookup).toHaveBeenCalledWith("rebind.attacker.test", { all: true, verbatim: true });
    expect(connectLookup).toHaveBeenCalledWith("rebind.attacker.test", { all: true, verbatim: true }, expect.any(Function));
    expect(net.connect).toHaveBeenCalled();
    expect(handedToSocket).toEqual([]);
  });
});
