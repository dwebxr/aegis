/**
 * Sentry is loaded lazily here, never at boot.
 *
 * A top-level `import * as Sentry` made webpack inline the whole SDK into this
 * entry (2.70MB), and `register()` importing the runtime config evaluated it on
 * every cold start — a fixed CPU cost paid by every function instance whether or
 * not it ever reported an error. Both are behind dynamic imports now, so the SDK
 * is only read when an error is actually being reported.
 */

const SENTRY_ENABLED = !!(
  process.env.SENTRY_DSN?.trim() || process.env.NEXT_PUBLIC_SENTRY_DSN?.trim()
);

export async function register() {
  // Intentionally does not initialise Sentry: doing so would reintroduce the
  // boot cost this file exists to avoid. onRequestError below (and
  // lib/observability.ts for explicit reports) initialise the SDK on first use.
  //
  // Trade-off: with no boot-time init there is no OpenTelemetry auto-tracing and
  // no automatic breadcrumbs. Error capture — the reason a DSN is configured —
  // is unaffected: Next calls onRequestError for every uncaught server error.
}

export async function onRequestError(
  ...args: Parameters<typeof import("@sentry/nextjs").captureRequestError>
): Promise<void> {
  if (!SENTRY_ENABLED) return;
  // sentry.server.config.ts calls Sentry.init() at module scope; awaiting it
  // guarantees a client exists before the event is captured.
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  } else {
    await import("./sentry.server.config");
  }
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
}
