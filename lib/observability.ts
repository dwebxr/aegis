import { after } from "next/server";

/**
 * Server-side Sentry facade.
 *
 * Why this exists: `@sentry/nextjs` pulls `@sentry/node` + OpenTelemetry into a
 * ~2.7MB chunk. A module-scope `import * as Sentry` anywhere in a route's import
 * graph puts that chunk in the set the runtime evaluates at cold boot, so every
 * cold start paid for the SDK even when the request reported zero errors.
 * Routing server-side reporting through this module keeps the SDK behind a
 * dynamic import: nothing is loaded on the happy path, and the SDK is loaded and
 * initialised on the first event an instance actually reports.
 *
 * Client code keeps importing `@sentry/nextjs` directly — browser CPU is not
 * billed by Vercel, and the browser SDK is initialised by instrumentation-client.ts.
 *
 * Argument types are the SDK's, so a call site only changes its import specifier.
 * The return value differs — the SDK hands back an event id, this returns void
 * because the id is not knowable before the dynamic import resolves and no
 * server call site read it.
 */

type SentrySdk = typeof import("@sentry/nextjs");

const DSN = process.env.SENTRY_DSN?.trim() || process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();

let sdk: Promise<SentrySdk> | null = null;

function loadSdk(): Promise<SentrySdk> {
  // sentry.server.config.ts calls Sentry.init() at module scope; importing it
  // here is what replaces the boot-time initialisation instrumentation.ts used
  // to perform. It is imported once — the cached promise makes init idempotent.
  sdk ??= import("@/sentry.server.config").then(() => import("@sentry/nextjs"));
  return sdk;
}

/** Bound on how long a flush may hold the instance open after the response. */
const FLUSH_TIMEOUT_MS = 2000;

/**
 * Hands `run` a loaded SDK, then flushes.
 *
 * Capturing only queues the event; the transport sends it later. The build-time
 * wrapper this replaces flushed on the way out (`waitUntil(flushSafely())`), so
 * the flush here is what keeps delivery equivalent rather than best-effort — a
 * serverless instance can be frozen the moment the response is written.
 *
 * `after()` keeps the instance alive for that work while still letting the
 * response go out first. Outside a request scope (module init, timers) it
 * throws, and a detached promise is the only option left — delivery is
 * best-effort there, as it was before this change.
 */
function report(run: (sentry: SentrySdk) => void): void {
  if (!DSN) return;
  const deliver = async () => {
    try {
      const sentry = await loadSdk();
      run(sentry);
      await sentry.flush(FLUSH_TIMEOUT_MS);
    } catch (err) {
      // Reporting is ancillary: never let it propagate into the path it observes.
      console.warn("[observability] Sentry delivery failed:", err);
    }
  };
  try {
    after(deliver);
  } catch {
    void deliver();
  }
}

export const captureException: (
  ...args: Parameters<SentrySdk["captureException"]>
) => void = (...args) => report(s => { s.captureException(...args); });

export const captureMessage: (
  ...args: Parameters<SentrySdk["captureMessage"]>
) => void = (...args) => report(s => { s.captureMessage(...args); });

/** Test seam: drops the cached SDK promise so a suite can assert lazy loading. */
export function _resetObservability(): void {
  sdk = null;
}
