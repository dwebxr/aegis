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

test.describe("Settings & Preferences Flow", () => {
  test("Settings tab is accessible from authenticated dashboard", async ({ authDashboardPage }) => {
    const page = authDashboardPage.page;

    // Navigate to Settings (in footer nav, authOnly)
    await navigateTo(page, "settings");
    await page.getByTestId("aegis-settings-heading").waitFor({ state: "visible", timeout: 10_000 });

    // Settings heading should be visible
    await expect(page.getByTestId("aegis-settings-heading")).toContainText("Settings");
  });

  test("Settings tab displays preference sections", async ({ authDashboardPage }) => {
    const page = authDashboardPage.page;

    // Navigate to Settings
    await navigateTo(page, "settings");
    await page.getByTestId("aegis-settings-heading").waitFor({ state: "visible", timeout: 10_000 });

    // Settings page should have content
    const mainContent = page.getByTestId("aegis-main-content");
    const text = await mainContent.textContent() || "";

    // Should contain settings-related content
    expect(text.length).toBeGreaterThan(0);
  });

  test("Sources tab shows source management controls", async ({ authDashboardPage }) => {
    const page = authDashboardPage.page;

    // Navigate to Sources
    await navigateTo(page, "sources");
    await page.getByTestId("aegis-sources-heading").waitFor({ state: "visible", timeout: 10_000 });

    // Sources heading visible
    await expect(page.getByTestId("aegis-sources-heading")).toBeVisible();

    // Should show source management UI
    const mainContent = page.getByTestId("aegis-main-content");
    const text = await mainContent.textContent() || "";
    expect(text.length).toBeGreaterThan(0);
  });

  test("can navigate through all main tabs", async ({ authDashboardPage }) => {
    const page = authDashboardPage.page;

    // Start at Dashboard
    await expect(page.getByTestId("aegis-dashboard")).toBeVisible();

    // Briefing
    await navigateTo(page, "briefing");
    await expect(page.getByTestId("aegis-dashboard")).not.toBeVisible();

    // Incinerator
    await navigateTo(page, "incinerator");
    await page.getByTestId("aegis-incinerator-heading").waitFor({ state: "visible", timeout: 10_000 });

    // D2A
    await navigateTo(page, "d2a");
    await page.waitForTimeout(1_000);

    // Sources
    await navigateTo(page, "sources");
    await page.getByTestId("aegis-sources-heading").waitFor({ state: "visible", timeout: 10_000 });

    // Settings
    await navigateTo(page, "settings");
    await page.getByTestId("aegis-settings-heading").waitFor({ state: "visible", timeout: 10_000 });

    // Back to Dashboard
    await navigateTo(page, "dashboard");
    await expect(page.getByTestId("aegis-dashboard")).toBeVisible({ timeout: 10_000 });
  });
});
