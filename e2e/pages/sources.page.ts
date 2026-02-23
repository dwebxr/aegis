import type { Page, Locator } from "@playwright/test";

export class SourcesPage {
  readonly page: Page;
  readonly heading: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByTestId("aegis-sources-heading");
  }

  /** Get a Quick Add preset button by label text */
  quickAddButton(label: string): Locator {
    return this.page.getByRole("button", { name: label });
  }

  /** Get the demo-mode read-only banner */
  demoReadOnlyBanner() {
    return this.page.getByText("Demo sources are read-only");
  }

  /** Get the Popular Sources / catalog section */
  popularSources() {
    return this.page.getByText("Popular Sources");
  }
}
