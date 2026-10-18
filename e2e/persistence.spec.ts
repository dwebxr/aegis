import { randomUUID } from "node:crypto";
import { test, expect, enterDemoMode, clickNav } from "./fixtures/base";
import { setupApiMocks } from "./fixtures/api-mocks";
import { seedContentCache, readContentCache, emptyDemoFeed } from "./fixtures/content-cache";
import { MOCK_CONTENT_ITEMS } from "./fixtures/test-data";
import { DashboardPage } from "./pages/dashboard.page";

test.describe("State Persistence", () => {
  test("content cache survives page reload", async ({ page }) => {
    const id = `persistence-${randomUUID()}`;
    const item = {
      ...MOCK_CONTENT_ITEMS[0],
      id,
      text: `Unique cached research ${id}`,
      createdAt: Date.now(),
    };
    await setupApiMocks(page);
    await emptyDemoFeed(page);
    await seedContentCache(page, [item]);
    await page.goto("/");
    await enterDemoMode(page);

    const dashboard = new DashboardPage(page);
    await dashboard.switchToFeed();
    const card = page.locator(`[id="card-${id}"]`);
    await expect(card).toBeVisible();
    await expect(card).toContainText(item.text);

    // The seed only exists in localStorage. Wait for the app's debounced IDB
    // save, then remove that fallback so reload must read what the app saved.
    await expect.poll(() => readContentCache(page)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id, text: item.text })]),
    );
    await page.evaluate(() => localStorage.removeItem("aegis-content-cache:anon"));

    await page.reload();
    // Demo dismissal survives in sessionStorage; there is no second Try demo.
    await expect(dashboard.root).toBeVisible();
    await dashboard.switchToFeed();
    await expect(card).toBeVisible();
    await expect(card).toContainText(item.text);
    await expect.poll(() => readContentCache(page)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id, text: item.text })]),
    );
  });

  test("theme preference persists across reload", async ({ authSettingsPage }) => {
    const { page } = authSettingsPage;
    const html = page.locator("html");
    const toggle = page.getByTestId("aegis-settings-theme-toggle");
    await expect(toggle).toBeVisible();
    await expect(html).toHaveAttribute("data-theme", /^(dark|light)$/);
    const before = await html.getAttribute("data-theme");
    const selected = before === "dark" ? "light" : "dark";

    await toggle.click();
    await expect(html).toHaveAttribute("data-theme", selected);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("aegis-theme"))).toBe(selected);

    await page.reload();
    await expect(page.getByTestId("aegis-dashboard")).toBeVisible();
    await expect(html).toHaveAttribute("data-theme", selected);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("aegis-theme"))).toBe(selected);
  });

  test.fixme("filter selection persists within session after tab switch", {
    annotation: {
      type: "bug",
      description: "https://github.com/dwebxr/aegis/issues/43 — components/tabs/DashboardTab.tsx:296 keeps verdictFilter in component state; app/page.tsx:761 unmounts the dashboard on tab changes, resetting it to quality. The old test selected the default and hid this bug.",
    },
  }, async ({ seededDashboardPage }) => {
    const dashboard = seededDashboardPage;
    const { page } = dashboard;
    await dashboard.switchToFeed();
    await dashboard.openMoreFilters();
    await dashboard.filterButton("slop").click();
    await dashboard.openMoreFilters();
    await expect(dashboard.filterButton("slop")).toHaveAttribute("aria-current", "true");

    await clickNav(page, "sources");
    await expect(page.getByTestId("aegis-sources-heading")).toBeVisible();
    await clickNav(page, "dashboard");
    await expect(dashboard.root).toBeVisible();
    await dashboard.openMoreFilters();
    await expect(dashboard.filterButton("slop")).toHaveAttribute("aria-current", "true");
  });
});
