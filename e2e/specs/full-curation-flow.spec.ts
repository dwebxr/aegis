import { test, expect } from "../fixtures/base";
import { QUALITY_TEXT } from "../fixtures/test-data";

/** Navigate to a tab by clicking sidebar or mobile nav */
async function navigateTo(page: import("@playwright/test").Page, tabId: string) {
  const sidebar = page.getByTestId(`aegis-nav-${tabId}`);
  if (await sidebar.isVisible().catch(() => false)) {
    await sidebar.click();
  } else {
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      document.querySelectorAll("nextjs-portal").forEach(el => el.remove());
    });
    await page.getByTestId(`aegis-nav-mobile-${tabId}`).click();
  }
}

test.describe("Full Curation Flow", () => {
  test("auth → dashboard shows feed content", async ({ authDashboardPage }) => {
    const page = authDashboardPage.page;

    // Dashboard should be visible with metrics
    await expect(page.getByTestId("aegis-dashboard")).toBeVisible();
    await expect(authDashboardPage.metricsBar).toBeVisible();

    // Filter pills should be available
    await expect(authDashboardPage.filterButton("quality")).toBeVisible();
    await expect(authDashboardPage.filterButton("all")).toBeVisible();
    await expect(authDashboardPage.filterButton("slop")).toBeVisible();
  });

  test("manual analysis → score display → content card appears", async ({ authDashboardPage }) => {
    const page = authDashboardPage.page;

    // Navigate to Incinerator (Burn tab)
    await navigateTo(page, "incinerator");
    await page.getByTestId("aegis-incinerator-heading").waitFor({ state: "visible", timeout: 10_000 });

    // Analyze quality text
    const textarea = page.getByTestId("aegis-manual-textarea");
    await textarea.fill(QUALITY_TEXT);
    await page.getByTestId("aegis-manual-analyze").click();

    // Wait for result
    const result = page.getByTestId("aegis-manual-result");
    await result.waitFor({ state: "visible", timeout: 15_000 });

    // Verdict should be Quality
    const verdict = page.getByTestId("aegis-manual-verdict");
    await expect(verdict).toContainText("Quality");

    // Score bars should be visible
    await expect(result.getByText("Originality")).toBeVisible();
    await expect(result.getByText("Insight")).toBeVisible();
    await expect(result.getByText("Credibility")).toBeVisible();
  });

  test("sources tab shows source management UI", async ({ authDashboardPage }) => {
    const page = authDashboardPage.page;

    // Navigate to Sources
    await navigateTo(page, "sources");
    await page.getByTestId("aegis-sources-heading").waitFor({ state: "visible", timeout: 10_000 });

    // Sources heading should be visible
    await expect(page.getByTestId("aegis-sources-heading")).toBeVisible();
  });

  test("filter pills toggle between quality and slop views", async ({ authDashboardPage }) => {
    const page = authDashboardPage.page;

    // Click Quality filter
    await authDashboardPage.filterButton("quality").click();
    await expect(page.getByText("Filtered Signal")).toBeVisible();

    // Click Slop filter
    await authDashboardPage.filterButton("slop").click();
    await expect(page.getByText("Filtered Signal")).toBeVisible();

    // Click All to reset
    await authDashboardPage.filterButton("all").click();
    await expect(page.getByText("Filtered Signal")).toBeVisible();
  });

  test("Dashboard mode toggle switches between feed and dashboard", async ({ authDashboardPage }) => {
    // Switch to Dashboard mode
    await authDashboardPage.switchToDashboard();
    await expect(authDashboardPage.top3Section).toBeVisible({ timeout: 10_000 });

    // Switch back to Feed mode
    await authDashboardPage.switchToFeed();
    await expect(authDashboardPage.top3Section).not.toBeVisible();
  });
});
