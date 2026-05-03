import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN?.trim() || process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
    tracesSampleRate: 0.1,
    // Forward console.warn/error so server-side logs (route handlers,
    // fetcher errors, KV import failures) reach Sentry — not just Vercel
    // stdout. Existing explicit Sentry.captureException calls dedupe via
    // Sentry's fingerprinting, so this won't double-fire on same event.
    integrations: [Sentry.captureConsoleIntegration({ levels: ["warn", "error"] })],
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
