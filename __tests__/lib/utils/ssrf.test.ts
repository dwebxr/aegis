import { checkPrivateAddress, makePrivateIPRejectingLookup } from "@/lib/utils/ssrf";
import { assertRelayUrlAllowed } from "@/lib/nostr/serverPool";

describe("checkPrivateAddress", () => {
  it("flags the whole 127.0.0.0/8 loopback range, not just 127.0.0.1", () => {
    expect(checkPrivateAddress("127.0.0.1", 4)).not.toBeNull();
    expect(checkPrivateAddress("127.0.0.2", 4)).not.toBeNull();
    expect(checkPrivateAddress("127.255.255.255", 4)).not.toBeNull();
  });

  it("flags RFC1918 / CGNAT / link-local / unspecified IPv4", () => {
    for (const ip of ["10.0.0.1", "172.16.0.1", "172.31.255.1", "192.168.1.1", "169.254.1.1", "100.64.0.1", "0.0.0.0"]) {
      expect(checkPrivateAddress(ip, 4)).not.toBeNull();
    }
  });

  it("allows public IPv4", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "93.184.216.34"]) {
      expect(checkPrivateAddress(ip, 4)).toBeNull();
    }
  });

  it("flags IPv6 loopback / ULA / link-local", () => {
    expect(checkPrivateAddress("::1", 6)).not.toBeNull();
    expect(checkPrivateAddress("fc00::1", 6)).not.toBeNull();
    expect(checkPrivateAddress("fd12:3456::1", 6)).not.toBeNull();
    expect(checkPrivateAddress("fe80::1", 6)).not.toBeNull();
  });

  it("flags IPv4-mapped IPv6 in BOTH dotted and hex-compressed form", () => {
    // ::ffff:127.0.0.1 and its normalized hex form ::ffff:7f00:1 are both loopback.
    expect(checkPrivateAddress("::ffff:127.0.0.1", 6)).not.toBeNull();
    expect(checkPrivateAddress("::ffff:7f00:1", 6)).not.toBeNull();
    // ::ffff:10.0.0.1 → ::ffff:a00:1
    expect(checkPrivateAddress("::ffff:a00:1", 6)).not.toBeNull();
  });

  it("allows public IPv6 and public IPv4-mapped", () => {
    expect(checkPrivateAddress("2606:4700:4700::1111", 6)).toBeNull();
    expect(checkPrivateAddress("::ffff:8.8.8.8", 6)).toBeNull();
    expect(checkPrivateAddress("::ffff:808:808", 6)).toBeNull();
  });

  it("flags special-use / non-global-unicast ranges (RFC 6890)", () => {
    for (const ip of ["198.18.0.1", "198.19.255.255", "192.0.0.1", "192.0.2.5", "198.51.100.5", "203.0.113.5", "192.88.99.1", "240.0.0.1", "255.255.255.255"]) {
      expect(checkPrivateAddress(ip, 4)).not.toBeNull();
    }
    expect(checkPrivateAddress("fec0::1", 6)).not.toBeNull(); // deprecated site-local
    expect(checkPrivateAddress("2001:db8::1", 6)).not.toBeNull(); // documentation
  });

  it("still allows public addresses near the special-use boundaries", () => {
    for (const ip of ["198.20.0.1", "192.1.0.1", "203.0.114.1", "239.255.255.255"]) {
      expect(checkPrivateAddress(ip, 4)).toBeNull();
    }
  });

  it("denies non-global-unicast IPv6 by allow-list (NAT64, SRv6, 6to4, Teredo, benchmarking, multicast)", () => {
    for (const ip of ["64:ff9b::1", "64:ff9b:1::a00:1", "5f00::1", "100::1", "2001::1", "2001:2::1", "2002:a00:1::1", "2001:db8::1", "fec0::1", "ff02::1", "3fff::1"]) {
      expect(checkPrivateAddress(ip, 6)).not.toBeNull();
    }
  });

  it("allows genuine global-unicast IPv6 (2000::/3 minus carve-outs)", () => {
    for (const ip of ["2606:4700:4700::1111", "2620:fe::fe", "2400:cb00::1", "2001:4860:4860::8888"]) {
      expect(checkPrivateAddress(ip, 6)).toBeNull();
    }
  });

  it("does NOT let a ULA bypass via an embedded ::ffff: group (anchored mapped check)", () => {
    // The "::ffff:" inside a ULA must NOT be read as a mapped public 8.8.8.8.
    expect(checkPrivateAddress("fc00::ffff:808:808", 6)).not.toBeNull();
    expect(checkPrivateAddress("fc00::ffff:127.0.0.1", 6)).not.toBeNull();
    // Garbled ":."-mixed tails must NOT be parsed as a mapped public IPv4 — they
    // fall through to deny-by-default (true first hextet is 0):
    expect(checkPrivateAddress("::ffff:dead:127.0.0.1", 6)).not.toBeNull();
    expect(checkPrivateAddress("::ffff:0:10.0.0.1", 6)).not.toBeNull();
    // Genuine mapped forms still resolve by the embedded IPv4:
    expect(checkPrivateAddress("::ffff:8.8.8.8", 6)).toBeNull();
    expect(checkPrivateAddress("::ffff:808:808", 6)).toBeNull(); // hex form of 8.8.8.8
    expect(checkPrivateAddress("::ffff:10.0.0.1", 6)).not.toBeNull();
    expect(checkPrivateAddress("::ffff:7f00:1", 6)).not.toBeNull(); // hex form of 127.0.0.1
    expect(checkPrivateAddress("0:0:0:0:0:ffff:7f00:1", 6)).not.toBeNull(); // expanded mapped loopback
  });

  it("blocks the whole 2001::/23 IETF special-purpose block, allows global beyond it", () => {
    // Teredo, benchmarking, ORCHID, AS112, protocol assignments, and the residual
    // 2001:5::/2001:100:: etc. all live in 2001::/23 and are non-global.
    for (const ip of ["2001::1", "2001:2::1", "2001:5::1", "2001:10::1", "2001:20::1", "2001:30::1", "2001:100::1", "2001:1ff::1"]) {
      expect(checkPrivateAddress(ip, 6)).not.toBeNull();
    }
    // 2001:200::/23 (APNIC) onward is genuine global unicast.
    expect(checkPrivateAddress("2001:200::1", 6)).toBeNull();
    expect(checkPrivateAddress("2001:4860:4860::8888", 6)).toBeNull();
  });

  it("blocks only 3fff::/20 documentation, not all of 3fff::/16", () => {
    expect(checkPrivateAddress("3fff::1", 6)).not.toBeNull(); // in /20
    expect(checkPrivateAddress("3fff:0fff::1", 6)).not.toBeNull(); // top edge of /20
    expect(checkPrivateAddress("3fff:1000::1", 6)).toBeNull(); // beyond /20 → global unicast
  });

  it("infers family when omitted and returns null for non-IP input", () => {
    expect(checkPrivateAddress("127.0.0.1")).not.toBeNull();
    expect(checkPrivateAddress("not-an-ip")).toBeNull();
  });
});

