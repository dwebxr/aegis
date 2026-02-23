import { test, expect } from "../fixtures/base";

test.describe("Tab Navigation", () => {
  // These tests use the desktop sidebar. Mobile nav is tested in responsive.spec.ts.
  test.beforeEach(async ({ navigationPage }) => {
    const sidebar = navigationPage.sidebarNav("dashboard");
    test.skip(!(await sidebar.isVisible().catch(() => false)), "Sidebar not visible on mobile");
  });

  test("sidebar shows 5 navigation items", async ({ navigationPage }) => {
    const ids = ["dashboard", "briefing", "incinerator", "sources", "analytics"];
    for (const id of ids) {
      await expect(navigationPage.sidebarNav(id)).toBeVisible();
    }
  });

  test("clicking Sources tab shows Sources heading", async ({ navigationPage }) => {
    await navigationPage.sidebarNav("sources").click();
    await expect(navigationPage.page.getByTestId("aegis-sources-heading")).toBeVisible({ timeout: 10_000 });
  });

  test("clicking Burn tab shows Incinerator heading", async ({ navigationPage }) => {
    await navigationPage.sidebarNav("incinerator").click();
    await expect(navigationPage.page.getByTestId("aegis-incinerator-heading")).toBeVisible({ timeout: 10_000 });
  });

  test("clicking Stats tab shows Analytics content", async ({ navigationPage }) => {
    await navigationPage.sidebarNav("analytics").click();
    await expect(navigationPage.page.getByRole("heading", { name: "Analytics" })).toBeVisible({ timeout: 10_000 });
  });

  test("clicking Home returns to Dashboard", async ({ navigationPage }) => {
    // Navigate away first
    await navigationPage.sidebarNav("sources").click();
    await expect(navigationPage.page.getByTestId("aegis-sources-heading")).toBeVisible({ timeout: 10_000 });
    // Navigate back
    await navigationPage.sidebarNav("dashboard").click();
    await expect(navigationPage.page.getByTestId("aegis-dashboard")).toBeVisible({ timeout: 10_000 });
  });

  test("Settings button is not visible in demo mode", async ({ navigationPage }) => {
    await expect(navigationPage.settingsButton()).not.toBeVisible();
  });
});
