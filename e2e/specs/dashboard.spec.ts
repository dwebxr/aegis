import { test, expect } from "../fixtures/base";
import { setupApiMocks } from "../fixtures/api-mocks";
import { setupAuthMock } from "../fixtures/auth-mock";
import { MOCK_CONTENT_ITEMS } from "../fixtures/test-data";
import { TIMEOUTS } from "../constants";

test.describe("Dashboard — Feed Mode", () => {
  test("shows Home heading and metrics bar with numeric values", async ({ dashboardPage }) => {
    await expect(dashboardPage.homeHeading).toBeVisible();
    await expect(dashboardPage.metricsBar).toBeVisible();
    await expect(dashboardPage.metricsBar).toContainText(/\d/);
  });

  test("shows Feed and Dashboard mode toggle buttons", async ({ dashboardPage }) => {
    await expect(dashboardPage.feedModeButton).toBeVisible();
    await expect(dashboardPage.dashboardModeButton).toBeVisible();
  });

  test("shows quality, slop, and all filter pills", async ({ dashboardPage }) => {
    await expect(dashboardPage.filterButton("quality")).toBeVisible();
    await expect(dashboardPage.filterButton("slop")).toBeVisible();
    await expect(dashboardPage.filterButton("all")).toBeVisible();
  });

  test("quality filter button has aria-pressed=true by default", async ({ dashboardPage }) => {
    // Default verdictFilter is "quality" → aria-pressed should reflect this
    await expect(dashboardPage.filterButton("quality")).toHaveAttribute("aria-pressed", "true");
    await expect(dashboardPage.filterButton("all")).toHaveAttribute("aria-pressed", "false");
  });

  test("clicking slop filter sets aria-pressed=true on slop button", async ({ dashboardPage }) => {
    await dashboardPage.filterButton("slop").click();
    await expect(dashboardPage.filterButton("slop")).toHaveAttribute("aria-pressed", "true");
    await expect(dashboardPage.filterButton("quality")).toHaveAttribute("aria-pressed", "false");
  });

  test("clicking all filter removes item count from Filtered Signal heading", async ({ dashboardPage }) => {
    // Default filter is "quality" → hasActiveFilter = true → count span visible
    await expect(dashboardPage.page.getByTestId("aegis-filter-count")).toBeVisible();
    // Click "all" → hasActiveFilter = false → count span hidden
    await dashboardPage.filterButton("all").click();
    await expect(dashboardPage.page.getByTestId("aegis-filter-count")).not.toBeVisible();
    await expect(dashboardPage.filterButton("all")).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("Dashboard — Dashboard Mode", () => {
  test("switching to Dashboard mode shows Top 3 section", async ({ dashboardPage }) => {
    await dashboardPage.switchToDashboard();
    await expect(dashboardPage.top3Section).toBeVisible();
    await expect(dashboardPage.page.getByText("Today's Top 3")).toBeVisible();
  });

  test("switching back to Feed mode hides Top 3", async ({ dashboardPage }) => {
    await dashboardPage.switchToDashboard();
    await expect(dashboardPage.top3Section).toBeVisible();
    await dashboardPage.switchToFeed();
    await expect(dashboardPage.top3Section).not.toBeVisible();
  });
});

test.describe("Dashboard — Content Cards (with pre-seeded content)", () => {
  // seededDashboardPage pre-populates localStorage["aegis-content-cache"] with MOCK_CONTENT_ITEMS
  // so cards render deterministically without waiting for async RSS ingestion.

  test("pre-seeded content cards appear in the feed", async ({ seededDashboardPage }) => {
    const card = seededDashboardPage.page.getByTestId("aegis-content-card").first();
    await card.waitFor({ state: "visible", timeout: TIMEOUTS.long });
    await expect(card).toBeVisible();
  });

  test("clicking a content card expands it to show score grid", async ({ seededDashboardPage }) => {
    const { page } = seededDashboardPage;
    const card = page.getByTestId("aegis-content-card").first();
    await card.waitFor({ state: "visible", timeout: TIMEOUTS.long });
    await card.click();
    await expect(card).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("aegis-card-score-grid").first()).toBeVisible();
  });

  test("clicking expanded card again collapses it", async ({ seededDashboardPage }) => {
    const card = seededDashboardPage.page.getByTestId("aegis-content-card").first();
    await card.waitFor({ state: "visible", timeout: TIMEOUTS.long });
    await card.click();
    await expect(card).toHaveAttribute("aria-expanded", "true");
    await card.click();
    await expect(card).toHaveAttribute("aria-expanded", "false");
  });

  test("expanded card shows Validate button", async ({ seededDashboardPage }) => {
    const { page } = seededDashboardPage;
    const card = page.getByTestId("aegis-content-card").first();
    await card.waitFor({ state: "visible", timeout: TIMEOUTS.long });
    await card.click();
    await expect(page.getByTestId("aegis-card-validate").first()).toBeVisible();
  });

  test("Validate button click disables itself", async ({ seededDashboardPage }) => {
    const { page } = seededDashboardPage;
    const card = page.getByTestId("aegis-content-card").first();
    await card.waitFor({ state: "visible", timeout: TIMEOUTS.long });
    await card.click();
    const validateBtn = page.getByTestId("aegis-card-validate").first();
    await validateBtn.click();
    await expect(validateBtn).toBeDisabled();
  });

  test("expanded card shows AI reasoning text", async ({ seededDashboardPage }) => {
    const { page } = seededDashboardPage;
    const card = page.getByTestId("aegis-content-card").first();
    await card.waitFor({ state: "visible", timeout: TIMEOUTS.long });
    await card.click();
    const reason = page.getByTestId("aegis-card-reason").first();
    await expect(reason).toBeVisible();
    await expect(reason).toContainText(/\w/);
  });

  test("first card shows author name from mock data", async ({ seededDashboardPage }) => {
    const card = seededDashboardPage.page.getByTestId("aegis-content-card").first();
    await card.waitFor({ state: "visible", timeout: TIMEOUTS.long });
    // First item in MOCK_CONTENT_ITEMS has author "Dr. Sarah Chen"
    await expect(card).toContainText("Dr. Sarah Chen");
  });
});

test.describe("Dashboard — Additional Filters", () => {
  test("validated filter pill is visible", async ({ dashboardPage }) => {
    await expect(dashboardPage.filterButton("validated")).toBeVisible();
  });

  test("bookmarked filter pill is visible", async ({ dashboardPage }) => {
    await expect(dashboardPage.filterButton("bookmarked")).toBeVisible();
  });

  test("metrics bar shows 4 stat values with numbers", async ({ dashboardPage }) => {
    await expect(dashboardPage.metricsBar).toContainText(/quality/i);
    await expect(dashboardPage.metricsBar).toContainText(/burned/i);
    await expect(dashboardPage.metricsBar).toContainText(/eval/i);
    await expect(dashboardPage.metricsBar).toContainText(/sources/i);
  });
});

test.describe("Dashboard — Authenticated", () => {
  test("authenticated user sees dashboard without landing page", async ({ authDashboardPage }) => {
    await expect(authDashboardPage.root).toBeVisible();
    await expect(authDashboardPage.page.getByTestId("aegis-landing-hero")).not.toBeVisible();
  });

  test("Settings button visible for authenticated users", async ({ authDashboardPage }) => {
    const sidebar = authDashboardPage.page.getByTestId("aegis-nav-settings");
    const mobile = authDashboardPage.page.getByTestId("aegis-nav-mobile-settings");
    await expect(sidebar.or(mobile)).toBeVisible();
  });

  test("authenticated user can switch quality filter (aria-pressed)", async ({ authDashboardPage }) => {
    // Quality is default, clicking it again keeps it pressed
    await expect(authDashboardPage.filterButton("quality")).toHaveAttribute("aria-pressed", "true");
    await authDashboardPage.filterButton("slop").click();
    await expect(authDashboardPage.filterButton("slop")).toHaveAttribute("aria-pressed", "true");
  });

  test("authenticated user can switch between feed and dashboard modes", async ({ authDashboardPage }) => {
    await authDashboardPage.switchToDashboard();
    await expect(authDashboardPage.top3Section).toBeVisible();
    await authDashboardPage.switchToFeed();
    await expect(authDashboardPage.top3Section).not.toBeVisible();
  });

  test("authenticated user content cards appear when pre-seeded", async ({ page }) => {
    await setupAuthMock(page, true);
    await setupApiMocks(page);
    await page.addInitScript((items) => {
      localStorage.setItem("aegis-content-cache", JSON.stringify(items));
    }, MOCK_CONTENT_ITEMS);
    await page.goto("/");
    await page.getByTestId("aegis-dashboard").waitFor({ state: "visible", timeout: TIMEOUTS.long });
    const card = page.getByTestId("aegis-content-card").first();
    await card.waitFor({ state: "visible", timeout: TIMEOUTS.long });
    await expect(card).toBeVisible();
    await expect(card).toContainText("Dr. Sarah Chen");
  });
});
