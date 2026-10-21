import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { safeFetch, BROTLI_REFUSED } from "@/lib/utils/safeFetch.server";

// Proves the refusal is wired into safeFetch's own dispatcher. The SSRF guard
// would refuse the loopback test server, so only the guard is stubbed here;
// real undici and the production dispatcher stay in place.
jest.mock("undici", () => jest.requireActual(`${process.cwd()}/node_modules/undici`));
jest.mock("@/lib/utils/url", () => ({ ...jest.requireActual("@/lib/utils/url"), blockPrivateUrl: () => null }));
jest.mock("@/lib/utils/ssrf", () => ({ ...jest.requireActual("@/lib/utils/ssrf"), checkPrivateAddress: () => null }));

const zlib = jest.requireActual<typeof import("node:zlib")>("node:zlib");
let server: Server;
let base: string;
let acceptEncoding: string | undefined;

beforeAll(async () => {
  server = createServer((req, res) => {
    acceptEncoding = req.headers["accept-encoding"];
    if (req.url === "/br") {
      res.writeHead(200, { "content-encoding": "br" });
      return res.end(zlib.brotliCompressSync("hello"));
    }
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end("hello");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

describe("safeFetch Brotli refusal (production dispatcher)", () => {
  it("refuses a Brotli-encoded response with a recognisable error", async () => {
    await expect(safeFetch(`${base}/br`)).rejects.toThrow(BROTLI_REFUSED);
  });

  it("fetches identity responses and asks the server for gzip/deflate only", async () => {
    const res = await safeFetch(`${base}/plain`);
    await expect(res.text()).resolves.toBe("hello");
    expect(acceptEncoding).toBe("gzip, deflate");
  });
});
