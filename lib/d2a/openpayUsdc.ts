import { createHash } from "node:crypto";
import { openpayPaymentKV } from "@/lib/api/kv/namespace";
import {
  isEvmAddress,
  normalizeResource,
  OPENPAY_MERCHANT,
  OPENPAY_RESOURCE_URL,
  OPENPAY_URL,
  type OpenPayAccept,
} from "@/lib/d2a/openpayGate";
import { isFeatureEnabled } from "@/lib/featureFlags";
import * as Sentry from "@/lib/observability";
import { readCappedText } from "@/lib/utils/httpBody.server";

export const OPENPAY_RESOURCE_ID = process.env.OPENPAY_RESOURCE_ID?.trim() || "";
const OPENPAY_USDC_ASSET = (
  process.env.OPENPAY_USDC_ASSET?.trim()
  || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
).toLowerCase();
const OPENPAY_USDC_MAX_AMOUNT = process.env.OPENPAY_USDC_MAX_AMOUNT?.trim() || "6000";

export const USDC_V1_NETWORK = "base";
export const USDC_V2_NETWORK = "eip155:8453";
export const REQUIREMENTS_TIMEOUT_MS = 5_000;
export const RELAY_VERIFY_TIMEOUT_MS = 10_000;
export const RELAY_SETTLE_TIMEOUT_MS = 15_000;
export const FACE_CACHE_TTL_MS = 5 * 60_000;
export const FACE_NEGATIVE_TTL_MS = 30_000;
export const MAX_HEADER_BYTES = 16 * 1024;
export const MAX_RELAY_BODY_BYTES = 64 * 1024;
export const MAX_REQUIREMENTS_BODY_BYTES = 512 * 1024;
export const LOCK_TTL_S = 150;
export const STATE_TTL_S = 90 * 24 * 3600;
export const MAX_TIMEOUT_SECONDS = 3600;
export const CLOCK_SKEW_S = 60;

const RESOURCE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGITS_PATTERN = /^[0-9]+$/;
const STRICT_BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const NONCE_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const TRANSACTION_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export function usdcRailConfig():
  | { enabled: true }
  | { enabled: false; reason: string } {
  if (!isFeatureEnabled("openpayUsdcRail")) return { enabled: false, reason: "flag off" };
  if (!RESOURCE_ID_PATTERN.test(OPENPAY_RESOURCE_ID)) {
    return { enabled: false, reason: "resource id missing or malformed" };
  }
  // The JPYC gate only requires a non-empty merchant (its catalog match is
  // string equality). USDC pins payTo to this value, so it must be an address —
  // checked here rather than in openpayConfigError so the flag-OFF route keeps
  // its exact previous behaviour.
  if (!isEvmAddress(OPENPAY_MERCHANT)) {
    return { enabled: false, reason: "merchant address malformed" };
  }
  if (!isEvmAddress(OPENPAY_USDC_ASSET)) {
    return { enabled: false, reason: "usdc asset malformed" };
  }
  if (!DIGITS_PATTERN.test(OPENPAY_USDC_MAX_AMOUNT)) {
    return { enabled: false, reason: "max amount malformed" };
  }
  try {
    if (BigInt(OPENPAY_USDC_MAX_AMOUNT) <= 0n) {
      return { enabled: false, reason: "max amount malformed" };
    }
  } catch {
    return { enabled: false, reason: "max amount malformed" };
  }
  return { enabled: true };
}

const initialConfig = usdcRailConfig();
if (isFeatureEnabled("openpayUsdcRail") && !initialConfig.enabled) {
  console.warn(`[openpay-usdc] rail disabled: ${initialConfig.reason}`);
}

export interface UsdcV2Accept {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
  [key: string]: unknown;
}

