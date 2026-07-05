import { NextResponse } from "next/server";

/** OpenPay (open-pay.jp) x402 v1 JPYC payment gate.
 *
 *  OpenPay is an x402 **v1** gateway for JPYC on Polygon (eip155:137) with an
 *  OpenPay-flavored EIP-3009 authorization (vanilla x402 clients are NOT
 *  compatible). Payment requirements ("accepts") are distributed by the OpenPay
 *  catalog (GET /api/discovery) so fee/forwarder revisions propagate without a
 *  code change; this server never fabricates its own requirements. Verification
 *  and settlement are delegated to the OpenPay facilitator
 *  (POST /api/facilitator/verify | /settle).
 *
 *  Trust model: the facilitator is operator-run (same operator as this app) and
 *  trusted for verify/settle results. The catalog entry is still validated
 *  (scheme/network/asset/merchant) so a catalog bug or takeover can't silently
 *  redirect payments to a different token or recipient — fail closed on any
 *  mismatch. */

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

const ACCEPTS_CACHE_TTL_MS = 5 * 60_000;

export const OPENPAY_URL = process.env.OPENPAY_URL?.trim() || "https://open-pay.jp";
export const OPENPAY_RESOURCE_URL =
  process.env.OPENPAY_RESOURCE_URL?.trim() || "https://aegis-ai.xyz/api/d2a/briefing-jpyc";
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
  return null;
}

export interface OpenPayAccept {
  scheme: string;
  network: string;
  asset: string;
  payTo: string;
  maxAmountRequired: string;
  resource: string;
  extra?: { openpay?: { merchant?: string } } & Record<string, unknown>;
  [key: string]: unknown;
}

/** Normalize for resource-identity comparison: lowercase scheme+host, strip
 *  trailing slashes and query/hash. Returns null for unparseable URLs. */
function normalizeResource(raw: unknown): string | null {
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
  const openpay = (x.extra as Record<string, unknown> | undefined)?.openpay as
    | Record<string, unknown>
    | undefined;
  const merchant = openpay?.merchant;
  return (
    x.scheme === "exact" &&
    x.network === JPYC_NETWORK &&
    typeof x.asset === "string" &&
    x.asset.toLowerCase() === OPENPAY_JPYC_ASSET &&
    typeof merchant === "string" &&
    merchant.toLowerCase() === OPENPAY_MERCHANT
  );
}

let acceptsCache: { accepts: OpenPayAccept[]; at: number } | null = null;

export function _resetOpenPayCache(): void {
  acceptsCache = null;
}

/** Fetch this resource's payment requirements from the OpenPay catalog.
 *
 *  Returns a SINGLE-entry array (the first catalog accept that passes
 *  scheme/network/asset/merchant validation): the 402 body, verify and settle
 *  all use the same entry, so a client can never pay against a requirement we
 *  wouldn't settle. Returns null (route 503s, fail closed) when the catalog is
 *  unreachable, malformed, or has no valid entry for this resource. Successful
 *  lookups are cached for 5 minutes per instance (fee revisions lag ≤5min);
 *  failures are NOT cached so recovery/registration is picked up immediately.
 *  A stale expired cache is never reused — prices may have changed. */
export async function fetchAccepts(): Promise<OpenPayAccept[] | null> {
  if (acceptsCache && Date.now() - acceptsCache.at < ACCEPTS_CACHE_TTL_MS) {
    return acceptsCache.accepts;
  }

  const wanted = normalizeResource(OPENPAY_RESOURCE_URL);
  if (!wanted) return null;

  let data: unknown;
  try {
    const res = await fetch(`${OPENPAY_URL}/api/discovery`, {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    // Network error, timeout, or non-JSON body — fail closed.
    return null;
  }

  const items = (data as { items?: unknown[] } | null)?.items;
  if (!Array.isArray(items)) return null;

  const mine = items.find(
    i => normalizeResource((i as { resource?: unknown })?.resource) === wanted,
  ) as { accepts?: unknown[] } | undefined;
  const valid = (mine?.accepts ?? []).filter(isValidAccept);
  if (valid.length === 0) return null;

  const accepts = [valid[0]];
  acceptsCache = { accepts, at: Date.now() };
  return accepts;
}

export function json402(accepts: OpenPayAccept[], error: string): NextResponse {
  return NextResponse.json({ x402Version: 1, accepts, error }, { status: 402 });
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
