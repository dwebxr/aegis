/**
 * DNS-rebinding mitigation tests for safeFetch.
 *
 * The hostname-based block (blockPrivateUrl) is not enough on its own: an
 * attacker can register a public hostname whose A/AAAA records point at
 * 127.0.0.1 / 169.254.169.254 / 10.x.x.x and still smuggle the request through
 * the URL-shape check. These tests stub `node:dns/promises` and `node:net` to
 * drive the resolver and IP-literal detection deterministically.
 */
import { safeFetch } from "@/lib/utils/safeFetch.server";

const mockLookup = jest.fn();
const mockIsIP = jest.fn();

jest.mock("node:dns/promises", () => ({
  __esModule: true,
  lookup: (...args: unknown[]) => mockLookup(...args),
}));

jest.mock("node:net", () => ({
  __esModule: true,
  isIP: (...args: unknown[]) => mockIsIP(...args),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

function mockResponse(status: number, headers: Record<string, string> = {}): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers),
    body: null,
  } as unknown as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
  mockLookup.mockReset();
  mockIsIP.mockReset();
  // Default: bare hostnames (non-IP) flow through to DNS lookup.
  mockIsIP.mockReturnValue(0);
});

describe("safeFetch — DNS rebinding mitigation", () => {
  it("blocks hostname resolving to IPv4 loopback (127.x)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    await expect(safeFetch("https://evil.example.com/probe"))
      .rejects.toThrow(/private network address/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("blocks hostname resolving to AWS metadata IP (169.254.169.254)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    await expect(safeFetch("https://meta.attacker.dev/"))
      .rejects.toThrow(/private network address/i);
  });

  it("blocks hostname resolving to RFC1918 (10.0.0.5)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }]);
    await expect(safeFetch("https://rebind.test/")).rejects.toThrow(/private/i);
  });

  it("blocks hostname resolving to CGNAT (100.64.0.1)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "100.64.0.1", family: 4 }]);
    await expect(safeFetch("https://cgnat-rebind.test/")).rejects.toThrow(/private/i);
  });

  it("blocks hostname resolving to IPv6 loopback (::1)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "::1", family: 6 }]);
    await expect(safeFetch("https://v6-loopback.test/")).rejects.toThrow(/private/i);
  });

  it("blocks hostname resolving to IPv6 ULA (fc00::/7)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "fc00::1234", family: 6 }]);
    await expect(safeFetch("https://v6-ula.test/")).rejects.toThrow(/private/i);
  });

  it("blocks hostname resolving to IPv6 ULA (fd-prefix)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "fdab:cdef::1", family: 6 }]);
    await expect(safeFetch("https://v6-ula2.test/")).rejects.toThrow(/private/i);
  });

  it("blocks hostname resolving to IPv6 link-local (fe80::/10)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "fe80::a00:27ff:fe4e:66a1", family: 6 }]);
    await expect(safeFetch("https://v6-ll.test/")).rejects.toThrow(/private/i);
  });

  it("blocks hostname resolving to IPv4-mapped-IPv6 loopback (::ffff:127.0.0.1)", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "::ffff:127.0.0.1", family: 6 }]);
    await expect(safeFetch("https://v6-mapped.test/")).rejects.toThrow(/private/i);
  });

  it("blocks when ANY resolved address is private (multi-record case)", async () => {
    mockLookup.mockResolvedValueOnce([
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]);
    await expect(safeFetch("https://mixed.test/")).rejects.toThrow(/private/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("allows hostnames that resolve only to public IPs", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "23.215.0.137", family: 4 }]);
    mockFetch.mockResolvedValueOnce(mockResponse(200));
    const res = await safeFetch("https://good.example.com/");
    expect(res.status).toBe(200);
    expect(mockLookup).toHaveBeenCalledWith("good.example.com", { all: true, verbatim: true });
  });

  it("allows hostnames resolving only to public IPv6", async () => {
    mockLookup.mockResolvedValueOnce([{ address: "2606:4700:4700::1111", family: 6 }]);
    mockFetch.mockResolvedValueOnce(mockResponse(200));
    const res = await safeFetch("https://v6-public.test/");
    expect(res.status).toBe(200);
  });

  it("re-resolves DNS on every redirect hop", async () => {
    mockLookup
      .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])      // initial
      .mockResolvedValueOnce([{ address: "1.1.1.1", family: 4 }]);     // after redirect
    mockFetch
      .mockResolvedValueOnce(mockResponse(301, { location: "https://hop2.test/" }))
      .mockResolvedValueOnce(mockResponse(200));

    const res = await safeFetch("https://hop1.test/");
    expect(res.status).toBe(200);
    expect(mockLookup).toHaveBeenCalledTimes(2);
    expect(mockLookup.mock.calls[0][0]).toBe("hop1.test");
    expect(mockLookup.mock.calls[1][0]).toBe("hop2.test");
  });

  it("blocks redirect when post-redirect DNS resolves to a private IP", async () => {
    mockLookup
      .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
      .mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    mockFetch.mockResolvedValueOnce(mockResponse(302, { location: "https://later.attacker.dev/" }));

    await expect(safeFetch("https://safe-now.test/")).rejects.toThrow(/private/i);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("treats DNS NXDOMAIN/lookup error as soft-pass and defers to fetch", async () => {
    mockLookup.mockRejectedValueOnce(new Error("ENOTFOUND"));
    mockFetch.mockResolvedValueOnce(mockResponse(503));
    const res = await safeFetch("https://nonexistent.example.invalid/");
    expect(res.status).toBe(503);
  });
});

