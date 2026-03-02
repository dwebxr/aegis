import { test, expect } from "../fixtures/base";

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

test.describe("Briefing Flow", () => {
  test("Briefing tab is accessible from authenticated dashboard", async ({ authDashboardPage }) => {
    const page = authDashboardPage.page;

    // Navigate to Briefing
    await navigateTo(page, "briefing");

    // Should leave dashboard
    await expect(page.getByTestId("aegis-dashboard")).not.toBeVisible();

    // Briefing content area should be present
    const mainContent = page.getByTestId("aegis-main-content");
    await expect(mainContent).toBeVisible();
  });

  test("Briefing tab shows content or empty state", async ({ authDashboardPage }) => {
    const page = authDashboardPage.page;

    // Navigate to Briefing
    await navigateTo(page, "briefing");
    await page.waitForTimeout(2_000);

    // Should show either briefing content or an empty state message
    const mainContent = page.getByTestId("aegis-main-content");
    const text = await mainContent.textContent() || "";

    // Briefing should contain meaningful text (heading, empty state, or items)
    expect(text.length).toBeGreaterThan(0);
  });

  test("can navigate between Briefing and Dashboard", async ({ authDashboardPage }) => {
    const page = authDashboardPage.page;

    // Navigate to Briefing
    await navigateTo(page, "briefing");
    await expect(page.getByTestId("aegis-dashboard")).not.toBeVisible();

    // Navigate back to Dashboard
    await navigateTo(page, "dashboard");
    await expect(page.getByTestId("aegis-dashboard")).toBeVisible({ timeout: 10_000 });
  });
});
