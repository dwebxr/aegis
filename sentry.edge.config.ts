import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN?.trim() || process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    beforeSend(event) {
      if (event.request) {
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
