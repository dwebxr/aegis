import { NextResponse } from "next/server";
import { readCappedText } from "@/lib/utils/httpBody.server";

/** OpenPay (open-pay.jp) x402 v1 JPYC payment gate.
 *
 *  OpenPay is an x402 **v1** gateway for JPYC on Polygon (eip155:137) with an
 *  OpenPay-flavored EIP-3009 authorization (vanilla x402 clients are NOT
 *  compatible). Payment requirements ("accepts") are distributed by the OpenPay
 *  catalog (GET /api/discovery/<resourceId>) so fee/forwarder revisions propagate
 *  without a code change; this server never fabricates its own requirements.
 *  Verification and settlement are delegated to the OpenPay facilitator
 *  (POST /api/facilitator/verify | /settle).
 *
 *  Trust model: the facilitator is operator-run (same operator as this app) and
 *  trusted for verify/settle results. Discovery is pinned to our listing ID and
 *  exact resource URL. Every accept must pin our merchant recipient and send
 *  payment to its declared forwarder in forwarder-split mode; any trust mismatch
 *  rejects the whole listing. Scheme/network/asset and v1 fields are then checked
 *  before advertising a single requirement. */

const JPYC_NETWORK = "eip155:137";
// JPY Coin on Polygon PoS as listed in the OpenPay catalog.
const DEFAULT_JPYC_ASSET = "0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29";

// Base64 X-PAYMENT header cap — an EIP-3009 authorization payload is well under
// 4KB; anything larger is garbage and must not reach JSON.parse or the facilitator.
const MAX_PAYMENT_HEADER_BYTES = 16 * 1024;

const DISCOVERY_TIMEOUT_MS = 5_000;
const VERIFY_TIMEOUT_MS = 10_000;
// settle is never retried (a retry could double-settle); its timeout is the
// longest single leg but the route's worst-case chain must stay inside maxDuration.
const SETTLE_TIMEOUT_MS = 15_000;

// Each discovery lookup costs OpenPay KV reads, so the cache age depends on
// what the listing is used for. A request carrying a payment header is
// verified and settled against it and must see recent terms; an unpaid
// request only advertises them in a 402.
export const ACCEPTS_PAYMENT_MAX_AGE_MS = 5 * 60_000;
export const ACCEPTS_CHALLENGE_MAX_AGE_MS = 30 * 60_000;
const MAX_DISCOVERY_BODY_BYTES = 512 * 1024;
const MAX_ACCEPTS = 16;
const MAX_ACCEPT_DEPTH = 8;
const RESOURCE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Trailing slashes are stripped so path concatenation can't produce
// "https://host//api/..." (routers/CDNs often treat // as a distinct path).
export const OPENPAY_URL = (process.env.OPENPAY_URL?.trim() || "https://open-pay.jp").replace(/\/+$/, "");
export const OPENPAY_RESOURCE_URL =
  process.env.OPENPAY_RESOURCE_URL?.trim() || "https://aegis-ai.xyz/api/d2a/briefing-jpyc";
export const OPENPAY_RESOURCE_ID = process.env.OPENPAY_RESOURCE_ID?.trim().toLowerCase() || "";
export const OPENPAY_MERCHANT = (process.env.OPENPAY_MERCHANT_ADDRESS?.trim() || "").toLowerCase();
const OPENPAY_JPYC_ASSET =
  (process.env.OPENPAY_JPYC_ASSET?.trim() || DEFAULT_JPYC_ASSET).toLowerCase();

function isAllowedFacilitatorUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "localhost");
}

/** null when the gate is usable; otherwise the reason the route must 503.
 *  Evaluated lazily (not thrown at module load) so a misconfigured env can
 *  never take down the whole route module, including OPTIONS/CORS preflight. */
export function openpayConfigError(): string | null {
  if (!isAllowedFacilitatorUrl(OPENPAY_URL)) return "OpenPay URL misconfigured";
  if (!OPENPAY_MERCHANT) return "OpenPay merchant not configured";
  if (!isEvmAddress(OPENPAY_MERCHANT)) return "OpenPay merchant address malformed";
  if (!isOpenPayResourceId(OPENPAY_RESOURCE_ID)) return "OpenPay resource id missing or malformed";
  if (normalizeResource(OPENPAY_RESOURCE_URL) !== OPENPAY_RESOURCE_URL) {
    return "OpenPay resource URL non-canonical";
  }
  return null;
}

export function isOpenPayResourceId(s: unknown): s is string {
  return typeof s === "string" && RESOURCE_ID_PATTERN.test(s);
}

export function isEvmAddress(s: unknown): s is string {
  return typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s);
}

