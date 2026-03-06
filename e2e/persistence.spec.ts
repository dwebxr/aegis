import { test, expect, enterDemoMode, clickNav } from "./fixtures/base";
import { setupApiMocks } from "./fixtures/api-mocks";
import { MOCK_CONTENT_ITEMS } from "./fixtures/test-data";
import { DashboardPage } from "./pages/dashboard.page";
import { TIMEOUTS } from "./constants";

test.describe("State Persistence", () => {
  test("content cache survives page reload", async ({ page }) => {
    await setupApiMocks(page);
    await page.addInitScript((items) => {
      localStorage.setItem("aegis-content-cache", JSON.stringify(items));
    }, MOCK_CONTENT_ITEMS);
    await page.goto("/");
    await enterDemoMode(page);

    const dashboard = new DashboardPage(page);
    await dashboard.switchToFeed();

    // Verify cards are visible
    const cards = page.getByTestId("aegis-content-card");
    await expect(cards.first()).toBeVisible({ timeout: TIMEOUTS.long });
    const countBefore = await cards.count();

    // Reload the page
    await page.reload();
    await enterDemoMode(page);
    await dashboard.switchToFeed();

    // Cards should still be present from localStorage
    await expect(cards.first()).toBeVisible({ timeout: TIMEOUTS.long });
    const countAfter = await cards.count();
    expect(countAfter).toBe(countBefore);
  });

  test("theme preference persists across reload", async ({ page }) => {
    await setupApiMocks(page);
    await page.goto("/");
    await enterDemoMode(page);

    // Navigate to settings
    await clickNav(page, "settings");
    await page.getByTestId("aegis-settings-heading").waitFor({
      state: "visible",
      timeout: TIMEOUTS.navigation,
    });

    // Toggle theme
    const toggle = page.getByTestId("aegis-settings-theme-toggle");
    if (await toggle.isVisible()) {
      // Read current state
      const bodyClassBefore = await page.evaluate(() => document.documentElement.className);
      await toggle.click();
      // Wait for class change
      await page.waitForTimeout(500);
      const bodyClassAfter = await page.evaluate(() => document.documentElement.className);
      expect(bodyClassAfter).not.toBe(bodyClassBefore);

      // Reload
      await page.reload();
      await enterDemoMode(page);
      await page.waitForTimeout(500);

      // Theme should persist
      const bodyClassReload = await page.evaluate(() => document.documentElement.className);
      expect(bodyClassReload).toBe(bodyClassAfter);
    }
  });

  test("filter selection persists within session after tab switch", async ({ page }) => {
    await setupApiMocks(page);
    await page.addInitScript((items) => {
      localStorage.setItem("aegis-content-cache", JSON.stringify(items));
    }, MOCK_CONTENT_ITEMS);
    await page.goto("/");
    await enterDemoMode(page);

    const dashboard = new DashboardPage(page);

    // Click quality filter
    const qualityFilter = dashboard.filterButton("quality");
    if (await qualityFilter.isVisible()) {
      await qualityFilter.click();

      // Navigate away
      await clickNav(page, "sources");
      await page.getByTestId("aegis-sources-heading").waitFor({
        state: "visible",
        timeout: TIMEOUTS.navigation,
      });

      // Navigate back
      await clickNav(page, "dashboard");
      await dashboard.root.waitFor({ state: "visible", timeout: TIMEOUTS.navigation });

      // Quality filter should still be active
      await expect(qualityFilter).toHaveAttribute("aria-pressed", "true");
    }
  });
});
