import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    beforeSend(event) {
      // Strip sensitive data from breadcrumbs and request bodies
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map(b => {
          if (b.data?.url && typeof b.data.url === "string") {
            try { b.data.url = new URL(b.data.url).pathname; } catch { /* keep original */ }
          }
          return b;
        });
      }
      return event;
    },
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
