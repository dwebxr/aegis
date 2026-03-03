import type { Page, Locator } from "@playwright/test";

export class D2APage {
  readonly page: Page;
  readonly heading: Locator;
  readonly status: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByTestId("aegis-d2a-heading");
    this.status = page.getByTestId("aegis-d2a-status");
  }

  subTabButton(tab: "exchanges" | "published" | "matches" | "peers" | "groups"): Locator {
    return this.page.getByTestId(`d2a-tab-${tab}`);
  }

  async switchSubTab(tab: "exchanges" | "published" | "matches" | "peers" | "groups") {
    await this.subTabButton(tab).click();
  }

  async waitForLoaded() {
    await this.heading.waitFor({ state: "visible", timeout: 8_000 });
  }
}
