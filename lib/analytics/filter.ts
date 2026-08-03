/**
 * Decides which Web Analytics events are worth sending.
 *
 * `<Analytics />` reports every page view with no sampling, so its event count
 * tracks raw traffic — including crawlers reaching share pages and the PWA
 * offline fallback, neither of which says anything about how the product is
 * doing. Speed Insights showed what unbounded telemetry costs on this
 * deployment; this keeps the same class of spend bounded before it repeats.
 *
 * Kept a pure function, separate from the component, so the policy is testable
 * without rendering anything.
 */

export interface AnalyticsEvent {
  type: "pageview" | "event";
  url: string;
}

/**
 * Fraction of eligible page views reported. 0.3 matches the rate the operator
 * already judged acceptable for Speed Insights on this site: enough to see
 * relative movement between days, at a third of the events. Custom events are
 * never sampled — they are deliberate and rare.
 */
export const ANALYTICS_SAMPLE_RATE = 0.3;

/** Paths that generate volume without product signal. */
const EXCLUDED_PREFIXES = [
  // PWA fallback shown when the service worker has no cached response. A view
  // here means the network failed, which the error tracker already reports.
  "/offline",
];

/**
 * Returns the event to send, or null to drop it.
 *
 * `random` is injected so the sampling decision is deterministic under test.
 */
export function filterAnalyticsEvent(
  event: AnalyticsEvent,
  random: () => number = Math.random,
): AnalyticsEvent | null {
  let url: URL;
  try {
    url = new URL(event.url);
  } catch {
    // An unparseable URL cannot be classified, so it cannot be shown to carry
    // signal either — and it would land in the dashboard as a junk row.
    return null;
  }

  if (EXCLUDED_PREFIXES.some(prefix => url.pathname.startsWith(prefix))) return null;

  // Custom events are emitted by explicit code, not by navigation, so they are
  // already scarce; sampling them would make them unreadable.
  if (event.type === "pageview" && random() >= ANALYTICS_SAMPLE_RATE) return null;

  // Query strings here carry share/campaign parameters and the share-target
  // payload. They fragment every path into unique rows and can contain content
  // the visitor pasted, so only the path is reported. Mirrors the same rule in
  // sentry.server.config.ts.
  url.search = "";
  url.hash = "";
  return { ...event, url: url.toString() };
}
