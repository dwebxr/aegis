import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { rejectBrotli, BROTLI_REFUSED } from "@/lib/utils/safeFetch.server";

// Bypass moduleNameMapper so the interceptor runs inside real undici. The SSRF
// guard would refuse 127.0.0.1, so the interceptor is composed onto a plain Agent.
jest.mock("undici", () => jest.requireActual(`${process.cwd()}/node_modules/undici`));
const { Agent, fetch: undiciFetch } = jest.requireActual<typeof import("undici")>(`${process.cwd()}/node_modules/undici`);
// The real module object undici requires (an ESM namespace import is a copy).
const zlib = jest.requireActual<typeof import("node:zlib")>("node:zlib");

const realBrotli = zlib.createBrotliDecompress;
const brotliCalls = jest.fn();
let server: Server;
let base: string;
const dispatcher = new Agent().compose(rejectBrotli);

beforeAll(async () => {
  // undici reads zlib.createBrotliDecompress off the module at call time, so a
  // replaced property is observed. jest.spyOn can't: the property is read-only.
  Object.defineProperty(zlib, "createBrotliDecompress", {
    configurable: true,
    value: (...args: Parameters<typeof realBrotli>) => { brotliCalls(); return realBrotli(...args); },
  });
  server = createServer((req, res) => {
    const encoded = (coding: string, body: Buffer) => {
      res.writeHead(200, { "content-encoding": coding, "content-type": "text/plain" });
      res.end(body);
    };
    switch (req.url) {
      case "/br": return encoded("br", zlib.brotliCompressSync("hello"));
      case "/br-upper": return encoded("BR", zlib.brotliCompressSync("hello"));
      case "/gzip-br": return encoded("gzip, br", zlib.brotliCompressSync(zlib.gzipSync("hello")));
      case "/gzip": return encoded("gzip", zlib.gzipSync("hello"));
      case "/redirect-br":
        res.writeHead(302, { location: "/plain", "content-encoding": "br" });
        return res.end(zlib.brotliCompressSync("moved"));
      case "/not-modified-br":
        res.writeHead(304, { "content-encoding": "br", etag: '"v1"' });
        return res.end();
      case "/head-br":
        res.writeHead(200, { "content-encoding": "br" });
        return res.end();
      default:
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end("hello");
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  Object.defineProperty(zlib, "createBrotliDecompress", { configurable: true, value: realBrotli });
  await dispatcher.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

beforeEach(() => brotliCalls.mockClear());

const get = (path: string, init: { method?: string; redirect?: "manual" } = {}) =>
  undiciFetch(`${base}${path}`, { dispatcher, ...init });

describe("rejectBrotli", () => {
  it.each(["/br", "/br-upper", "/gzip-br"])("refuses %s before a Brotli decoder is created", async path => {
    await expect(get(path)).rejects.toMatchObject({ cause: { message: BROTLI_REFUSED } });
    expect(brotliCalls).not.toHaveBeenCalled();
  });

  it("refuses a Brotli-encoded redirect hop (manual redirects still decode 3xx bodies)", async () => {
    await expect(get("/redirect-br", { redirect: "manual" })).rejects.toMatchObject({ cause: { message: BROTLI_REFUSED } });
    expect(brotliCalls).not.toHaveBeenCalled();
  });

  it("passes gzip and identity responses through unchanged", async () => {
    await expect((await get("/gzip")).text()).resolves.toBe("hello");
    await expect((await get("/plain")).text()).resolves.toBe("hello");
    expect(brotliCalls).not.toHaveBeenCalled();
  });

  it("lets a 304 carrying Brotli metadata through, so RSS revalidation still works", async () => {
    const res = await get("/not-modified-br");
    expect(res.status).toBe(304);
    expect(brotliCalls).not.toHaveBeenCalled();
  });

  it("lets HEAD through, since there is no body to decode", async () => {
    const res = await get("/head-br", { method: "HEAD" });
    expect(res.status).toBe(200);
  });

  it("decodes Brotli without the interceptor, so the test would catch a broken one", async () => {
    const plain = new Agent();
    try {
      const res = await undiciFetch(`${base}/br`, { dispatcher: plain });
      await expect(res.text()).resolves.toBe("hello");
      expect(brotliCalls).toHaveBeenCalled();
    } finally {
      await plain.close();
    }
  });
});
