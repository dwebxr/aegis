/**
 * Web Analytics bills per event and `<Analytics />` reported every page view
 * with no sampling. These pin the filter that bounds it — and, just as
 * importantly, pin that the events worth keeping still get through.
 */
import { filterAnalyticsEvent, ANALYTICS_SAMPLE_RATE, type AnalyticsEvent } from "@/lib/analytics/filter";

const pageview = (url: string): AnalyticsEvent => ({ type: "pageview", url });

/** Deterministic sampling: below the rate keeps, at or above drops. */
const keep = () => 0;
const drop = () => 0.99;

describe("filterAnalyticsEvent", () => {
  it("reports a landing page view", () => {
    expect(filterAnalyticsEvent(pageview("https://aegis-ai.xyz/"), keep))
      .toEqual({ type: "pageview", url: "https://aegis-ai.xyz/" });
  });

  it("samples page views at the declared rate", () => {
    expect(filterAnalyticsEvent(pageview("https://aegis-ai.xyz/"), drop)).toBeNull();
    expect(ANALYTICS_SAMPLE_RATE).toBeGreaterThan(0);
    expect(ANALYTICS_SAMPLE_RATE).toBeLessThan(1);
  });

  it("never samples custom events — they are deliberate and rare", () => {
    const event: AnalyticsEvent = { type: "event", url: "https://aegis-ai.xyz/" };
    expect(filterAnalyticsEvent(event, drop)).toEqual(event);
  });

  it("drops the PWA offline fallback", () => {
    expect(filterAnalyticsEvent(pageview("https://aegis-ai.xyz/offline"), keep)).toBeNull();
  });

  it("keeps shared briefing pages — a view there is the share working", () => {
    expect(filterAnalyticsEvent(pageview("https://aegis-ai.xyz/b/naddr1abc"), keep))
      .toEqual({ type: "pageview", url: "https://aegis-ai.xyz/b/naddr1abc" });
  });

  it("strips the query string, which can carry shared content", () => {
    const result = filterAnalyticsEvent(
      pageview("https://aegis-ai.xyz/?text=something%20a%20visitor%20pasted&utm_source=x"),
      keep,
    );
    expect(result?.url).toBe("https://aegis-ai.xyz/");
  });

  it("strips the fragment too", () => {
    expect(filterAnalyticsEvent(pageview("https://aegis-ai.xyz/api-docs#tag/Fetching"), keep)?.url)
      .toBe("https://aegis-ai.xyz/api-docs");
  });

  it("drops an unparseable url rather than sending a junk row", () => {
    expect(filterAnalyticsEvent(pageview("not a url"), keep)).toBeNull();
  });

  it("keeps roughly the sampled share of a large run", () => {
    let sent = 0;
    const N = 20_000;
    for (let i = 0; i < N; i++) {
      if (filterAnalyticsEvent(pageview("https://aegis-ai.xyz/"))) sent++;
    }
    // Wide band: this asserts the sampling is applied at all, not the RNG.
    expect(sent / N).toBeGreaterThan(ANALYTICS_SAMPLE_RATE - 0.05);
    expect(sent / N).toBeLessThan(ANALYTICS_SAMPLE_RATE + 0.05);
  });
});
