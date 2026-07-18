import { createHash, randomUUID } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { decodePaymentSignatureHeader } from "@x402/core/http";
import { getFacilitatorResponseError } from "@x402/core/server";
import { withX402 } from "@x402/next";
import { NextRequest, NextResponse } from "next/server";
import { ANTHROPIC_DEFAULT_MODEL } from "@/lib/api/anthropic";
import { getScoreBudgetRetryAfter, tryReserveScoreBudget } from "@/lib/api/dailyBudget";
import { scoreCacheKV } from "@/lib/api/kv/namespace";
import { distributedRateLimitByKey } from "@/lib/api/rateLimit";
import { corsOptionsResponse, withCors } from "@/lib/d2a/cors";
import {
  acquirePaymentWork,
  canonicalPaymentIdentity,
} from "@/lib/d2a/settlementJournal";
import {
  resourceServer,
  X402_NETWORK,
  X402_RECEIVER,
  X402_SCORE_PRICE,
} from "@/lib/d2a/x402Server";
import { extractArticle } from "@/lib/extraction/extractArticle.server";
import { enforceScoreInvariants } from "@/lib/scoring/invariants";
import { scoreOneText } from "@/lib/scoring/scoreWithClaude.server";
import type { ScoreParseResult } from "@/lib/scoring/types";
import { blockPrivateUrl } from "@/lib/utils/url";

export const maxDuration = 120;

const SCORE_CACHE_TTL_SECONDS = 60 * 60;
const SCORE_MARKER_TTL_SECONDS = 150;
const SCORE_FREE_ENABLED = process.env.D2A_SCORE_FREE_ENABLED === "true";
const IS_PRODUCTION =
  process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";

if (SCORE_FREE_ENABLED && IS_PRODUCTION) {
  throw new Error("D2A_SCORE_FREE_ENABLED must not be enabled in production");
}

const x402Config = {
  accepts: {
    scheme: "exact" as const,
    price: X402_SCORE_PRICE,
    network: X402_NETWORK,
    payTo: X402_RECEIVER,
    maxTimeoutSeconds: 300,
  },
  description: "Score a URL's content quality (V/C/L) with AI",
};

interface ScoreResponse {
  url: string;
  title: string;
  source: string;
  author?: string;
  publishedDate?: string;
  scoredAt: string;
  engine: "claude";
  model: string;
  cached: boolean;
  score: ScoreParseResult;
}

function clientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";
}

function safeUrl(url?: URL): string | undefined {
  return url ? `${url.origin}${url.pathname}` : undefined;
}

function reportOperationalError(
  error: unknown,
  reason: string,
  url?: URL,
): void {
  Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
    tags: { route: "d2a-score", reason },
    extra: { url: safeUrl(url) },
  });
}

function errorResponse(
  status: 502 | 503,
  reason: string,
  message: string,
  url?: URL,
  error?: unknown,
  retryAfter?: number,
): NextResponse {
  if (error !== undefined) reportOperationalError(error, reason, url);
  return NextResponse.json(
    { error: message, reason },
    {
      status,
      ...(retryAfter ? { headers: { "Retry-After": String(retryAfter) } } : {}),
    },
  );
}

function cacheKey(url: string): string {
  const hash = createHash("sha256").update(url).digest("hex");
  return `v1:${ANTHROPIC_DEFAULT_MODEL}:${hash}`;
}