describe("makePrivateIPRejectingLookup", () => {
  type Addr = { address: string; family: number };
  const fakeDns = (addrs: Addr[] | Error) =>
    ((_h: string, _o: unknown, cb: (e: Error | null, a: Addr[]) => void) =>
      addrs instanceof Error ? cb(addrs, []) : cb(null, addrs)) as unknown as Parameters<
      typeof makePrivateIPRejectingLookup
    >[0];

  it("pins to the resolved public address (single-address form)", (done) => {
    const lookup = makePrivateIPRejectingLookup(fakeDns([{ address: "93.184.216.34", family: 4 }]));
    lookup("example.com", {}, (err, address, family) => {
      expect(err).toBeNull();
      expect(address).toBe("93.184.216.34");
      expect(family).toBe(4);
      done();
    });
  });

  it("returns an ARRAY when called with { all: true } — net autoSelectFamily contract", (done) => {
    // Node 20+ net.connect / undici / ws call lookup with { all: true } and require
    // an address array; returning the single form fails with ERR_INVALID_IP_ADDRESS.
    const lookup = makePrivateIPRejectingLookup(fakeDns([{ address: "93.184.216.34", family: 4 }]));
    lookup("example.com", { all: true }, (err, addresses) => {
      expect(err).toBeNull();
      expect(Array.isArray(addresses)).toBe(true);
      expect(addresses).toEqual([{ address: "93.184.216.34", family: 4 }]);
      done();
    });
  });

  it("returns ALL validated addresses for { all: true } — preserves Happy Eyeballs", (done) => {
    const lookup = makePrivateIPRejectingLookup(
      fakeDns([{ address: "2606:4700::1111", family: 6 }, { address: "93.184.216.34", family: 4 }]),
    );
    lookup("dual.example", { all: true }, (err, addresses) => {
      expect(err).toBeNull();
      expect(addresses).toEqual([
        { address: "2606:4700::1111", family: 6 },
        { address: "93.184.216.34", family: 4 },
      ]);
      done();
    });
  });

  it("narrows to the requested family when opts.family is set", (done) => {
    const lookup = makePrivateIPRejectingLookup(
      fakeDns([{ address: "2606:4700::1111", family: 6 }, { address: "93.184.216.34", family: 4 }]),
    );
    lookup("dual.example", { all: true, family: 4 } as Parameters<typeof lookup>[1], (err, addresses) => {
      expect(err).toBeNull();
      expect(addresses).toEqual([{ address: "93.184.216.34", family: 4 }]);
      done();
    });
  });

  it("rejects fail-closed when ANY resolved address is private (rebinding)", (done) => {
    const lookup = makePrivateIPRejectingLookup(
      fakeDns([{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }]),
    );
    lookup("rebind.evil", {}, (err) => {
      expect(err).toBeInstanceOf(Error);
      done();
    });
  });

  it("propagates DNS errors fail-closed", (done) => {
    const lookup = makePrivateIPRejectingLookup(fakeDns(new Error("ENOTFOUND")));
    lookup("nope.invalid", {}, (err) => {
      expect(err).toBeInstanceOf(Error);
      done();
    });
  });

  it("rejects when no addresses resolve", (done) => {
    const lookup = makePrivateIPRejectingLookup(fakeDns([]));
    lookup("empty.example", {}, (err) => {
      expect(err).toBeInstanceOf(Error);
      done();
    });
  });
});

