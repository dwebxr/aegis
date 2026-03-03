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

  // /api/fetch/twitter — return mock tweets
  await page.route("**/api/fetch/twitter**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tweets: [
          { authorHandle: "@researcher", text: "New paper on federated learning achieves SOTA results", createdAt: "2025-01-15T10:00:00Z" },
          { authorHandle: "@clickbait", text: "WOW you won't BELIEVE this AI trick!!!", createdAt: "2025-01-15T09:00:00Z" },
        ],
      }),
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

  // /api/briefing/digest — return mock digest
  await page.route("**/api/briefing/digest**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ digest: "Today's top insights: Advances in transformer architecture enable edge AI deployment." }),
    });
  });

  // /api/d2a/health — return healthy
  await page.route("**/api/d2a/health**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok" }),
    });
  });

  // /api/d2a/info — return basic info
  await page.route("**/api/d2a/info**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "active", peers: 0, version: "1.0.0" }),
    });
  });

  // /api/upload/image — accept uploads
  await page.route("**/api/upload/image**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url: "https://nostr.build/test.jpg" }),
    });
  });
}

/**
 * Set up API mocks that return errors for specific endpoints.
 * Call setupApiMocks first, then override specific routes with errors.
 */
export async function setupApiErrors(page: Page, config: {
  analyzeError?: boolean;
  rssError?: boolean;
  urlError?: boolean;
  healthDown?: boolean;
  twitterError?: boolean;
  nostrError?: boolean;
} = {}) {
  if (config.analyzeError) {
    await page.route("**/api/analyze", async (route) => {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Internal server error" }) });
    });
  }
  if (config.rssError) {
    await page.route("**/api/fetch/rss**", async (route) => {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Feed fetch failed" }) });
    });
  }
  if (config.urlError) {
    await page.route("**/api/fetch/url**", async (route) => {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "URL extraction failed" }) });
    });
  }
  if (config.healthDown) {
    await page.route("**/api/health**", async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ status: "error" }) });
    });
  }
  if (config.twitterError) {
    await page.route("**/api/fetch/twitter**", async (route) => {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Twitter API error" }) });
    });
  }
  if (config.nostrError) {
    await page.route("**/api/fetch/nostr**", async (route) => {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Nostr relay connection failed" }) });
    });
  }
}
