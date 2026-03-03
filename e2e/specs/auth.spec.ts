import { test, expect } from "../fixtures/base";
import { setupApiMocks } from "../fixtures/api-mocks";
import { setupAuthMock } from "../fixtures/auth-mock";
import { TIMEOUTS } from "../constants";

test.describe("Authentication Flow", () => {
  test("unauthenticated user sees landing page", async ({ page }) => {
    await setupApiMocks(page);
    await page.goto("/");
    await expect(page.getByTestId("aegis-landing-hero")).toBeVisible({ timeout: TIMEOUTS.long });
  });

  test("authenticated user bypasses landing and sees dashboard", async ({ authDashboardPage }) => {
    await expect(authDashboardPage.root).toBeVisible();
    await expect(authDashboardPage.page.getByTestId("aegis-landing-hero")).not.toBeVisible();
  });

  test("authenticated user has access to Settings tab", async ({ authDashboardPage }) => {
    const sidebar = authDashboardPage.page.getByTestId("aegis-nav-settings");
    const mobile = authDashboardPage.page.getByTestId("aegis-nav-mobile-settings");
    const settings = sidebar.or(mobile);
    await expect(settings).toBeVisible();
    await settings.click();
    await expect(authDashboardPage.page.getByTestId("aegis-settings-heading")).toBeVisible();
  });

  test("demo mode does not show Settings tab", async ({ navigationPage }) => {
    await expect(navigationPage.settingsButton()).not.toBeVisible();
  });

  test("demo banner is not shown for authenticated users", async ({ authDashboardPage }) => {
    await expect(authDashboardPage.page.getByTestId("aegis-demo-banner")).not.toBeVisible();
  });

  test("authenticated user sees metrics bar", async ({ authDashboardPage }) => {
    await expect(authDashboardPage.metricsBar).toBeVisible();
    await expect(authDashboardPage.metricsBar).toContainText(/\d/);
  });

  test("authenticated user sees mode toggle buttons", async ({ authDashboardPage }) => {
    await expect(authDashboardPage.feedModeButton).toBeVisible();
    await expect(authDashboardPage.dashboardModeButton).toBeVisible();
  });
});