describe("assertRelayUrlAllowed", () => {
  it("accepts public wss relays", () => {
    expect(() => assertRelayUrlAllowed("wss://relay.damus.io")).not.toThrow();
    expect(() => assertRelayUrlAllowed("wss://nos.lol/")).not.toThrow();
  });

  it("rejects non-wss schemes", () => {
    expect(() => assertRelayUrlAllowed("ws://relay.damus.io")).toThrow();
    expect(() => assertRelayUrlAllowed("https://relay.damus.io")).toThrow();
  });

  it("rejects literal private IPv4 relays (lookup hook is skipped for IP literals)", () => {
    expect(() => assertRelayUrlAllowed("wss://127.0.0.1")).toThrow();
    expect(() => assertRelayUrlAllowed("wss://127.0.0.2")).toThrow();
    expect(() => assertRelayUrlAllowed("wss://169.254.169.254")).toThrow();
  });

  it("rejects literal private IPv6 relays including mapped hex", () => {
    expect(() => assertRelayUrlAllowed("wss://[::1]")).toThrow();
    expect(() => assertRelayUrlAllowed("wss://[::ffff:7f00:1]")).toThrow();
  });
});

describe("makePrivateIPRejectingLookup — real undici Agent integration", () => {
  // jest.requireActual bypasses the global undici mock so we exercise the REAL
  // Agent. Real undici calls our lookup with { all: true }; this both proves the
  // dispatcher actually invokes our hook and that the array contract is honored.
  // Rejection happens at the connect-time lookup (private IP), so no socket is
  // opened and no network is required.
  it("real undici fetch rejects a host that resolves to a private IP", async () => {
    // Load real undici by absolute path so the global `^undici$` moduleNameMapper
    // (which routes to the test stub) does not intercept it.
    const { Agent, fetch: realFetch } = jest.requireActual(`${process.cwd()}/node_modules/undici`);
    const privateDns = ((_h: string, _o: unknown, cb: (e: Error | null, a: { address: string; family: number }[]) => void) =>
      cb(null, [{ address: "10.0.0.5", family: 4 }])) as Parameters<typeof makePrivateIPRejectingLookup>[0];
    const agent = new Agent({ connect: { lookup: makePrivateIPRejectingLookup(privateDns) } });
    let caught: unknown;
    try {
      await realFetch("http://internal.attacker.test/", { dispatcher: agent });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    // undici wraps the connect-time failure as TypeError("fetch failed") with the
    // real reason on .cause — assert our SSRF rejection propagated through.
    const err = caught as { message?: string; cause?: { message?: string } };
    expect(String(err.cause?.message ?? err.message ?? "")).toMatch(/SSRF blocked/);
  });
});
