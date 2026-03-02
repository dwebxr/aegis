import type { Page } from "@playwright/test";
import {
  MOCK_ANALYZE_QUALITY,
  MOCK_ANALYZE_SLOP,
  MOCK_RSS_RESPONSE,
  MOCK_URL_RESPONSE,
  MOCK_HEALTH_RESPONSE,
} from "./test-data";

/**
 * Set up route interceptors for all external API calls.
 * This prevents real network requests and makes tests deterministic.
 */
export async function setupApiMocks(page: Page) {
  // /api/analyze — return quality or slop based on text length
  await page.route("**/api/analyze", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    const text: string = body.text || "";
    const isQuality = text.length > 50;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(isQuality ? MOCK_ANALYZE_QUALITY : MOCK_ANALYZE_SLOP),
    });
  });

  // /api/fetch/rss — return mock RSS items
  await page.route("**/api/fetch/rss**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_RSS_RESPONSE),
    });
  });

  // /api/fetch/url — return mock extracted article
  await page.route("**/api/fetch/url**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_URL_RESPONSE),
    });
  });

  // /api/fetch/discover-feed — return empty
  await page.route("**/api/fetch/discover-feed**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ feeds: [] }),
    });
  });

  // /api/fetch/ogimage — return empty
  await page.route("**/api/fetch/ogimage**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ imageUrl: null }),
    });
  });

  // /api/health — return healthy
  await page.route("**/api/health**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(MOCK_HEALTH_RESPONSE),
    });
  });

  // /api/fetch/nostr — return empty events
  await page.route("**/api/fetch/nostr**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ events: [] }),
    });
  });

  // /api/fetch/farcaster — return empty items
  await page.route("**/api/fetch/farcaster**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });

  // /api/push/register — accept push subscriptions
  await page.route("**/api/push/register**", async (route) => {
    await route.fulfill({ status: 204 });
  });

  // Block IC canister calls
  await page.route("**/api/v2/canister/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/cbor", body: Buffer.from([]) });
  });

  // Block external RSS feed fetches (demo mode preset feeds)
  const DEMO_FEED_PATTERNS = [
    "https://hnrss.org/**",
    "https://www.coindesk.com/**",
    "https://www.theverge.com/**",
  ];
  for (const pattern of DEMO_FEED_PATTERNS) {
    await page.route(pattern, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/xml",
        body: `<?xml version="1.0"?><rss version="2.0"><channel><title>Mock</title></channel></rss>`,
      });
    });
  }
}
