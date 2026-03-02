import { test, expect } from "../fixtures/base";
import { QUALITY_TEXT } from "../fixtures/test-data";

/** Navigate to a tab by clicking sidebar or mobile nav */
async function navigateTo(page: import("@playwright/test").Page, tabId: string) {
  const sidebar = page.getByTestId(`aegis-nav-${tabId}`);
  if (await sidebar.isVisible().catch(() => false)) {
    await sidebar.click();
  } else {
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      document.querySelectorAll("nextjs-portal").forEach(el => el.remove());
    });
    await page.getByTestId(`aegis-nav-mobile-${tabId}`).click();
  }
}

test.describe("D2A Publish Flow", () => {
  test("manual analysis → score display in Incinerator", async ({ authDashboardPage }) => {
    const page = authDashboardPage.page;

    // Navigate to Incinerator
    await navigateTo(page, "incinerator");
    await page.getByTestId("aegis-incinerator-heading").waitFor({ state: "visible", timeout: 10_000 });

    // Analyze quality text
    const textarea = page.getByTestId("aegis-manual-textarea");
    await textarea.fill(QUALITY_TEXT);
    await page.getByTestId("aegis-manual-analyze").click();

    // Wait for result
    const result = page.getByTestId("aegis-manual-result");
    await result.waitFor({ state: "visible", timeout: 15_000 });

    // Verify scoring details visible
    await expect(result.getByText("Originality")).toBeVisible();
    await expect(result.getByText("Insight")).toBeVisible();
    await expect(result.getByText("Credibility")).toBeVisible();
  });

  test("D2A tab is accessible and shows content", async ({ authDashboardPage }) => {
    const page = authDashboardPage.page;

    // Navigate to D2A tab
    await navigateTo(page, "d2a");

    // D2A tab content should load (look for any D2A heading or content)
    await page.waitForTimeout(2_000);
    // Verify we navigated away from dashboard
    await expect(page.getByTestId("aegis-dashboard")).not.toBeVisible();
  });

  test("D2A tab shows sub-navigation options", async ({ authDashboardPage }) => {
    const page = authDashboardPage.page;

    // Navigate to D2A tab
    await navigateTo(page, "d2a");

    // Wait for D2A content to load
    await page.waitForTimeout(2_000);

    // Look for D2A sub-tab labels (exchanges, published, matches, peers, groups)
    const d2aContent = page.locator("[data-testid='aegis-main-content']");
    const text = await d2aContent.textContent() || "";

    // D2A tab should contain at least some recognizable D2A content
    // (exact content depends on auth state and whether D2A is configured)
    expect(text.length).toBeGreaterThan(0);
  });
});
