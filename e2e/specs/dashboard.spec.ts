import { test, expect } from "../fixtures/base";

test.describe("Dashboard", () => {
  test("displays Home heading", async ({ dashboardPage }) => {
    await expect(dashboardPage.page.getByRole("heading", { name: "Home" })).toBeVisible();
  });

  test("shows Feed/Dashboard mode toggle", async ({ dashboardPage }) => {
    await expect(dashboardPage.feedModeButton).toBeVisible();
    await expect(dashboardPage.dashboardModeButton).toBeVisible();
  });

  test("shows metrics bar", async ({ dashboardPage }) => {
    await expect(dashboardPage.metricsBar).toBeVisible();
  });

  test("metrics bar displays numeric values", async ({ dashboardPage }) => {
    const metricsText = await dashboardPage.metricsBar.textContent();
    // Metrics should contain at least one digit
    expect(metricsText).toMatch(/\d/);
  });

  test("shows filter pills", async ({ dashboardPage }) => {
    await expect(dashboardPage.filterButton("quality")).toBeVisible();
    await expect(dashboardPage.filterButton("all")).toBeVisible();
    await expect(dashboardPage.filterButton("slop")).toBeVisible();
  });

  test("clicking filter pill changes active filter", async ({ dashboardPage }) => {
    const allButton = dashboardPage.filterButton("all");
    await allButton.click();
    // Verify Filtered Signal heading appears (shows count for non-default filter)
    await expect(dashboardPage.page.getByText("Filtered Signal")).toBeVisible();
  });

  test("Dashboard mode shows Top 3 section", async ({ dashboardPage }) => {
    await dashboardPage.switchToDashboard();
    await expect(dashboardPage.top3Section).toBeVisible({ timeout: 10_000 });
    await expect(dashboardPage.page.getByText("Today's Top 3")).toBeVisible();
  });

  test("switching back to Feed mode hides Top 3", async ({ dashboardPage }) => {
    await dashboardPage.switchToDashboard();
    await expect(dashboardPage.top3Section).toBeVisible();
    await dashboardPage.switchToFeed();
    await expect(dashboardPage.top3Section).not.toBeVisible();
  });
});
