import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    beforeSend(event) {
      if (event.request) {
        // Scrub auth headers and cookies — keep request body for debugging
        if (event.request.headers) {
          const { authorization, cookie, ...safe } = event.request.headers;
          event.request.headers = safe;
        }
        if (event.request.cookies) {
          event.request.cookies = {};
        }
      }
      return event;
    },
  });
}
