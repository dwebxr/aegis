import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN?.trim() || process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
    tracesSampleRate: 0.1,
    // Forward only console.error to Sentry (incidents). console.warn stays in
    // Vercel stdout: warn-level diagnostics carry pubkeys/feed URLs and dominate
    // the event volume, so capturing them would leak PII and inflate quota. The
    // beforeSend below still strips request headers/cookies/query from what is sent.
    integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
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
