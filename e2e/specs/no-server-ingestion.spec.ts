import { test, expect } from "../fixtures/base";

/**
 * An anonymous visit must not invoke a server function for ingestion.
 *
 * The landing page used to construct the ingestion scheduler regardless of what
 * was on screen — React runs hooks before the early return that renders the
 * hero — so roughly five seconds after hydration every visitor, including one
 * who bounced, triggered POST /api/fetch/rss and POST /api/fetch/url. That was
 * this deployment's largest source of Vercel Active CPU.
 *
 * These tests watch the network rather than the implementation, so they keep
 * holding if the gating moves.
 */

/** The scheduler's first cycle is 5s after hydration; wait past it with margin. */
const PAST_FIRST_CYCLE_MS = 9000;

test.describe("Anonymous visits cost no server ingestion", () => {
  test("landing page never calls /api/fetch/* ", async ({ page }) => {
    const ingestionCalls: string[] = [];
    page.on("request", req => {
      if (new URL(req.url()).pathname.startsWith("/api/fetch/")) {
        ingestionCalls.push(`${req.method()} ${new URL(req.url()).pathname}`);
      }
    });

    await page.goto("/");
    await expect(page.getByTestId("aegis-landing-hero")).toBeVisible();
    await page.waitForTimeout(PAST_FIRST_CYCLE_MS);

    expect(ingestionCalls).toEqual([]);
  });

  // Deliberately does not wait for the dashboard to render: what this asserts is
  // the network property, and coupling it to the demo transition would make a
  // CPU regression indistinguishable from an unrelated rendering failure. That
  // the demo reads /demo-feed.json and never an API route is pinned by
  // __tests__/lib/demo/feed.test.ts.
  test("entering the demo never calls /api/fetch/*", async ({ landingPage }) => {
    const page = landingPage.page;
    const ingestionCalls: string[] = [];
    page.on("request", req => {
      const { pathname } = new URL(req.url());
      if (pathname.startsWith("/api/fetch/")) ingestionCalls.push(`${req.method()} ${pathname}`);
    });

    await landingPage.enterDemo();
    await page.waitForTimeout(PAST_FIRST_CYCLE_MS);

    expect(ingestionCalls).toEqual([]);
  });
});
