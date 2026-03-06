import { test, expect } from "./fixtures/base";
import { clickNav } from "./fixtures/base";
import { TIMEOUTS } from "./constants";
import { QUALITY_TEXT } from "./fixtures/test-data";

test.describe("User Journeys", () => {
  test("Incinerator: paste text → get score → see verdict and reason", async ({ incineratorPage }) => {
    await incineratorPage.analyze(QUALITY_TEXT);

    const verdict = await incineratorPage.getVerdict();
    expect(verdict.toLowerCase()).toMatch(/quality|slop/);

    const result = incineratorPage.resultContainer;
    await expect(result).toBeVisible();

    const scoreGrid = incineratorPage.page.getByTestId("aegis-card-score-grid");
    await expect(scoreGrid).toBeVisible();
  });

  test("Navigate through all tabs without errors", async ({ dashboardPage }) => {
    const page = dashboardPage.page;

    const tabs = ["briefing", "incinerator", "sources", "dashboard"] as const;
    const testIds = [
      "aegis-briefing-heading",
      "aegis-incinerator-heading",
      "aegis-sources-heading",
      "aegis-dashboard",
    ] as const;

    for (let i = 0; i < tabs.length; i++) {
      await clickNav(page, tabs[i]);
      await page.getByTestId(testIds[i]).waitFor({ state: "visible", timeout: TIMEOUTS.navigation });
    }
  });

  test("Dashboard mode toggle persists within session", async ({ dashboardPage }) => {
    await dashboardPage.switchToFeed();

    const feedBtn = dashboardPage.feedModeButton;
    await expect(feedBtn).toHaveAttribute("aria-pressed", "true");

    // Navigate away and back
    await clickNav(dashboardPage.page, "sources");
    await dashboardPage.page.getByTestId("aegis-sources-heading").waitFor({
      state: "visible",
      timeout: TIMEOUTS.navigation,
    });

    await clickNav(dashboardPage.page, "dashboard");
    await dashboardPage.root.waitFor({ state: "visible", timeout: TIMEOUTS.navigation });

    // Feed mode should still be active
    await expect(dashboardPage.feedModeButton).toHaveAttribute("aria-pressed", "true");
  });

  test("Seeded dashboard shows content cards", async ({ seededDashboardPage }) => {
    await seededDashboardPage.switchToFeed();

    const cards = seededDashboardPage.page.getByTestId("aegis-content-card");
    await expect(cards.first()).toBeVisible({ timeout: TIMEOUTS.long });

    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
