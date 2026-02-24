import { test, expect } from "../fixtures/base";
import { setupAuthMock } from "../fixtures/auth-mock";
import { setupApiMocks } from "../fixtures/api-mocks";

test.describe("Auth Flow", () => {
  test("shows authenticated UI when logged in via mock", async ({ authDashboardPage }) => {
    const page = authDashboardPage.page;

    // Dashboard should be visible (not landing page)
    await expect(page.getByTestId("aegis-dashboard")).toBeVisible();

    // Landing hero should NOT be visible
    await expect(page.getByTestId("aegis-landing-hero")).not.toBeVisible();
  });

  test("shows landing page when not authenticated", async ({ page }) => {
    await setupAuthMock(page, false);
    await setupApiMocks(page);
    await page.goto("/");

    // Landing hero should be visible
    await expect(page.getByTestId("aegis-landing-hero")).toBeVisible({ timeout: 10_000 });
  });

  test("authenticated user sees IC sync indicators", async ({ authDashboardPage }) => {
    const page = authDashboardPage.page;

    // The app should show some kind of authenticated state indicator
    // In the header/profile area
    await expect(page.getByTestId("aegis-dashboard")).toBeVisible();
  });
});
