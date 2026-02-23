import { test, expect } from "../fixtures/base";

test.describe("Demo Mode Flow", () => {
  test("starts on landing page when unauthenticated", async ({ landingPage }) => {
    await expect(landingPage.hero).toBeVisible();
  });

  test("clicking Try the Demo dismisses landing and shows dashboard", async ({ landingPage }) => {
    await landingPage.enterDemo();
    // Landing hero should disappear
    await expect(landingPage.hero).not.toBeVisible();
    // Dashboard should appear
    await expect(landingPage.page.getByTestId("aegis-dashboard")).toBeVisible();
  });

  test("Sources tab shows demo sources are read-only", async ({ sourcesPage }) => {
    await expect(sourcesPage.heading).toContainText("Content Sources");
    await expect(sourcesPage.demoReadOnlyBanner()).toBeVisible();
  });

  test("Incinerator tab shows manual analysis", async ({ incineratorPage }) => {
    await expect(incineratorPage.heading).toContainText("Slop Incinerator");
    await expect(incineratorPage.textarea).toBeVisible();
  });

  test("Dashboard shows Home heading after entering demo", async ({ dashboardPage }) => {
    await expect(dashboardPage.root).toBeVisible();
    await expect(dashboardPage.page.getByRole("heading", { name: "Home" })).toBeVisible();
  });

  test("sidebar Login button is visible in demo mode", async ({ navigationPage }) => {
    // In demo mode, user is not authenticated — Login button should be in sidebar
    await expect(navigationPage.page.getByText("Login with Internet Identity")).toBeVisible();
  });

  test("Settings button is hidden in demo mode", async ({ navigationPage }) => {
    await expect(navigationPage.settingsButton()).not.toBeVisible();
  });
});