function secondsUntilNextUtcDay(): number {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

async function readCachedScore(key: string, parsedUrl: URL): Promise<NextResponse | null> {
  try {
    const cached = await scoreCacheKV.get<ScoreResponse>(key);
    if (!cached) return null;
    return NextResponse.json({ ...cached, cached: true });
  } catch (error) {
    return errorResponse(
      503,
      "cache_unavailable",
      "Score cache is temporarily unavailable",
      parsedUrl,
      error,
    );
  }
}

async function handleScore(request: NextRequest): Promise<NextResponse> {
  const limited = await distributedRateLimitByKey(`score:${clientIp(request)}`, 10, 60);
  if (limited) return limited;

  const rawUrl = request.nextUrl.searchParams.get("url");
  if (!rawUrl) {
    return NextResponse.json({ error: "Missing required url parameter" }, { status: 400 });
  }
  if (rawUrl.length > 2048) {
    return NextResponse.json({ error: "URL must be 2048 characters or fewer" }, { status: 400 });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }
  if (parsedUrl.username || parsedUrl.password) {
    return NextResponse.json(
      { error: "URLs with embedded credentials are not allowed" },
      { status: 400 },
    );
  }
  const blocked = blockPrivateUrl(rawUrl);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 400 });

  parsedUrl.hash = "";
  const normalizedUrl = parsedUrl.toString();

  const paymentSignature = request.headers.get("payment-signature");
  if (paymentSignature !== null) {
    let paymentIdentity: string;
    try {
      const paymentPayload = decodePaymentSignatureHeader(paymentSignature);
      paymentIdentity = canonicalPaymentIdentity(paymentPayload);
    } catch {
      return NextResponse.json(
        { error: "Invalid PAYMENT-SIGNATURE header" },
        { status: 400 },
      );
    }
    try {
      const acquired = await acquirePaymentWork(paymentIdentity);
      if (acquired !== true) {
        return errorResponse(
          503,
          "payment_in_progress",
          "This payment is already processing another scoring request",
          parsedUrl,
          undefined,
          10,
        );
      }
    } catch (error) {
      return errorResponse(
        503,
        "payment_in_progress",
        "This payment is already processing another scoring request",
        parsedUrl,
        error,
        10,
      );
    }
  }

  const key = cacheKey(normalizedUrl);
  const cached = await readCachedScore(key, parsedUrl);
  if (cached) return cached;

  const ownerToken = randomUUID();
  let marker: "OK" | null | undefined;
  try {
    marker = await scoreCacheKV.set(`in-progress:${key}`, ownerToken, {
      nx: true,
      ex: SCORE_MARKER_TTL_SECONDS,
    });
  } catch (error) {
    return errorResponse(
      503,
      "cache_unavailable",
      "Score cache is temporarily unavailable",
      parsedUrl,
      error,
    );
  }
  if (marker === undefined) {
    return errorResponse(
      503,
      "cache_unavailable",
      "Score cache is temporarily unavailable",
      parsedUrl,
    );
  }
  if (marker === null) {
    const completed = await readCachedScore(key, parsedUrl);
    if (completed) return completed;
    return errorResponse(
      503,
      "score_in_progress",
      "This URL is already being scored",
      parsedUrl,
      undefined,
      10,
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return errorResponse(
      503,
      "scoring_unavailable",
      "Scoring is temporarily unavailable",
      parsedUrl,
    );
  }
  if (IS_PRODUCTION && !process.env.KV_REST_API_URL?.trim()) {
    return errorResponse(
      503,
      "kv_unconfigured",
      "Scoring requires configured KV storage in production",
      parsedUrl,
    );
  }

  const extraction = await extractArticle(normalizedUrl);
  if (!extraction.data) {
    if (extraction.status === 502) {
      reportOperationalError(
        new Error(extraction.error || "Article extraction failed"),
        "extraction_unavailable",
        parsedUrl,
      );
    }
    return NextResponse.json(
      { error: extraction.error || "Could not extract article content" },
      { status: extraction.status },
    );
  }

  let reserved = false;
  let retryAfter = secondsUntilNextUtcDay();
  try {
    reserved = await tryReserveScoreBudget();
    if (!reserved) retryAfter = await getScoreBudgetRetryAfter();
  } catch (error) {
    reportOperationalError(error, "budget_exhausted", parsedUrl);
    try {
      retryAfter = await getScoreBudgetRetryAfter();
    } catch {
      retryAfter = secondsUntilNextUtcDay();
    }
    return NextResponse.json(
      { error: "Daily scoring budget is exhausted", reason: "budget_exhausted" },
      { status: 503, headers: { "Retry-After": String(retryAfter) } },
    );
  }
  if (!reserved) {
    return errorResponse(
      503,
      "budget_exhausted",
      "Daily scoring budget is exhausted",
      parsedUrl,
      undefined,
      retryAfter,
    );
  }

  let score: ScoreParseResult;
  try {
    const rawScore = await scoreOneText(extraction.data.content, undefined, apiKey, {
      timeoutMs: 30_000,
      untrustedNotice: true,
    });
    score = enforceScoreInvariants(rawScore);
  } catch (error) {
    return errorResponse(
      502,
      "scoring_unavailable",
      "Scoring service failed to produce a result",
      parsedUrl,
      error,
    );
  }

  const response: ScoreResponse = {
    url: normalizedUrl,
    title: extraction.data.title,
    source: extraction.data.source,
    ...(extraction.data.author && extraction.data.author !== "Unknown"
      ? { author: extraction.data.author }
      : {}),
    ...(extraction.data.publishedDate
      ? { publishedDate: extraction.data.publishedDate }
      : {}),
    scoredAt: new Date().toISOString(),
    engine: "claude",
    model: ANTHROPIC_DEFAULT_MODEL,
    cached: false,
    score,
  };

  try {
    const stored = await scoreCacheKV.set(key, response, { ex: SCORE_CACHE_TTL_SECONDS });
    if (stored !== "OK") {
      reportOperationalError(
        new Error("Score cache became unavailable during write"),
        "cache_write_failed",
        parsedUrl,
      );
    }
  } catch (error) {
    reportOperationalError(error, "cache_write_failed", parsedUrl);
  }

  Sentry.addBreadcrumb({
    category: "d2a-score.usage",
    level: "info",
    data: { model: ANTHROPIC_DEFAULT_MODEL },
  });
  if (Math.random() < 0.1) {
    Sentry.captureMessage("D2A score usage", {
      level: "info",
      tags: { route: "d2a-score", telemetry: "usage-sample" },
      extra: { model: ANTHROPIC_DEFAULT_MODEL },
    });
  }

  return NextResponse.json(response);
}

