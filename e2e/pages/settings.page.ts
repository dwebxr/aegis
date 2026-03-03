import type { Page, Locator } from "@playwright/test";

export class SettingsPage {
  readonly page: Page;
  readonly heading: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByTestId("aegis-settings-heading");
  }

  subTabButton(tab: "general" | "agent" | "feeds" | "data" | "account"): Locator {
    return this.page.getByTestId(`settings-tab-${tab}`);
  }

  async switchSubTab(tab: "general" | "agent" | "feeds" | "data" | "account") {
    await this.subTabButton(tab).click();
  }

  async waitForLoaded() {
    await this.heading.waitFor({ state: "visible", timeout: 8_000 });
  }
}
