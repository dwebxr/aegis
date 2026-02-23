import { test as base, expect } from "@playwright/test";
import { setupApiMocks } from "../fixtures/api-mocks";

const test = base;

/** Dismiss Next.js dev error overlay if present */
async function dismissErrorOverlay(page: import("@playwright/test").Page) {
  // The nextjs-portal error overlay can intercept pointer events in dev mode.
  // Press Escape and remove it via JS to ensure clean interactions.
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    document.querySelectorAll("nextjs-portal").forEach(el => el.remove());
  });
}

test.describe("Responsive Layout", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("mobile viewport shows bottom navigation bar", async ({ page }) => {
    await setupApiMocks(page);
    await page.goto("/");
    // Dismiss landing
    const tryDemo = page.getByTestId("aegis-landing-try-demo");
    await tryDemo.waitFor({ state: "visible", timeout: 10_000 });
    await tryDemo.click();
    await page.getByTestId("aegis-dashboard").waitFor({ state: "visible", timeout: 10_000 });
    // Mobile bottom nav should be visible
    await expect(page.getByTestId("aegis-nav-mobile-dashboard")).toBeVisible();
    await expect(page.getByTestId("aegis-nav-mobile-sources")).toBeVisible();
    // Desktop sidebar nav should NOT be visible
    await expect(page.getByTestId("aegis-nav-dashboard")).not.toBeVisible();
  });

  test("mobile landing page renders properly", async ({ page }) => {
    await setupApiMocks(page);
    await page.goto("/");
    await expect(page.getByTestId("aegis-landing-heading")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("aegis-landing-try-demo")).toBeVisible();
  });

  test("Try the Demo button spans full width on mobile", async ({ page }) => {
    await setupApiMocks(page);
    await page.goto("/");
    const btn = page.getByTestId("aegis-landing-try-demo");
    await btn.waitFor({ state: "visible", timeout: 10_000 });
    const box = await btn.boundingBox();
    expect(box).toBeTruthy();
    // Button should be close to viewport width (375px) minus padding
    expect(box!.width).toBeGreaterThan(300);
  });

  test("mobile nav switches tabs correctly", async ({ page }) => {
    await setupApiMocks(page);
    await page.goto("/");
    const tryDemo = page.getByTestId("aegis-landing-try-demo");
    await tryDemo.waitFor({ state: "visible", timeout: 10_000 });
    await tryDemo.click();
    await page.getByTestId("aegis-dashboard").waitFor({ state: "visible", timeout: 10_000 });
    // Dismiss dev error overlay if present
    await dismissErrorOverlay(page);
    // Navigate to Sources via mobile nav
    await page.getByTestId("aegis-nav-mobile-sources").click();
    await expect(page.getByTestId("aegis-sources-heading")).toBeVisible({ timeout: 10_000 });
    // Dismiss overlay again after navigation
    await dismissErrorOverlay(page);
    // Navigate to Burn
    await page.getByTestId("aegis-nav-mobile-incinerator").click();
    await expect(page.getByTestId("aegis-incinerator-heading")).toBeVisible({ timeout: 10_000 });
  });
});