type ScoreHandler = (request: NextRequest) => Promise<NextResponse>;
let paidHandler: ScoreHandler | null = null;

function getPaidHandler(): ScoreHandler {
  if (!paidHandler) paidHandler = withX402(handleScore, x402Config, resourceServer);
  return paidHandler;
}

function finalize(response: NextResponse, request: NextRequest): NextResponse {
  response.headers.set("Cache-Control", "no-store, private");
  return withCors(response, request.headers.get("origin"));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    if (process.env.D2A_SCORE_ENABLED !== "true") {
      return finalize(
        errorResponse(503, "disabled", "URL scoring is disabled"),
        request,
      );
    }
    if (process.env.D2A_PAYMENTS_DISABLED === "true") {
      return finalize(
        errorResponse(503, "payments_disabled", "D2A payments are disabled"),
        request,
      );
    }

    const limited = await distributedRateLimitByKey(`score-pre:${clientIp(request)}`, 30, 60);
    if (limited) return finalize(limited, request);

    let response: NextResponse;
    if (SCORE_FREE_ENABLED) {
      response = await handleScore(request);
    } else if (!X402_RECEIVER) {
      response = errorResponse(
        503,
        "payments_unconfigured",
        "Payment receiver is not configured",
      );
    } else {
      response = await getPaidHandler()(request);
    }
    return finalize(response, request);
  } catch (error) {
    const facilitatorError = getFacilitatorResponseError(error);
    if (facilitatorError) {
      return finalize(
        errorResponse(
          502,
          "facilitator_unavailable",
          "Payment facilitator is temporarily unavailable",
          undefined,
          facilitatorError,
        ),
        request,
      );
    }
    Sentry.captureException(error, { tags: { route: "d2a-score", reason: "internal_error" } });
    return finalize(
      NextResponse.json(
        { error: "Internal server error", reason: "internal_error" },
        { status: 500 },
      ),
      request,
    );
  }
}

export async function OPTIONS(request: NextRequest): Promise<NextResponse> {
  const response = corsOptionsResponse(request);
  response.headers.set("Cache-Control", "no-store, private");
  return response;
}
