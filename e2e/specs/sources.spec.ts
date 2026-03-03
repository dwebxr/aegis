import { test, expect, clickNav } from "../fixtures/base";
import { setupApiMocks, setupApiErrors } from "../fixtures/api-mocks";
import { setupAuthMock } from "../fixtures/auth-mock";
import { TIMEOUTS } from "../constants";

test.describe("Sources Tab — Layout", () => {
  test("displays Content Sources heading", async ({ sourcesPage }) => {
    await expect(sourcesPage.heading).toBeVisible();
  });

  test("shows 4 source type tabs", async ({ sourcesPage }) => {
    await expect(sourcesPage.urlTab).toBeVisible();
    await expect(sourcesPage.rssTab).toBeVisible();
    await expect(sourcesPage.twitterTab).toBeVisible();
    await expect(sourcesPage.nostrTab).toBeVisible();
  });

  test("demo mode shows read-only banner", async ({ sourcesPage }) => {
    await expect(sourcesPage.demoReadOnlyBanner()).toBeVisible();
  });

  test("shows Popular Sources catalog section", async ({ sourcesPage }) => {
    await expect(sourcesPage.catalog).toBeVisible();
    await expect(sourcesPage.page.getByText("Popular Sources")).toBeVisible();
  });
});

test.describe("Sources — URL Tab", () => {
  test("URL tab shows article extraction form with Extract button", async ({ sourcesPage }) => {
    await expect(sourcesPage.urlInput).toBeVisible();
    await expect(sourcesPage.extractButton).toBeVisible();
  });

  test("Extract button is disabled when URL input is empty", async ({ sourcesPage }) => {
    await expect(sourcesPage.extractButton).toBeDisabled();
  });

  test("typing a URL enables the Extract button", async ({ sourcesPage }) => {
    await sourcesPage.urlInput.fill("https://example.com");
    await expect(sourcesPage.extractButton).toBeEnabled();
  });

  test("URL extraction triggers fetch and shows result with title", async ({ authSourcesPage }) => {
    await authSourcesPage.extractUrl("https://example.com/test-article");
    await expect(authSourcesPage.urlResult).toBeVisible();
    await expect(authSourcesPage.urlResult).toContainText("Test Article");
  });

  test("URL extraction result shows article content", async ({ authSourcesPage }) => {
    await authSourcesPage.extractUrl("https://example.com/test-article");
    await expect(authSourcesPage.urlResult).toContainText("technology and AI");
  });
});

test.describe("Sources — RSS Tab", () => {
  test("RSS tab shows all 7 Quick Add presets", async ({ sourcesPage }) => {
    await sourcesPage.switchToTab("rss");
    for (const label of ["YouTube", "Topic", "GitHub", "Bluesky", "Reddit", "Mastodon", "Farcaster"]) {
      await expect(sourcesPage.quickAddButton(label)).toBeVisible();
    }
  });

  test("RSS tab shows RSS feed URL input with placeholder", async ({ sourcesPage }) => {
    await sourcesPage.switchToTab("rss");
    await expect(sourcesPage.rssInput).toBeVisible();
    await expect(sourcesPage.rssInput).toHaveAttribute("placeholder", /feed\.xml/);
  });

  test("Fetch Feed button is disabled when RSS input is empty", async ({ sourcesPage }) => {
    await sourcesPage.switchToTab("rss");
    const fetchBtn = sourcesPage.page.getByRole("button", { name: /Fetch Feed/i });
    await expect(fetchBtn).toBeDisabled();
  });

  test("typing RSS URL enables Fetch Feed button", async ({ sourcesPage }) => {
    await sourcesPage.switchToTab("rss");
    await sourcesPage.rssInput.fill("https://example.com/feed.xml");
    const fetchBtn = sourcesPage.page.getByRole("button", { name: /Fetch Feed/i });
    await expect(fetchBtn).toBeEnabled();
  });

  test("Quick Add YouTube preset shows channel URL input", async ({ sourcesPage }) => {
    await sourcesPage.switchToTab("rss");
    await sourcesPage.quickAddButton("YouTube").click();
    await expect(sourcesPage.page.getByPlaceholder(/youtube\.com/i)).toBeVisible();
  });
});

test.describe("Sources — Twitter Tab", () => {
  test("Twitter tab shows bearer token and search query inputs", async ({ sourcesPage }) => {
    await sourcesPage.switchToTab("twitter");
    await expect(sourcesPage.page.getByPlaceholder(/Bearer Token/i)).toBeVisible();
    await expect(sourcesPage.page.getByPlaceholder(/AI research/i)).toBeVisible();
  });

  test("Search button is disabled when bearer token and query are empty", async ({ sourcesPage }) => {
    await sourcesPage.switchToTab("twitter");
    const searchBtn = sourcesPage.page.getByRole("button", { name: /search/i });
    await expect(searchBtn).toBeDisabled();
  });

  test("Twitter search with token and query returns tweets", async ({ authSourcesPage }) => {
    await authSourcesPage.switchToTab("twitter");
    await authSourcesPage.page.getByPlaceholder(/Bearer Token/i).fill("test-token-123");
    await authSourcesPage.page.getByPlaceholder(/AI research/i).fill("federated learning");
    await authSourcesPage.page.getByRole("button", { name: /search/i }).click();
    await expect(authSourcesPage.page.getByText("2 tweets found")).toBeVisible({ timeout: TIMEOUTS.api });
    await expect(authSourcesPage.page.getByText("@researcher")).toBeVisible();
  });

  test("Twitter results show Analyze button per tweet", async ({ authSourcesPage }) => {
    await authSourcesPage.switchToTab("twitter");
    await authSourcesPage.page.getByPlaceholder(/Bearer Token/i).fill("test-token-123");
    await authSourcesPage.page.getByPlaceholder(/AI research/i).fill("federated learning");
    await authSourcesPage.page.getByRole("button", { name: /search/i }).click();
    await expect(authSourcesPage.page.getByText("2 tweets found")).toBeVisible({ timeout: TIMEOUTS.api });
    const analyzeButtons = authSourcesPage.page.getByRole("button", { name: "Analyze" });
    await expect(analyzeButtons.first()).toBeVisible();
  });
});

test.describe("Sources — Nostr Tab", () => {
  test("Nostr tab shows relay URL textarea and pubkeys textarea", async ({ sourcesPage }) => {
    await sourcesPage.switchToTab("nostr");
    await expect(sourcesPage.page.getByPlaceholder(/wss:\/\/relay\.damus\.io/)).toBeVisible();
    await expect(sourcesPage.page.getByPlaceholder(/npub or hex pubkey/)).toBeVisible();
  });

  test("Nostr tab shows Fetch Latest button", async ({ sourcesPage }) => {
    await sourcesPage.switchToTab("nostr");
    await expect(sourcesPage.page.getByRole("button", { name: /Fetch Latest/i })).toBeVisible();
  });

  test("authenticated user sees Save Relay Config button", async ({ authSourcesPage }) => {
    await authSourcesPage.switchToTab("nostr");
    await expect(authSourcesPage.page.getByRole("button", { name: /Save Relay Config/i })).toBeVisible();
  });

  test("Fetch Latest returns events from mock relay", async ({ sourcesPage }) => {
    await sourcesPage.switchToTab("nostr");
    await sourcesPage.page.getByRole("button", { name: /Fetch Latest/i }).click();
    // Mock returns empty events array
    await expect(sourcesPage.page.getByText("0 events found")).toBeVisible({ timeout: TIMEOUTS.api });
  });
});

test.describe("Sources — Error States", () => {
  test("URL extraction shows error on API failure", async ({ page }) => {
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
});
