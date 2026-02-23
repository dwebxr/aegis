import type { Page, Locator } from "@playwright/test";

export class DashboardPage {
  readonly page: Page;
  readonly root: Locator;
  readonly feedModeButton: Locator;
  readonly dashboardModeButton: Locator;
  readonly metricsBar: Locator;
  readonly top3Section: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = page.getByTestId("aegis-dashboard");
    this.feedModeButton = page.getByTestId("aegis-home-mode-feed");
    this.dashboardModeButton = page.getByTestId("aegis-home-mode-dashboard");
    this.metricsBar = page.getByTestId("aegis-metrics-bar");
    this.top3Section = page.getByTestId("aegis-top3-section");
  }

  filterButton(verdict: string): Locator {
    return this.page.getByTestId(`aegis-filter-${verdict}`);
  }

  /** Switch to Dashboard mode */
  async switchToDashboard() {
    await this.dashboardModeButton.click();
  }

  /** Switch to Feed mode */
  async switchToFeed() {
    await this.feedModeButton.click();
  }
}
