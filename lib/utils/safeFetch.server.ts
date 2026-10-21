import "server-only";
import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { blockPrivateUrl } from "./url";
import { checkPrivateAddress, makePrivateIPRejectingLookup } from "./ssrf";

export const BROTLI_REFUSED = "Refusing Brotli-encoded response";

function contentEncodingHasBrotli(rawHeaders: unknown): boolean {
  if (!Array.isArray(rawHeaders)) return false;
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
    const name = String(rawHeaders[i] instanceof Buffer ? rawHeaders[i].toString("latin1") : rawHeaders[i]);
    if (name.toLowerCase() !== "content-encoding") continue;
    const value = String(rawHeaders[i + 1] instanceof Buffer ? rawHeaders[i + 1].toString("latin1") : rawHeaders[i + 1]);
    if (value.split(",").some(coding => coding.trim().toLowerCase() === "br")) return true;
  }
  return false;
}

const BODYLESS_STATUS = new Set([204, 205, 304]);

type Handlers = Dispatcher.DispatchHandlers;

// Forwards every callback to fetch's own handler, except response headers that
// declare Brotli: those abort the request instead of reaching the handler.
class RejectBrotliHandler implements Handlers {
  readonly #inner: Handlers;
  #abort: ((err?: Error) => void) | null = null;

  constructor(inner: Handlers) {
    this.#inner = inner;
  }

  onConnect(abort: (err?: Error) => void): void {
    this.#abort = abort;
    this.#inner.onConnect?.(abort);
  }

  onHeaders(statusCode: number, headers: Buffer[], resume: () => void, statusText: string): boolean {
    // Interim and bodyless responses carry nothing to decode (fetch skips the
    // decoder for them too), and refusing a 304 would break RSS revalidation.
    if (statusCode >= 200 && !BODYLESS_STATUS.has(statusCode) && contentEncodingHasBrotli(headers)) {
      this.#abort?.(new Error(BROTLI_REFUSED));
      return false;
    }
    return this.#inner.onHeaders?.(statusCode, headers, resume, statusText) ?? true;
  }

  onError(err: Error): void { this.#inner.onError?.(err); }
  onUpgrade(...args: Parameters<NonNullable<Handlers["onUpgrade"]>>): void { this.#inner.onUpgrade?.(...args); }
  onResponseStarted(): void { this.#inner.onResponseStarted?.(); }
  onData(chunk: Buffer): boolean { return this.#inner.onData?.(chunk) ?? true; }
  onComplete(trailers: string[] | null): void { this.#inner.onComplete?.(trailers); }
  onBodySent(chunkSize: number, totalBytesSent: number): void { this.#inner.onBodySent?.(chunkSize, totalBytesSent); }
}

// Node's bundled Brotli decoder has an out-of-bounds write (CVE-2026-111497,
// fixed in Node 22.23.4 / 24.22.1). undici's fetch decodes `br` by the response
// header whatever we advertise, and builds the decoder in onHeaders — before
// fetch() resolves — so a check on the returned Response would be too late.
// Refuse such responses at the dispatcher instead; the inner handler never sees
// the headers, so no decoder is created and no body byte reaches zlib. HEAD has
// no body to decode. Cheap enough to keep once the runtime is patched.
export const rejectBrotli: Dispatcher.DispatchInterceptor = dispatch => (opts, handler) =>
  opts.method === "HEAD" ? dispatch(opts, handler) : dispatch(opts, new RejectBrotliHandler(handler));

// Authoritative SSRF enforcement happens at connection time: this dispatcher's
// connect step resolves the host, rejects fail-closed if any A/AAAA is private,
// and pins the socket to the validated IP. Because undici applies the dispatcher
// to every connection — including redirect targets we follow manually below —
// there is no resolve-then-reconnect window for DNS rebinding to exploit.
const ssrfDispatcher = new Agent({ connect: { lookup: makePrivateIPRejectingLookup() } }).compose(rejectBrotli);

// Without an explicit value undici advertises `br` over https, so honest servers
// would answer with Brotli that rejectBrotli then refuses.
function withSafeAcceptEncoding(init: RequestInit | undefined): RequestInit {
  const headers = new Headers(init?.headers as HeadersInit | undefined);
  if (!headers.has("accept-encoding")) headers.set("accept-encoding", "gzip, deflate");
  return { ...init, headers };
}

// Drop credential-bearing headers before following a cross-origin redirect, so a
// caller's Authorization/Cookie can't leak to a different host (classic redirect
// credential-leak). No caller currently passes such headers — this is a guardrail.
function withoutCredentialHeaders(init: RequestInit | undefined): RequestInit | undefined {
  if (!init?.headers) return init;
  const h = new Headers(init.headers as HeadersInit);
  h.delete("authorization");
  h.delete("cookie");
  return { ...init, headers: h };
}

// Best-effort pre-check for a clean, early error on obviously-private targets.
// It is NOT the security boundary (a pre-resolve can race the real connection);
// the connect-time lookup in ssrfDispatcher is. Hence resolution failure here is
// non-fatal — the dispatcher re-resolves and fails closed if it points private.
async function preCheckHost(hostname: string): Promise<string | null> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const fam = isIP(host);
  if (fam !== 0) return checkPrivateAddress(host, fam);
  try {
    const results = await lookup(host, { all: true, verbatim: true });
    for (const { address, family } of results) {
      const bad = checkPrivateAddress(address, family);
      if (bad) return bad;
    }
  } catch {
    // Deferred to the connect-time lookup, which fails closed.
  }
  return null;
}

// SSRF-safe: pre-check + connect-time pinning on every hop, including redirects.
export async function safeFetch(
  url: string,
  init?: RequestInit,
  maxRedirects = 5,
): Promise<Response> {
  let current = url;
  let currentInit: RequestInit | undefined = withSafeAcceptEncoding(init);
  for (let i = 0; i <= maxRedirects; i++) {
    const blocked = blockPrivateUrl(current);
    if (blocked) throw new Error(blocked);
    const parsed = new URL(current);
    const pre = await preCheckHost(parsed.hostname);
    if (pre) throw new Error(pre);
    type UndiciInit = NonNullable<Parameters<typeof undiciFetch>[1]>;
    const res = await undiciFetch(current, {
      ...(currentInit as unknown as UndiciInit),
      redirect: "manual",
      dispatcher: ssrfDispatcher,
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res as unknown as Response;
      const next = new URL(location, current).href;
      // Cross-origin hop → scrub credential headers so they don't reach a new host.
      if (new URL(next).origin !== parsed.origin) {
        currentInit = withoutCredentialHeaders(currentInit);
      }
      current = next;
      continue;
    }
    return res as unknown as Response;
  }
  throw new Error("Too many redirects");
}
