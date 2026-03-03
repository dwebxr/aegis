import type { Page, Locator } from "@playwright/test";

export class BriefingPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly insightCount: Locator;
  readonly emptyState: Locator;
  readonly startEvalButton: Locator;
  readonly filteredToggle: Locator;
  readonly loading: Locator;
  readonly priorityList: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByTestId("aegis-briefing-heading");
    this.insightCount = page.getByTestId("aegis-briefing-insight-count");
    this.emptyState = page.getByTestId("aegis-briefing-empty");
    this.startEvalButton = page.getByTestId("aegis-briefing-start-eval");
    this.filteredToggle = page.getByTestId("aegis-briefing-filtered-toggle");
    this.loading = page.getByTestId("aegis-briefing-loading");
    this.priorityList = page.getByTestId("aegis-briefing-priority-list");
  }

  async waitForLoaded() {
    await this.priorityList.or(this.emptyState).or(this.loading)
      .waitFor({ state: "visible", timeout: 8_000 });
  }
}