describe("safeFetch — IP literal handling (no DNS)", () => {
  it("validates IPv4 literal without invoking the resolver", async () => {
    mockIsIP.mockReturnValueOnce(4);
    await expect(safeFetch("http://127.0.0.1/admin")).rejects.toThrow(/Localhost|private/i);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("validates IPv6 literal without invoking the resolver", async () => {
    mockIsIP.mockReturnValueOnce(6);
    // URL.hostname strips brackets in modern Node; resolveAndCheckHost re-strips
    // defensively. Either form must reject.
    await expect(safeFetch("http://[fc00::1]/")).rejects.toThrow(/private/i);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("strips IPv6 brackets that survive URL parsing", async () => {
    // Force the bracketed form to flow through resolveAndCheckHost.
    // In Node 20+, URL.hostname on https://[::1]/ may return "[::1]" — the
    // bracket-stripping regex must normalise before isIP is consulted.
    mockIsIP.mockImplementationOnce((s: string) => s === "::1" ? 6 : 0);
    await expect(safeFetch("http://[::1]/")).rejects.toThrow(/Localhost|private/i);
  });

  it("allows public IPv4 literal (passes both hostname filter and isIP check)", async () => {
    mockIsIP.mockReturnValueOnce(4);
    mockFetch.mockResolvedValueOnce(mockResponse(200));
    const res = await safeFetch("https://8.8.8.8/");
    expect(res.status).toBe(200);
    expect(mockLookup).not.toHaveBeenCalled();
  });
});

describe("safeFetch — boundary IPv4 ranges via DNS", () => {
  it.each([
    ["10.0.0.0", true],
    ["10.255.255.255", true],
    ["11.0.0.0", false],
    ["172.15.255.255", false],
    ["172.16.0.0", true],
    ["172.31.255.255", true],
    ["172.32.0.0", false],
    ["192.168.0.0", true],
    ["192.169.0.0", false],
    ["169.253.255.255", false],
    ["169.254.0.0", true],
    ["169.255.0.0", false],
    ["100.63.255.255", false],
    ["100.64.0.0", true],
    ["100.127.255.255", true],
    ["100.128.0.0", false],
    ["127.0.0.0", true],
    ["127.255.255.255", true],
    ["128.0.0.0", false],
    ["0.0.0.0", true],
    ["0.255.255.255", true],
    ["1.0.0.0", false],
  ] as const)("DNS-resolved %s → blocked=%s", async (addr, blocked) => {
    mockLookup.mockResolvedValueOnce([{ address: addr, family: 4 }]);
    if (blocked) {
      mockFetch.mockReset(); // ensure not called
      await expect(safeFetch("https://boundary.test/")).rejects.toThrow(/private/i);
      expect(mockFetch).not.toHaveBeenCalled();
    } else {
      mockFetch.mockResolvedValueOnce(mockResponse(200));
      const res = await safeFetch("https://boundary.test/");
      expect(res.status).toBe(200);
    }
  });
});
