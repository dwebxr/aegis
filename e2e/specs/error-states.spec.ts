import { test, expect } from "../fixtures/base";
import { setupApiMocks, setupApiErrors } from "../fixtures/api-mocks";
import { setupAuthMock } from "../fixtures/auth-mock";
import { enterDemoMode, clickNav } from "../fixtures/base";
import { QUALITY_TEXT } from "../fixtures/test-data";
import { TIMEOUTS } from "../constants";

test.describe("API Error States", () => {
  test("Incinerator falls back to heuristic when /api/analyze returns 500", async ({ page }) => {
    await setupApiMocks(page);
    await setupApiErrors(page, { analyzeError: true });
    await page.goto("/");
    await enterDemoMode(page);
    await clickNav(page, "incinerator");
    await page.getByTestId("aegis-incinerator-heading").waitFor({ state: "visible", timeout: TIMEOUTS.navigation });
    await page.getByTestId("aegis-manual-textarea").fill(QUALITY_TEXT);
    await page.getByTestId("aegis-manual-analyze").click();
    // Heuristic fallback should produce a result, not an error
    await expect(page.getByTestId("aegis-manual-result")).toBeVisible({ timeout: TIMEOUTS.long });
    await expect(page.getByTestId("aegis-manual-error")).not.toBeVisible();
  });

  test("Sources URL extraction shows error on 500", async ({ page }) => {
    await setupAuthMock(page, true);
    await setupApiMocks(page);
    await setupApiErrors(page, { urlError: true });
    await page.goto("/");
    await page.getByTestId("aegis-dashboard").waitFor({ state: "visible", timeout: TIMEOUTS.long });
    await clickNav(page, "sources");
    await page.getByTestId("aegis-sources-heading").waitFor({ state: "visible", timeout: TIMEOUTS.navigation });
    await page.getByTestId("aegis-sources-url-input").fill("https://example.com/fail");
    await page.getByTestId("aegis-sources-extract-btn").click();
    await expect(page.getByTestId("aegis-sources-url-error")).toBeVisible({ timeout: TIMEOUTS.api });
  });

  test("Sources RSS fetch shows error on 500", async ({ page }) => {
    await setupAuthMock(page, true);
    await setupApiMocks(page);
    await setupApiErrors(page, { rssError: true });
    await page.goto("/");
    await page.getByTestId("aegis-dashboard").waitFor({ state: "visible", timeout: TIMEOUTS.long });
    await clickNav(page, "sources");
    await page.getByTestId("aegis-sources-heading").waitFor({ state: "visible", timeout: TIMEOUTS.navigation });
    await page.getByTestId("aegis-sources-tab-rss").click();
    await page.getByTestId("aegis-sources-rss-input").fill("https://example.com/bad-feed.xml");
    await page.getByRole("button", { name: /fetch feed/i }).click();
    await expect(page.getByText("Feed fetch failed").first()).toBeVisible({ timeout: TIMEOUTS.api });
  });

  test("Dashboard loads gracefully when health endpoint is down", async ({ page }) => {
    await setupApiMocks(page);
    await setupApiErrors(page, { healthDown: true });
    await page.goto("/");
    await enterDemoMode(page);
    await expect(page.getByTestId("aegis-dashboard")).toBeVisible();
  });

  test("Incinerator handles malformed API response by falling back to heuristic", async ({ page }) => {
    await setupApiMocks(page);
    // Return invalid JSON → fetchAnalyze throws on res.json() → returns null → heuristic fallback
    await page.route("**/api/analyze", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "this is not valid json",
      });
    });
    await page.goto("/");
    await enterDemoMode(page);
    await clickNav(page, "incinerator");
    await page.getByTestId("aegis-incinerator-heading").waitFor({ state: "visible", timeout: TIMEOUTS.navigation });
    await page.getByTestId("aegis-manual-textarea").fill(QUALITY_TEXT);
    await page.getByTestId("aegis-manual-analyze").click();
    // Heuristic fallback should produce a valid quality/slop verdict
    await expect(page.getByTestId("aegis-manual-result")).toBeVisible({ timeout: TIMEOUTS.long });
    await expect(page.getByTestId("aegis-manual-verdict")).toContainText(/Quality|Slop/);
  });

  test("Twitter API 500 shows error in Sources Twitter tab", async ({ page }) => {
    await setupAuthMock(page, true);
    await setupApiMocks(page);
    await setupApiErrors(page, { twitterError: true });
    await page.goto("/");
    await page.getByTestId("aegis-dashboard").waitFor({ state: "visible", timeout: TIMEOUTS.long });
    await clickNav(page, "sources");
    await page.getByTestId("aegis-sources-heading").waitFor({ state: "visible", timeout: TIMEOUTS.navigation });
    await page.getByTestId("aegis-sources-tab-twitter").click();
    await page.getByPlaceholder(/Bearer Token/i).fill("test-token");
    await page.getByPlaceholder(/AI research/i).fill("test query");
    await page.getByRole("button", { name: /search/i }).click();
    await expect(page.getByText("Twitter API error")).toBeVisible({ timeout: TIMEOUTS.api });
  });

  test("Nostr relay 500 shows error in Sources Nostr tab", async ({ page }) => {
    await setupAuthMock(page, true);
    await setupApiMocks(page);
    await setupApiErrors(page, { nostrError: true });
    await page.goto("/");
    await page.getByTestId("aegis-dashboard").waitFor({ state: "visible", timeout: TIMEOUTS.long });
    await clickNav(page, "sources");
    await page.getByTestId("aegis-sources-heading").waitFor({ state: "visible", timeout: TIMEOUTS.navigation });
    await page.getByTestId("aegis-sources-tab-nostr").click();
    await page.getByRole("button", { name: /Fetch Latest/i }).click();
    await expect(page.getByText("Nostr relay connection failed")).toBeVisible({ timeout: TIMEOUTS.api });
  });
});
