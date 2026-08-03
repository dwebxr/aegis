import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN?.trim() || process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
    tracesSampleRate: 0.1,
    // captureConsoleIntegration is deliberately absent. It re-serialised and
    // shipped an event for every server-side console.error, which on this
    // deployment is dominated by routine upstream failures (dead RSS feeds,
    // relay timeouts) that the surrounding code already reports explicitly via
    // lib/observability.ts. Dropping it removes that per-error CPU and the event
    // quota it consumed; console.error still reaches Vercel stdout.
    // The cost: a console.error with no explicit capture beside it is no longer
    // forwarded — see the audit list in the perf commit message.
    beforeSend(event) {
      if (event.request) {
        if (event.request.headers) {
          const { authorization, cookie, ...safe } = event.request.headers;
          event.request.headers = safe;
        }
        if (event.request.cookies) {
          event.request.cookies = {};
        }
        if (event.request.url) {
          event.request.url = event.request.url.split("?")[0];
        }
        if (event.request.query_string) {
          event.request.query_string = "";
        }
      }
      return event;
    },
  });
}
