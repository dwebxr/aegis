import { test as base, expect } from "@playwright/test";
import { setupApiMocks } from "./api-mocks";
import { setupAuthMock } from "./auth-mock";
import { isolateNetwork } from "./network-isolation";
import { seedContentCache, emptyDemoFeed } from "./content-cache";
import { MOCK_CONTENT_ITEMS, MOCK_BRIEFING_CONTENT_ITEMS } from "./test-data";
import { LandingPage } from "../pages/landing.page";
import { DashboardPage } from "../pages/dashboard.page";
import { IncineratorPage } from "../pages/incinerator.page";
import { SourcesPage } from "../pages/sources.page";
import { NavigationPage } from "../pages/navigation.page";
import { BriefingPage } from "../pages/briefing.page";
import { D2APage } from "../pages/d2a.page";
import { AnalyticsPage } from "../pages/analytics.page";
import { SettingsPage } from "../pages/settings.page";
import { TIMEOUTS } from "../constants";

type Fixtures = {
  landingPage: LandingPage;
  dashboardPage: DashboardPage;
  /** Dashboard with localStorage pre-seeded with MOCK_CONTENT_ITEMS so cards render deterministically. */
  seededDashboardPage: DashboardPage;
  incineratorPage: IncineratorPage;
  sourcesPage: SourcesPage;
  navigationPage: NavigationPage;
  briefingPage: BriefingPage;
  /** Analytics in demo mode — skips on mobile (analytics not in mobile demo nav). Use for demo-specific tests. */
  analyticsPage: AnalyticsPage;
  /** Analytics in auth mode — analytics visible on all viewports (in mobile footer when authenticated). */
  authAnalyticsPage: AnalyticsPage;
  authDashboardPage: DashboardPage;
  authSettingsPage: SettingsPage;
  authD2APage: D2APage;
  authBriefingPage: BriefingPage;
  authSourcesPage: SourcesPage;
};

export async function enterDemoMode(page: import("@playwright/test").Page) {
  const tryDemo = page.getByTestId("aegis-landing-try-demo");
  await tryDemo.waitFor({ state: "visible", timeout: TIMEOUTS.long });
  await tryDemo.click();
  await page.getByTestId("aegis-dashboard").waitFor({ state: "visible", timeout: TIMEOUTS.long });
}

export async function dismissErrorOverlay(page: import("@playwright/test").Page) {
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    document.querySelectorAll("nextjs-portal").forEach(el => el.remove());
  });
}

export async function clickNav(page: import("@playwright/test").Page, id: string): Promise<boolean> {
  const sidebar = page.getByTestId(`aegis-nav-${id}`);
  if (await sidebar.isVisible().catch(() => false)) {
    await sidebar.click();
    return true;
  }
  await dismissErrorOverlay(page);
  const mobileBtn = page.getByTestId(`aegis-nav-mobile-${id}`);
  try {
    await mobileBtn.waitFor({ state: "visible", timeout: 3_000 });
    await mobileBtn.click();
    return true;
  } catch {
    return false;
  }
}

