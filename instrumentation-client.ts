import * as Sentry from "@sentry/nextjs";

/**
 * The one client-side Sentry entry point.
 *
 * sentry.client.config.ts used to hold a near-duplicate of this init and the
 * SDK loaded both — two clients, each tracking its own release-health session.
 * Measured on production: a single page load sent four session envelopes under
 * two distinct session ids. It is also the file the build's deprecation warning
 * asked us to fold in. Its contents are merged below.
 */

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV || "development",
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.1,
    // Forward console.error so structured client logs (e.g. a failed
    // response.json() in a tab component) reach prod observability instead of
    // being visible only in DevTools. Kept here, unlike the server config:
    // client-side there is no explicit capture beside most of them.
    integrations: [Sentry.captureConsoleIntegration({ levels: ["error"] })],
    beforeSend(event) {
      // Query strings carry share-target payloads and campaign parameters.
      if (event.request?.url) {
        event.request.url = event.request.url.split("?")[0];
      }
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map(b => {
          if (b.data?.url && typeof b.data.url === "string") {
            try { b.data.url = new URL(b.data.url).pathname; } catch { /* malformed URL — keep original */ }
          }
          return b;
        });
      }
      return event;
    },
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