export interface UsdcFace {
  v1Accepts: OpenPayAccept;
  v2Accept: UsdcV2Accept;
  paymentRequiredHeader: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// Requirements come from the network; a deeply nested `extra` or accepts entry
// must not be able to overflow the stack and escape validation as a 500.
const MAX_CANONICAL_DEPTH = 32;

function canonicalize(value: unknown, depth = 0): unknown {
  if (depth > MAX_CANONICAL_DEPTH) throw new RangeError("requirements nested too deeply");
  if (Array.isArray(value)) return value.map(item => canonicalize(item, depth + 1));
  if (!isPlainObject(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) sorted[key] = canonicalize(value[key], depth + 1);
  return sorted;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function decodeBase64Object(value: string): Record<string, unknown> | null {
  if (!STRICT_BASE64_PATTERN.test(value)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
  } catch {
    return null;
  }
  return isPlainObject(parsed) ? parsed : null;
}

function rejectFace(reason: string): null {
  console.warn(`[openpay-usdc] face rejected: ${reason}`);
  return null;
}

function validateFace(raw: unknown): UsdcFace | null {
  if (!isPlainObject(raw)) return rejectFace("response is not an object");
  if (raw.resourceId !== OPENPAY_RESOURCE_ID) return rejectFace("resource id mismatch");

  const wanted = normalizeResource(OPENPAY_RESOURCE_URL);
  if (!wanted) return rejectFace("resource URL malformed");

  if (!isPlainObject(raw.v1Accepts)) return rejectFace("v1 accepts missing");
  const v1 = raw.v1Accepts;
  if (v1.scheme !== "exact") return rejectFace("v1 scheme mismatch");
  if (v1.network !== USDC_V1_NETWORK) return rejectFace("v1 network mismatch");
  if (!isEvmAddress(v1.asset) || v1.asset.toLowerCase() !== OPENPAY_USDC_ASSET) {
    return rejectFace("v1 asset mismatch");
  }
  if (!isEvmAddress(v1.payTo) || v1.payTo.toLowerCase() !== OPENPAY_MERCHANT) {
    return rejectFace("v1 payTo mismatch");
  }
  if (normalizeResource(v1.resource) !== wanted) return rejectFace("v1 resource mismatch");
  if (!DIGITS_PATTERN.test(typeof v1.maxAmountRequired === "string" ? v1.maxAmountRequired : "")) {
    return rejectFace("v1 amount malformed");
  }
  const amount = BigInt(v1.maxAmountRequired as string);
  if (amount <= 0n || amount > BigInt(OPENPAY_USDC_MAX_AMOUNT)) {
    return rejectFace("v1 amount outside configured bound");
  }
  if (typeof v1.description !== "string") return rejectFace("v1 description malformed");
  if (typeof v1.mimeType !== "string") return rejectFace("v1 mime type malformed");
  if (
    typeof v1.maxTimeoutSeconds !== "number"
    || !Number.isInteger(v1.maxTimeoutSeconds)
    || v1.maxTimeoutSeconds < 1
    || v1.maxTimeoutSeconds > MAX_TIMEOUT_SECONDS
  ) {
    return rejectFace("v1 timeout malformed");
  }

  if (!isPlainObject(raw.v2Accept)) return rejectFace("v2 accept missing");
  const v2 = raw.v2Accept;
  if (v2.scheme !== "exact") return rejectFace("v2 scheme mismatch");
  if (v2.network !== USDC_V2_NETWORK) return rejectFace("v2 network mismatch");
  if (!isEvmAddress(v2.asset) || v2.asset.toLowerCase() !== OPENPAY_USDC_ASSET) {
    return rejectFace("v2 asset mismatch");
  }
  if (!isEvmAddress(v2.payTo) || v2.payTo.toLowerCase() !== OPENPAY_MERCHANT) {
    return rejectFace("v2 payTo mismatch");
  }
  if (v2.amount !== v1.maxAmountRequired) return rejectFace("v2 amount mismatch");
  if (v2.maxTimeoutSeconds !== v1.maxTimeoutSeconds) return rejectFace("v2 timeout mismatch");
  if (!isPlainObject(v2.extra)) return rejectFace("v2 extra malformed");

  if (typeof raw.paymentRequiredHeader !== "string") {
    return rejectFace("payment required header missing");
  }
  if (raw.paymentRequiredHeader.length > MAX_HEADER_BYTES) {
    return rejectFace("payment required header too large");
  }
  const required = decodeBase64Object(raw.paymentRequiredHeader);
  if (!required) return rejectFace("payment required header malformed");
  if (required.x402Version !== 2) return rejectFace("payment required version mismatch");
  const requiredResource = isPlainObject(required.resource) ? required.resource : null;
  if (normalizeResource(requiredResource?.url) !== wanted) {
    return rejectFace("payment required resource mismatch");
  }
  if (!Array.isArray(required.accepts) || required.accepts.length === 0) {
    return rejectFace("payment required accepts missing");
  }
  const canonicalV2 = canonicalJson(v2);
  if (required.accepts.some(accept => canonicalJson(accept) !== canonicalV2)) {
    return rejectFace("payment required accepts mismatch");
  }

  return {
    v1Accepts: v1 as unknown as OpenPayAccept,
    v2Accept: v2 as unknown as UsdcV2Accept,
    paymentRequiredHeader: raw.paymentRequiredHeader,
  };
}

let faceCache: { face: UsdcFace; at: number } | null = null;
let negativeCacheAt: number | null = null;
let faceInFlight: Promise<UsdcFace | null> | null = null;
let faceGeneration = 0;

export function _resetUsdcState(): void {
  faceGeneration++;
  faceCache = null;
  negativeCacheAt = null;
  faceInFlight = null;
}

async function loadUsdcFace(): Promise<UsdcFace | null> {
  let res: Response;
  try {
    res = await fetch(
      `${OPENPAY_URL}/api/x402/relay/requirements?resourceId=${encodeURIComponent(OPENPAY_RESOURCE_ID)}`,
      {
        signal: AbortSignal.timeout(REQUIREMENTS_TIMEOUT_MS),
        cache: "no-store",
      },
    );
  } catch {
    return null;
  }
  if (!res.ok) return rejectFace(`requirements HTTP ${res.status}`);

  let body: Awaited<ReturnType<typeof readCappedText>>;
  try {
    body = await readCappedText(res, MAX_REQUIREMENTS_BODY_BYTES);
  } catch {
    return rejectFace("requirements body unreadable");
  }
  if (body.truncated) return rejectFace("requirements body too large");

  let data: unknown;
  try {
    data = JSON.parse(body.text);
  } catch {
    return rejectFace("requirements body is not JSON");
  }
  try {
    return validateFace(data);
  } catch (err) {
    // Validation is fail-closed: a throw on hostile input means "no USDC face",
    // never a 500 that would skip the route's no-store/CORS wrapper.
    return rejectFace(`validation threw: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function fetchUsdcFace(): Promise<UsdcFace | null> {
  if (!usdcRailConfig().enabled) return null;

  const now = Date.now();
  if (faceCache && now - faceCache.at < FACE_CACHE_TTL_MS) return faceCache.face;
  if (negativeCacheAt !== null && now - negativeCacheAt < FACE_NEGATIVE_TTL_MS) return null;
  if (faceInFlight) return faceInFlight;

  const generation = faceGeneration;
  const pending = loadUsdcFace()
    .then((face) => {
      if (generation !== faceGeneration) return face;
      if (face) {
        faceCache = { face, at: Date.now() };
        negativeCacheAt = null;
      } else {
        negativeCacheAt = Date.now();
      }
      return face;
    })
    .finally(() => {
      if (generation === faceGeneration && faceInFlight === pending) faceInFlight = null;
    });
  faceInFlight = pending;
  return pending;
}

export function parseV2PaymentHeader(header: string):
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string } {
  if (header.length > MAX_HEADER_BYTES) return { ok: false, error: "invalid_payment_payload" };
  const payload = decodeBase64Object(header);
  return payload
    ? { ok: true, payload }
    : { ok: false, error: "invalid_payment_payload" };
}

export type Rail = "usdc-v1" | "usdc-v2";

export interface UsdcAuthorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export function extractAuthorization(payload: Record<string, unknown>): UsdcAuthorization | null {
  if (!isPlainObject(payload.payload) || !isPlainObject(payload.payload.authorization)) return null;
  const auth = payload.payload.authorization;
  const fields = ["from", "to", "value", "validAfter", "validBefore", "nonce"] as const;
  if (fields.some(field => typeof auth[field] !== "string" || auth[field].length === 0)) return null;
  if (!isEvmAddress(auth.from) || !isEvmAddress(auth.to)) return null;
  if (!DIGITS_PATTERN.test(auth.value as string)) return null;
  if (!DIGITS_PATTERN.test(auth.validAfter as string)) return null;
  if (!DIGITS_PATTERN.test(auth.validBefore as string)) return null;
  if (!NONCE_PATTERN.test(auth.nonce as string)) return null;
  return auth as unknown as UsdcAuthorization;
}

export function paymentIdentity(auth: UsdcAuthorization): string {
  return createHash("sha256")
    .update(
      `${USDC_V2_NETWORK}:${OPENPAY_USDC_ASSET}:${auth.from.toLowerCase()}:${auth.nonce.toLowerCase()}`,
    )
    .digest("hex");
}

function requirementsMismatch(): { ok: false; error: string } {
  return { ok: false, error: "payment_requirements_mismatch" };
}

export function matchesAdvertisedRequirements(
  rail: Rail,
  payload: Record<string, unknown>,
  auth: UsdcAuthorization,
  face: UsdcFace,
  nowSeconds: number,
): { ok: true } | { ok: false; error: string } {
  if (auth.to.toLowerCase() !== face.v2Accept.payTo.toLowerCase()) return requirementsMismatch();
  if (auth.value !== face.v2Accept.amount) return requirementsMismatch();

  const now = BigInt(nowSeconds);
  const validBefore = BigInt(auth.validBefore);
  const validAfter = BigInt(auth.validAfter);
  if (validBefore <= now) return requirementsMismatch();
  if (validBefore > now + BigInt(face.v2Accept.maxTimeoutSeconds + CLOCK_SKEW_S)) {
    return requirementsMismatch();
  }
  if (validAfter > now + BigInt(CLOCK_SKEW_S)) return requirementsMismatch();

  if (rail === "usdc-v2") {
    if (!isPlainObject(payload.accepted)) return requirementsMismatch();
    const accepted = payload.accepted;
    if (accepted.scheme !== "exact" || accepted.network !== USDC_V2_NETWORK) {
      return requirementsMismatch();
    }
    if (!isEvmAddress(accepted.asset) || accepted.asset.toLowerCase() !== face.v2Accept.asset.toLowerCase()) {
      return requirementsMismatch();
    }
    if (!isEvmAddress(accepted.payTo) || accepted.payTo.toLowerCase() !== OPENPAY_MERCHANT) {
      return requirementsMismatch();
    }
    if (accepted.amount !== face.v2Accept.amount) return requirementsMismatch();

    // The resource URL is not covered by the EIP-3009 signature. This check is
    // best-effort client binding; payTo, asset and amount remain the hard pins.
    if (payload.resource !== undefined) {
      if (!isPlainObject(payload.resource)) return requirementsMismatch();
      if (normalizeResource(payload.resource.url) !== normalizeResource(OPENPAY_RESOURCE_URL)) {
        return requirementsMismatch();
      }
    }
    return { ok: true };
  }

  if (payload.network !== USDC_V1_NETWORK) return requirementsMismatch();
  if (payload.scheme !== undefined && payload.scheme !== "exact") return requirementsMismatch();
  return { ok: true };
}

export type PaymentStatus = "pending" | "settled" | "rejected" | "unknown";

export interface PaymentState {
  status: PaymentStatus;
  at: number;
  transaction?: string;
  reason?: string;
}

function isPaymentState(value: unknown): value is PaymentState {
  if (!isPlainObject(value)) return false;
  if (!["pending", "settled", "rejected", "unknown"].includes(String(value.status))) return false;
  if (typeof value.at !== "number" || !Number.isFinite(value.at)) return false;
  if (value.transaction !== undefined && typeof value.transaction !== "string") return false;
  if (value.reason !== undefined && typeof value.reason !== "string") return false;
  return true;
}

export async function readPaymentState(id: string): Promise<
  | { kind: "none" }
  | { kind: "state"; state: PaymentState }
  | { kind: "unavailable" }
> {
  let value: unknown;
  try {
    value = await openpayPaymentKV.get(`${id}:state`);
  } catch {
    return { kind: "unavailable" };
  }
  if (value === undefined) return { kind: "unavailable" };
  if (value === null) return { kind: "none" };
  return isPaymentState(value)
    ? { kind: "state", state: value }
    : { kind: "unavailable" };
}

export async function acquireLock(id: string): Promise<"acquired" | "busy" | "unavailable"> {
  try {
    const result = await openpayPaymentKV.set(
      `${id}:lock`,
      { at: Date.now() },
      { nx: true, ex: LOCK_TTL_S },
    );
    if (result === "OK") return "acquired";
    if (result === null) return "busy";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

export async function releaseLock(id: string): Promise<void> {
  try {
    await openpayPaymentKV.del(`${id}:lock`);
  } catch {
    // A lock expires by TTL; cleanup must never replace the primary response.
  }
}

export async function claimPending(
  id: string,
  at: number,
): Promise<"claimed" | "exists" | "unavailable"> {
  try {
    const result = await openpayPaymentKV.set(
      `${id}:state`,
      { status: "pending", at },
      { nx: true, ex: STATE_TTL_S },
    );
    if (result === "OK") return "claimed";
    if (result === null) return "exists";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

function reportStateWriteFailure(id: string, status: PaymentStatus): void {
  const id16 = id.slice(0, 16);
  console.warn("[openpay-usdc] state write failed", { id16, status });
  Sentry.captureMessage("[openpay-usdc] state write failed", {
    level: "error",
    extra: { id16, status },
  });
}

export async function writePaymentState(id: string, state: PaymentState): Promise<boolean> {
  try {
    const result = await openpayPaymentKV.set(`${id}:state`, state, { ex: STATE_TTL_S });
    if (result === "OK") return true;
  } catch {
    // Report below without leaking the authorization or full identity.
  }
  reportStateWriteFailure(id, state.status);
  return false;
}

export type RelayInput =
  | { paymentSignatureHeader: string }
  | { paymentHeader: string };

// Operators may extend these only after OpenPay confirms the reason means a
// pre-broadcast final rejection. Nonce/already/duplicate/receipt/confirm/
// transaction reasons must remain unknown because they can mean funds moved.
export const VERIFY_REJECT_ALLOWLIST = new Set([
  "insufficient_funds",
  "invalid_signature",
  "invalid_payment_requirements",
  "invalid_scheme",
  "invalid_network",
  "payment_expired",
  "invalid_exact_evm_payload_authorization_valid_after",
  "invalid_exact_evm_payload_authorization_valid_before",
  "invalid_exact_evm_payload_authorization_value",
  "invalid_exact_evm_payload_signature",
  "invalid_exact_evm_payload_recipient_mismatch",
  "unsupported_scheme",
  "unsupported_network",
]);
export const SETTLE_REJECT_ALLOWLIST = VERIFY_REJECT_ALLOWLIST;

async function relayPost(
  path: "verify" | "settle",
  input: RelayInput,
  timeoutMs: number,
): Promise<{ response: Response; data: Record<string, unknown> | null; truncated: boolean } | null> {
  let response: Response;
  try {
    response = await fetch(`${OPENPAY_URL}/api/x402/relay/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resourceId: OPENPAY_RESOURCE_ID, ...input }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch {
    return null;
  }

  try {
    const body = await readCappedText(response, MAX_RELAY_BODY_BYTES);
    if (body.truncated) return { response, data: null, truncated: true };
    const parsed: unknown = JSON.parse(body.text);
    return {
      response,
      data: isPlainObject(parsed) ? parsed : null,
      truncated: false,
    };
  } catch {
    return { response, data: null, truncated: false };
  }
}

export async function relayVerify(input: RelayInput): Promise<
  | { ok: true }
  | { ok: false; error: string; indeterminate: boolean }
> {
  const result = await relayPost("verify", input, RELAY_VERIFY_TIMEOUT_MS);
  if (!result) return { ok: false, error: "verification_unavailable", indeterminate: true };
  const { response, data } = result;
  if (response.ok && data?.isValid === true) return { ok: true };

  const reason = typeof data?.invalidReason === "string" && data.invalidReason.length > 0
    ? data.invalidReason
    : undefined;
  if (
    response.ok
    && data?.isValid === false
    && reason
    && VERIFY_REJECT_ALLOWLIST.has(reason)
  ) {
    return { ok: false, error: reason, indeterminate: false };
  }
  return {
    ok: false,
    error: reason || "verification_unavailable",
    indeterminate: true,
  };
}

function settlementUnknown(
  auth: UsdcAuthorization,
  reason: string,
): { ok: false; error: string; indeterminate: true } {
  const id16 = paymentIdentity(auth).slice(0, 16);
  Sentry.captureMessage("[openpay-usdc] settlement unknown", {
    level: "warning",
    extra: { id16, reason },
  });
  return { ok: false, error: reason, indeterminate: true };
}

export async function relaySettle(input: RelayInput, auth: UsdcAuthorization): Promise<
  | { ok: true; receiptHeader: string; transaction: string }
  | { ok: false; error: string; indeterminate: boolean }
> {
  const result = await relayPost("settle", input, RELAY_SETTLE_TIMEOUT_MS);
  if (!result) return settlementUnknown(auth, "settlement_unknown");
  const { response, data } = result;
  const reason = typeof data?.errorReason === "string" && data.errorReason.length > 0
    ? data.errorReason
    : undefined;

  if (
    response.ok
    && data?.success === true
    && typeof data.transaction === "string"
    && TRANSACTION_PATTERN.test(data.transaction)
    && isEvmAddress(data.payer)
    && data.payer.toLowerCase() === auth.from.toLowerCase()
    && (data.network === USDC_V2_NETWORK || data.network === USDC_V1_NETWORK)
  ) {
    const receipt = {
      success: true,
      transaction: data.transaction,
      network: USDC_V2_NETWORK,
      payer: data.payer,
    };
    return {
      ok: true,
      receiptHeader: Buffer.from(JSON.stringify(receipt)).toString("base64"),
      transaction: data.transaction,
    };
  }

  if (
    response.ok
    && data?.success === false
    && reason
    && SETTLE_REJECT_ALLOWLIST.has(reason)
  ) {
    return { ok: false, error: reason, indeterminate: false };
  }
  return settlementUnknown(auth, reason || "settlement_unknown");
}

export function logUsdcEvent(
  rail: Rail,
  stage: string,
  outcome: string,
  startedAt: number,
  identity?: string,
  reason?: string,
): void {
  console.info("[openpay-usdc] " + JSON.stringify({
    rail,
    stage,
    outcome,
    ...(reason ? { reason } : {}),
    ms: Date.now() - startedAt,
    id: identity?.slice(0, 16) || "unavailable",
  }));
}
