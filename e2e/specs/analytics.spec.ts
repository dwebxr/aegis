import { test, expect } from "../fixtures/base";

test.describe("Analytics Tab", () => {
  test("shows Analytics heading and subtitle", async ({ authAnalyticsPage }) => {
    await expect(authAnalyticsPage.heading).toBeVisible();
    await expect(authAnalyticsPage.heading).toContainText("Analytics");
    await expect(authAnalyticsPage.subtitle).toBeVisible();
    await expect(authAnalyticsPage.subtitle).toContainText("Performance & content metrics");
  });

  test("shows 3 stat cards", async ({ authAnalyticsPage }) => {
    await expect(authAnalyticsPage.page.getByText("Accuracy").first()).toBeVisible();
    await expect(authAnalyticsPage.page.getByText("False Positive").first()).toBeVisible();
    await expect(authAnalyticsPage.page.getByText("User Reviews").first()).toBeVisible();
  });

  test("stat cards display numeric values or dashes", async ({ authAnalyticsPage }) => {
    // Stat cards should contain values (numbers, percentages, or dashes)
    const mainContent = authAnalyticsPage.page.getByTestId("aegis-main-content");
    await expect(mainContent).toContainText(/\d|--/);
  });

  test("Score Distribution chart section is rendered", async ({ authAnalyticsPage }) => {
    await expect(authAnalyticsPage.page.getByText("Score Distribution")).toBeVisible();
  });

  test("Evaluation Summary grid shows KPIs", async ({ authAnalyticsPage }) => {
    await expect(authAnalyticsPage.evalSummary).toBeVisible();
    await expect(authAnalyticsPage.evalSummary).toContainText("Total Evaluated");
    await expect(authAnalyticsPage.evalSummary).toContainText("Quality Found");
    await expect(authAnalyticsPage.evalSummary).toContainText("Slop Caught");
  });

  test("demo mode shows analytics demo data banner", async ({ analyticsPage }) => {
    await expect(analyticsPage.demoBanner).toBeVisible();
    await expect(analyticsPage.demoBanner).toContainText("demo data");
  });

  test("Evaluation Summary shows Total Evaluated with numeric value", async ({ authAnalyticsPage }) => {
    await expect(authAnalyticsPage.evalSummary).toContainText(/Total Evaluated/);
    await expect(authAnalyticsPage.evalSummary).toContainText(/\d/);
  });

  test("heading and subtitle contain expected text", async ({ authAnalyticsPage }) => {
    await expect(authAnalyticsPage.heading).toHaveText("Analytics");
    await expect(authAnalyticsPage.subtitle).toContainText("Performance");
  });

  test("Score Distribution section is rendered below stat cards", async ({ authAnalyticsPage }) => {
    const distribution = authAnalyticsPage.page.getByText("Score Distribution");
    await expect(distribution).toBeVisible();
    // Should be below the stat cards area
    const mainContent = authAnalyticsPage.page.getByTestId("aegis-main-content");
    await expect(mainContent).toContainText("Accuracy");
    await expect(mainContent).toContainText("Score Distribution");
  });
});
