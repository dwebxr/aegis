"use client";
import { Analytics } from "@vercel/analytics/next";
import { filterAnalyticsEvent, type AnalyticsEvent } from "@/lib/analytics/filter";

/**
 * Web Analytics, filtered.
 *
 * `beforeSend` is a function, so it cannot be passed from the server-rendered
 * layout — this client boundary exists only to hold it. The policy itself lives
 * in lib/analytics/filter.ts so it can be tested without a render.
 */
export function ProductAnalytics() {
  return <Analytics beforeSend={event => filterAnalyticsEvent(event as AnalyticsEvent)} />;
}