export const test = base.extend<Fixtures>({
  context: async ({ context }, use) => {
    await isolateNetwork(context);
    await use(context);
  },

  landingPage: async ({ page }, use) => {
    await setupApiMocks(page);
    await page.goto("/");
    await page.getByTestId("aegis-landing-hero").waitFor({ state: "visible", timeout: TIMEOUTS.long });
    await use(new LandingPage(page));
  },

  dashboardPage: async ({ page }, use) => {
    await setupApiMocks(page);
    await page.goto("/");
    await enterDemoMode(page);
    await use(new DashboardPage(page));
  },

  seededDashboardPage: async ({ page }, use) => {
    await setupApiMocks(page);
    await emptyDemoFeed(page);
    await seedContentCache(page, MOCK_CONTENT_ITEMS);
    await page.goto("/");
    await enterDemoMode(page);
    await use(new DashboardPage(page));
  },

  incineratorPage: async ({ page }, use) => {
    await setupApiMocks(page);
    await page.goto("/");
    await enterDemoMode(page);
    await clickNav(page, "incinerator");
    await page.getByTestId("aegis-incinerator-heading").waitFor({ state: "visible", timeout: TIMEOUTS.navigation });
    await use(new IncineratorPage(page));
  },

  sourcesPage: async ({ page }, use) => {
    await setupApiMocks(page);
    await page.goto("/");
    await enterDemoMode(page);
    await clickNav(page, "sources");
    await page.getByTestId("aegis-sources-heading").waitFor({ state: "visible", timeout: TIMEOUTS.navigation });
    await use(new SourcesPage(page));
  },

  navigationPage: async ({ page }, use) => {
    await setupApiMocks(page);
    await page.goto("/");
    await enterDemoMode(page);
    await use(new NavigationPage(page));
  },

  briefingPage: async ({ page }, use) => {
    await setupApiMocks(page);
    // This fixture exercises the empty briefing, before any content is loaded.
    await emptyDemoFeed(page);
    await page.goto("/");
    await enterDemoMode(page);
    await clickNav(page, "briefing");
    await use(new BriefingPage(page));
  },

  analyticsPage: async ({ page, isMobile }, use, testInfo) => {
    testInfo.skip(isMobile, "Analytics not in mobile demo nav");
    await setupApiMocks(page);
    await page.goto("/");
    await enterDemoMode(page);
    const navOk = await clickNav(page, "analytics");
    expect(navOk, "Desktop Analytics navigation must be available").toBe(true);
    await page.getByTestId("aegis-analytics-heading").waitFor({ state: "visible", timeout: TIMEOUTS.navigation });
    await use(new AnalyticsPage(page));
  },

  authAnalyticsPage: async ({ page }, use) => {
    await setupAuthMock(page, true);
    await setupApiMocks(page);
    await page.goto("/");
    await page.getByTestId("aegis-dashboard").waitFor({ state: "visible", timeout: TIMEOUTS.long });
    await clickNav(page, "analytics");
    await page.getByTestId("aegis-analytics-heading").waitFor({ state: "visible", timeout: TIMEOUTS.navigation });
    await use(new AnalyticsPage(page));
  },

  authDashboardPage: async ({ page }, use) => {
    await setupAuthMock(page, true);
    await setupApiMocks(page);
    await page.goto("/");
    await page.getByTestId("aegis-dashboard").waitFor({ state: "visible", timeout: TIMEOUTS.long });
    await use(new DashboardPage(page));
  },

  authSettingsPage: async ({ page }, use) => {
    await setupAuthMock(page, true);
    await setupApiMocks(page);
    await page.goto("/");
    await page.getByTestId("aegis-dashboard").waitFor({ state: "visible", timeout: TIMEOUTS.long });
    await clickNav(page, "settings");
    await page.getByTestId("aegis-settings-heading").waitFor({ state: "visible", timeout: TIMEOUTS.navigation });
    await use(new SettingsPage(page));
  },

  authD2APage: async ({ page }, use) => {
    await setupAuthMock(page, true);
    await setupApiMocks(page);
    await page.goto("/");
    await page.getByTestId("aegis-dashboard").waitFor({ state: "visible", timeout: TIMEOUTS.long });
    await clickNav(page, "d2a");
    await page.getByTestId("aegis-d2a-heading").waitFor({ state: "visible", timeout: TIMEOUTS.navigation });
    await use(new D2APage(page));
  },

  authBriefingPage: async ({ page }, use) => {
    await setupAuthMock(page, true);
    await setupApiMocks(page);
    // Seed includes MOCK_FILTERED_ITEM: it survives the pipeline burn but falls below the
    // briefing threshold after WoT weighting, so the "Filtered Out" toggle renders on every run.
    // (The slop item alone is not enough — the pipeline burns it before the Briefing sees it.)
    await seedContentCache(page, MOCK_BRIEFING_CONTENT_ITEMS, "2vxsx-fae");
    await page.goto("/");
    await page.getByTestId("aegis-dashboard").waitFor({ state: "visible", timeout: TIMEOUTS.long });
    await clickNav(page, "briefing");
    await use(new BriefingPage(page));
  },

  authSourcesPage: async ({ page }, use) => {
    await setupAuthMock(page, true);
    await setupApiMocks(page);
    await page.goto("/");
    await page.getByTestId("aegis-dashboard").waitFor({ state: "visible", timeout: TIMEOUTS.long });
    await clickNav(page, "sources");
    await page.getByTestId("aegis-sources-heading").waitFor({ state: "visible", timeout: TIMEOUTS.navigation });
    await use(new SourcesPage(page));
  },
});

export { expect } from "@playwright/test";