export interface OpenPayAccept {
  scheme: string;
  network: string;
  asset: string;
  payTo: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  maxTimeoutSeconds: number;
  extra?: {
    openpay?: { merchant?: string; mode?: string; forwarder?: string } & Record<string, unknown>;
  } & Record<string, unknown>;
  [key: string]: unknown;
}

/** Normalize for resource-identity comparison: lowercase scheme+host, strip
 *  trailing slashes and query/hash. Returns null for unparseable URLs. */
export function normalizeResource(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
}

function isValidAccept(a: unknown): a is OpenPayAccept {
  if (!a || typeof a !== "object") return false;
  const x = a as Record<string, unknown>;
  return (
    x.scheme === "exact" &&
    x.network === JPYC_NETWORK &&
    // The requirement itself is what the client's wallet authorizes — its
    // `resource` must be THIS endpoint, not just the enclosing catalog item's,
    // or malformed catalog data could have us settle a payment bound elsewhere.
    x.resource === OPENPAY_RESOURCE_URL &&
    typeof x.asset === "string" &&
    x.asset.toLowerCase() === OPENPAY_JPYC_ASSET &&
    // x402 v1 requirements a wallet can actually pay against — an accept
    // missing any required v1 field (payTo, maxAmountRequired, description,
    // mimeType, maxTimeoutSeconds) would serve an unusable 402 and reach the
    // facilitator malformed; fail closed instead.
    typeof x.payTo === "string" &&
    x.payTo.length > 0 &&
    typeof x.maxAmountRequired === "string" &&
    /^[0-9]+$/.test(x.maxAmountRequired) &&
    typeof x.description === "string" &&
    typeof x.mimeType === "string" &&
    typeof x.maxTimeoutSeconds === "number" &&
    Number.isInteger(x.maxTimeoutSeconds) &&
    x.maxTimeoutSeconds > 0
  );
}

let acceptsCache: { accepts: OpenPayAccept[]; at: number } | null = null;
let acceptsInFlight: Promise<OpenPayAccept[] | null> | null = null;
let acceptsGeneration = 0;

