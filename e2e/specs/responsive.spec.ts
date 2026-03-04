import { test, expect } from "../fixtures/base";
import { setupApiMocks } from "../fixtures/api-mocks";
import { enterDemoMode, dismissErrorOverlay } from "../fixtures/base";
import { QUALITY_TEXT } from "../fixtures/test-data";
import { TIMEOUTS } from "../constants";

test.describe("Responsive Layout", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test.beforeEach(async ({ page }) => {
    await setupApiMocks(page);
    await page.goto("/");
  });

  test("mobile viewport shows bottom navigation bar, not sidebar", async ({ page }) => {
    await enterDemoMode(page);
    await expect(page.getByTestId("aegis-nav-mobile-dashboard")).toBeVisible();
    await expect(page.getByTestId("aegis-nav-dashboard")).not.toBeVisible();
  });

  test("mobile landing page renders with full-width CTA", async ({ page }) => {
    const tryDemo = page.getByTestId("aegis-landing-try-demo");
    await tryDemo.waitFor({ state: "visible", timeout: TIMEOUTS.long });
    const box = await tryDemo.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThan(300);
  });

  test("mobile nav switches between tabs correctly", async ({ page }) => {
    await enterDemoMode(page);
    await dismissErrorOverlay(page);

    await page.getByTestId("aegis-nav-mobile-sources").click();
    await expect(page.getByTestId("aegis-sources-heading")).toBeVisible();

    await dismissErrorOverlay(page);

    await page.getByTestId("aegis-nav-mobile-incinerator").click();
    await expect(page.getByTestId("aegis-incinerator-heading")).toBeVisible();
  });

  test("mobile Incinerator textarea is usable", async ({ page }) => {
    await enterDemoMode(page);
    await dismissErrorOverlay(page);

    await page.getByTestId("aegis-nav-mobile-incinerator").click();
    await page.getByTestId("aegis-incinerator-heading").waitFor({ state: "visible", timeout: TIMEOUTS.navigation });

    await page.getByTestId("aegis-manual-textarea").fill(QUALITY_TEXT);
    await page.getByTestId("aegis-manual-analyze").click();
    await expect(page.getByTestId("aegis-manual-result")).toBeVisible({ timeout: TIMEOUTS.api });
  });

  test("mobile Dashboard shows metrics bar", async ({ page }) => {
    await enterDemoMode(page);
    await expect(page.getByTestId("aegis-metrics-bar")).toBeVisible();
  });

  test("mobile nav does not show Settings in demo mode", async ({ page }) => {
    await enterDemoMode(page);
    await expect(page.getByTestId("aegis-nav-mobile-settings")).not.toBeVisible();
  });

  test("mobile filter pills are tappable", async ({ page }) => {
    await enterDemoMode(page);
    // Slop is now inside "More filters" dropdown
    await page.getByTestId("aegis-filter-more").click();
    await page.getByTestId("aegis-filter-more-panel").waitFor({ state: "visible" });
    const slopFilter = page.getByTestId("aegis-filter-slop");
    await slopFilter.click();
    // Dropdown closes after selection; reopen to verify
    await page.getByTestId("aegis-filter-more").click();
    await page.getByTestId("aegis-filter-more-panel").waitFor({ state: "visible" });
    await expect(slopFilter).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("aegis-filter-quality")).toHaveAttribute("aria-pressed", "false");
  });

  test("mobile mode toggle buttons work", async ({ page }) => {
    await enterDemoMode(page);
    const dashBtn = page.getByTestId("aegis-home-mode-dashboard");
    await expect(dashBtn).toBeVisible();
    await dashBtn.click();
    await expect(page.getByTestId("aegis-top3-section")).toBeVisible();
  });
});
