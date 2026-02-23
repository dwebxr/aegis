import { test as base } from "@playwright/test";
import { setupApiMocks } from "./api-mocks";
import { LandingPage } from "../pages/landing.page";
import { DashboardPage } from "../pages/dashboard.page";
import { IncineratorPage } from "../pages/incinerator.page";
import { SourcesPage } from "../pages/sources.page";
import { NavigationPage } from "../pages/navigation.page";

type Fixtures = {
  landingPage: LandingPage;
  dashboardPage: DashboardPage;
  incineratorPage: IncineratorPage;
  sourcesPage: SourcesPage;
  navigationPage: NavigationPage;
};

/** Dismiss landing hero and wait for dashboard to appear */
async function enterDemoMode(page: import("@playwright/test").Page) {
  const tryDemo = page.getByTestId("aegis-landing-try-demo");
  await tryDemo.waitFor({ state: "visible", timeout: 10_000 });
  await tryDemo.click();
  await page.getByTestId("aegis-dashboard").waitFor({ state: "visible", timeout: 10_000 });
}

/** Dismiss Next.js dev error overlay if present (blocks clicks on mobile) */
async function dismissErrorOverlay(page: import("@playwright/test").Page) {
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    document.querySelectorAll("nextjs-portal").forEach(el => el.remove());
  });
}

/** Click a nav item, using mobile nav when sidebar is not visible */
async function clickNav(page: import("@playwright/test").Page, id: string) {
  const sidebar = page.getByTestId(`aegis-nav-${id}`);
  if (await sidebar.isVisible().catch(() => false)) {
    await sidebar.click();
  } else {
    // Mobile: dismiss error overlay first, then use mobile nav
    await dismissErrorOverlay(page);
    await page.getByTestId(`aegis-nav-mobile-${id}`).click();
  }
}

/**
 * Extended test fixture that auto-sets up API mocks and provides page objects.
 * All tests run in demo mode (unauthenticated).
 */
export const test = base.extend<Fixtures>({
  landingPage: async ({ page }, use) => {
    await setupApiMocks(page);
    await page.goto("/");
    await page.getByTestId("aegis-landing-hero").waitFor({ state: "visible", timeout: 10_000 });
    await use(new LandingPage(page));
  },

  dashboardPage: async ({ page }, use) => {
    await setupApiMocks(page);
    await page.goto("/");
    await enterDemoMode(page);
    await use(new DashboardPage(page));
  },

  incineratorPage: async ({ page }, use) => {
    await setupApiMocks(page);
    await page.goto("/");
    await enterDemoMode(page);
    await clickNav(page, "incinerator");
    await page.getByTestId("aegis-incinerator-heading").waitFor({ state: "visible", timeout: 10_000 });
    await use(new IncineratorPage(page));
  },

  sourcesPage: async ({ page }, use) => {
    await setupApiMocks(page);
    await page.goto("/");
    await enterDemoMode(page);
    await clickNav(page, "sources");
    await page.getByTestId("aegis-sources-heading").waitFor({ state: "visible", timeout: 10_000 });
    await use(new SourcesPage(page));
  },

  navigationPage: async ({ page }, use) => {
    await setupApiMocks(page);
    await page.goto("/");
    await enterDemoMode(page);
    await use(new NavigationPage(page));
  },
});

export { expect } from "@playwright/test";
