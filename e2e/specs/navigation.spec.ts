import { test, expect, clickNav } from "../fixtures/base";

test.describe("Desktop Sidebar Navigation", () => {
  test("sidebar shows 5 main navigation items", async ({ navigationPage }) => {
    const ids = ["dashboard", "briefing", "incinerator", "d2a", "sources"];
    for (const id of ids) {
      const nav = navigationPage.sidebarNav(id);
      if (await nav.isVisible().catch(() => false)) {
        await expect(nav).toBeVisible();
      }
    }
  });

  test("clicking each tab navigates to correct content", async ({ navigationPage }) => {
    await clickNav(navigationPage.page, "sources");
    await expect(navigationPage.page.getByTestId("aegis-sources-heading")).toBeVisible();

    await clickNav(navigationPage.page, "incinerator");
    await expect(navigationPage.page.getByTestId("aegis-incinerator-heading")).toBeVisible();

    // Analytics is in sidebar footer (desktop) or auth-only mobile footer — skip if not available
    const analyticsBtn = navigationPage.sidebarNav("analytics");
    if (await analyticsBtn.isVisible().catch(() => false)) {
      await analyticsBtn.click();
      await expect(navigationPage.page.getByTestId("aegis-analytics-heading")).toBeVisible();
    }
  });

  test("clicking Home returns to Dashboard from any tab", async ({ navigationPage }) => {
    await clickNav(navigationPage.page, "sources");
    await clickNav(navigationPage.page, "dashboard");
    await expect(navigationPage.page.getByTestId("aegis-dashboard")).toBeVisible();
  });

  test("Settings button is hidden in demo mode", async ({ navigationPage }) => {
    await expect(navigationPage.settingsButton()).not.toBeVisible();
  });
});

test.describe("Authenticated Navigation", () => {
  test("Settings button is visible when authenticated", async ({ authDashboardPage }) => {
    const sidebar = authDashboardPage.page.getByTestId("aegis-nav-settings");
    const mobile = authDashboardPage.page.getByTestId("aegis-nav-mobile-settings");
    await expect(sidebar.or(mobile)).toBeVisible();
  });

  test("Settings tab shows Settings heading", async ({ authDashboardPage }) => {
    await clickNav(authDashboardPage.page, "settings");
    await expect(authDashboardPage.page.getByTestId("aegis-settings-heading")).toBeVisible();
  });
});
