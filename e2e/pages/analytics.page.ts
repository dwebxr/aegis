import type { Page, Locator } from "@playwright/test";

export class AnalyticsPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly subtitle: Locator;
  readonly demoBanner: Locator;
  readonly evalSummary: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByTestId("aegis-analytics-heading");
    this.subtitle = page.getByTestId("aegis-analytics-subtitle");
    this.demoBanner = page.getByTestId("aegis-analytics-demo-banner");
    this.evalSummary = page.getByTestId("aegis-analytics-eval-summary");
  }

  async waitForLoaded() {
    await this.heading.waitFor({ state: "visible", timeout: 8_000 });
  }
}