export function _resetOpenPayCache(): void {
  acceptsGeneration++;
  acceptsCache = null;
  acceptsInFlight = null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function address(value: unknown): string | null {
  return isEvmAddress(value) ? value.toLowerCase() : null;
}

// Bound recursion before serialization, while keeping all upstream fields.
function withinAcceptDepth(value: unknown, depth = 0): boolean {
  if (depth > MAX_ACCEPT_DEPTH) return false;
  if (!value || typeof value !== "object") return true;
  return Object.values(value).every(child => withinAcceptDepth(child, depth + 1));
}

function rejectListing(reason: string): null {
  console.warn(`[openpay-jpyc] listing rejected: ${reason}`);
  return null;
}

async function loadAccepts(): Promise<OpenPayAccept[] | null> {
  try {
    const res = await fetch(`${OPENPAY_URL}/api/discovery/${encodeURIComponent(OPENPAY_RESOURCE_ID)}`, {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return rejectListing(`discovery HTTP ${res.status}`);
    const body = await readCappedText(res, MAX_DISCOVERY_BODY_BYTES);
    if (body.truncated) return rejectListing("discovery body too large");
    const item: unknown = JSON.parse(body.text);
    if (!isPlainObject(item)) return rejectListing("response is not an object");
    if (item.id !== OPENPAY_RESOURCE_ID || item.resource !== OPENPAY_RESOURCE_URL) {
      return rejectListing("resource identity mismatch");
    }
    if (!Array.isArray(item.accepts) || item.accepts.length === 0 || item.accepts.length > MAX_ACCEPTS) {
      return rejectListing("invalid accepts array");
    }
    // Check trust across ALL entries before choosing a structurally usable one.
    for (const accept of item.accepts) {
      if (!isPlainObject(accept) || !isPlainObject(accept.extra) || !isPlainObject(accept.extra.openpay)) {
        return rejectListing("JPYC split missing");
      }
      const split = accept.extra.openpay;
      if (address(split.merchant) !== OPENPAY_MERCHANT) return rejectListing("JPYC recipient mismatch");
      const forwarder = address(split.forwarder);
      if (split.mode !== "forwarder-split" || !forwarder || address(accept.payTo) !== forwarder) {
        return rejectListing("JPYC forwarder mismatch");
      }
      if (!withinAcceptDepth(accept)) return rejectListing("accept nested too deeply");
    }
    const valid = item.accepts.find((accept): accept is OpenPayAccept => isValidAccept(accept));
    if (!valid) return rejectListing("no valid payment requirements");
    const accepts = [valid];
    JSON.stringify(accepts);
    return accepts;
  } catch {
    // Network, body, validation and serialization errors all fail closed.
    return rejectListing("discovery unreadable or invalid");
  }
}

export type AcceptsPurpose = "payment" | "challenge";

/** Return the first structurally valid accept after checking every seller pin.
 *  The 402 body, verify and settle use this same verbatim entry. Only lookups
 *  that passed validation are cached, timed from when the fetch started; a
 *  "payment" caller reuses them for 5 minutes, a "challenge" (unpaid 402)
 *  caller for 30. Failures are never cached, but they don't evict the last
 *  good entry either, so a challenge can keep serving it while a payment
 *  caller refetches. Concurrent misses share a fetch (its result is fresh for
 *  either purpose), and resets fence off stale results. */
export async function fetchAccepts(purpose: AcceptsPurpose = "payment"): Promise<OpenPayAccept[] | null> {
  if (openpayConfigError()) return null;
  const maxAge = purpose === "challenge" ? ACCEPTS_CHALLENGE_MAX_AGE_MS : ACCEPTS_PAYMENT_MAX_AGE_MS;
  if (acceptsCache && Date.now() - acceptsCache.at < maxAge) {
    return acceptsCache.accepts;
  }
  if (acceptsInFlight) return acceptsInFlight;

  const generation = acceptsGeneration;
  const startedAt = Date.now();
  const pending = loadAccepts()
    .then((accepts) => {
      if (generation === acceptsGeneration && accepts) {
        acceptsCache = { accepts, at: startedAt };
      }
      return accepts;
    })
    .finally(() => {
      if (generation === acceptsGeneration && acceptsInFlight === pending) acceptsInFlight = null;
    });
  acceptsInFlight = pending;
  return pending;
}

export function json402(
  accepts: OpenPayAccept[],
  error: string,
  paymentRequiredHeader?: string,
): NextResponse {
  const response = NextResponse.json({ x402Version: 1, accepts, error }, { status: 402 });
  if (paymentRequiredHeader) response.headers.set("PAYMENT-REQUIRED", paymentRequiredHeader);
  return response;
}

export type ParsedPayment =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string };

/** Decode and structurally check the X-PAYMENT header. The payload INTERNALS are
 *  deliberately opaque — OpenPay's JPYC authorization has multiple forms
 *  (forwarder-split / direct) and the facilitator is the authority on them; we
 *  only enforce size and "is a JSON object" before relaying. */
export function parsePaymentHeader(header: string): ParsedPayment {
  if (header.length > MAX_PAYMENT_HEADER_BYTES) return { ok: false, error: "invalid_payment_payload" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return { ok: false, error: "invalid_payment_payload" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "invalid_payment_payload" };
  }
  return { ok: true, payload: parsed as Record<string, unknown> };
}

async function facilitatorPost(
  path: "verify" | "settle",
  paymentPayload: Record<string, unknown>,
  accept: OpenPayAccept,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  let res: Response;
  try {
    res = await fetch(`${OPENPAY_URL}/api/facilitator/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x402Version: 1, paymentPayload, paymentRequirements: accept }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch {
    return null; // network error / timeout — caller fails the payment, never retries
  }
  // The facilitator reports verification failure in the JSON body (possibly with
  // a non-200 status) — parse regardless of status so invalidReason/errorReason
  // survive; non-JSON bodies become null → generic failure.
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return null;
  }
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; error: string };

export async function facilitatorVerify(
  paymentPayload: Record<string, unknown>,
  accept: OpenPayAccept,
): Promise<VerifyResult> {
  const data = await facilitatorPost("verify", paymentPayload, accept, VERIFY_TIMEOUT_MS);
  if (!data || data.isValid !== true) {
    const reason = typeof data?.invalidReason === "string" ? data.invalidReason : "payment_invalid";
    return { ok: false, error: reason };
  }
  return { ok: true };
}

export type SettleResult =
  | { ok: true; paymentResponseHeader: string }
  | { ok: false; error: string };

/** Single attempt, NO retry: a settle that timed out may still land on-chain, and
 *  re-submitting a fresh settle call risks double-settlement. On any failure the
 *  caller returns 402 and the buyer's wallet retries with a fresh authorization. */
export async function facilitatorSettle(
  paymentPayload: Record<string, unknown>,
  accept: OpenPayAccept,
): Promise<SettleResult> {
  const data = await facilitatorPost("settle", paymentPayload, accept, SETTLE_TIMEOUT_MS);
  if (!data || data.success !== true) {
    const reason = typeof data?.errorReason === "string" ? data.errorReason : "settlement_failed";
    return { ok: false, error: reason };
  }
  return {
    ok: true,
    paymentResponseHeader: Buffer.from(JSON.stringify(data)).toString("base64"),
  };
}
